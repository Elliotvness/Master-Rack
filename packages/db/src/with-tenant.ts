/**
 * withTenant — the only permitted way to reach the database.
 *
 * Everything about this file is about one line: `set_config(..., true)` inside
 * an explicit transaction. The `true` makes the setting transaction-local, so
 * it is reverted at COMMIT or ROLLBACK.
 *
 * A session-scoped `SET` would look identical in a code review and would be a
 * cross-tenant leak: under a transaction pooler the connection is handed to
 * another client with the previous tenant's context still attached. It would
 * work perfectly in development and fail under load, serving one client's
 * building to another.
 *
 * A lint rule bans raw pool checkout so this wrapper cannot be bypassed.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

export type ActorType = 'client' | 'staff' | 'service';

export interface TenantContext {
  readonly organizationId: string;
  readonly actorType: ActorType;
}

/** The transaction handle handed to callers. Deliberately narrow. */
export interface TenantTransaction {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

let pool: Pool | undefined;

/**
 * Configure the pool once at startup.
 *
 * The connection string is supplied by the caller rather than read from the
 * environment here, so this module has no ambient dependency and a test can
 * point it at a throwaway database without touching global state.
 */
export function configureDatabase(connectionString: string): void {
  pool = new Pool({ connectionString, max: 10 });
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

function requirePool(): Pool {
  if (pool === undefined) {
    throw new Error(
      'The database pool is not configured. Call configureDatabase() at startup. ' +
        'This is deliberately explicit: an implicitly connected pool is one nobody owns.',
    );
  }
  return pool;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR_TYPES: ReadonlySet<string> = new Set(['client', 'staff', 'service']);

/**
 * Run `fn` inside a transaction with the tenant context set.
 *
 * The context is validated before it is set. `set_config` takes text, and an
 * unvalidated organization id would be a string interpolated into the session
 * state that every RLS policy then compares against.
 */
export async function withTenant<T>(
  context: TenantContext,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(context.organizationId)) {
    throw new Error(
      `Refusing to set a tenant context to '${context.organizationId}': not a UUID. ` +
        'Every RLS policy compares against this value.',
    );
  }
  if (!ACTOR_TYPES.has(context.actorType)) {
    throw new Error(
      `Refusing to set an unknown actor type '${context.actorType}'. ` +
        'Permitted: client, staff, service.',
    );
  }

  const client: PoolClient = await requirePool().connect();
  try {
    await client.query('BEGIN');

    // Transaction-local. Reverted at COMMIT or ROLLBACK, so it cannot survive
    // the connection returning to the pool.
    await client.query('SELECT set_config($1, $2, true)', [
      'app.organization_id',
      context.organizationId,
    ]);
    await client.query('SELECT set_config($1, $2, true)', [
      'app.actor_type',
      context.actorType,
    ]);

    const result = await fn({
      query: (text, values) => client.query(text, values ? [...values] : undefined),
    });

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` with NO tenant context, as the migrator role.
 *
 * For migrations and for the CI assertions that inspect the catalog. Named
 * unmistakably so it cannot be reached for by accident, and it does not set a
 * tenant context — with RLS forced and `app.current_org()` returning NULL, a
 * query through this path sees nothing rather than everything.
 */
export async function withoutTenantForMigrations<T>(
  connectionString: string,
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const migrationPool = new Pool({ connectionString, max: 1 });
  const client = await migrationPool.connect();
  try {
    return await fn({
      query: (text, values) => client.query(text, values ? [...values] : undefined),
    });
  } finally {
    client.release();
    await migrationPool.end();
  }
}
