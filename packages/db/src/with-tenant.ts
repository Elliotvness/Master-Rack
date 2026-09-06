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
 * Run `fn` with NO tenant context, as the APPLICATION role.
 *
 * The one moment before a tenant is known (**F-47**). An invited person arrives
 * from an email link holding a token and nothing else; §14.3 forbids the
 * organization travelling in that token or its URL; `withTenant` above refuses
 * to open without one. Something has to run first, and this is it.
 *
 * WHAT IT CAN REACH IS ALMOST NOTHING, and TWO mechanisms make that true — one
 * of which the first draft of this function did not have, and adversarial
 * review demonstrated the hole by committing a forged row through it.
 *
 * 1. NO TENANT CONTEXT. `app.current_org()` is NULL and
 *    `app.current_actor_type()` is NULL, so `app.is_staff()` is NULL rather
 *    than false — `NULL = 'staff'` is NULL — and every tenant policy, shaped
 *    `organization_id = app.current_org() OR app.is_staff()`, is NULL rather
 *    than true. Not-true is what RLS requires, so every tenant table returns
 *    zero rows. (The distinction matters the day someone writes a policy with
 *    `NOT app.is_staff()` in it, which would be NULL there too, and permanently
 *    open. Nothing does today; `app.is_staff()` should be wrapped in COALESCE
 *    before anything does.)
 *
 * 2. READ ONLY, and this is the mechanism, not a belt-and-braces extra. RLS
 *    does NOT make this transaction inert for writes: `app.audit_event`'s
 *    insert policy is `WITH CHECK (true)` — deliberately, because a deny by any
 *    actor must be recordable — and `app_user` holds INSERT on it. So the one
 *    table reachable from a no-tenant transaction was the append-only evidence
 *    store, where a write is both possible and IRREVERSIBLE: review committed a
 *    forged `catalog.approve` row from here and then could not delete it,
 *    because `app.refuse_audit_mutation()` refuses DELETE. `BEGIN READ ONLY`
 *    closes it at the transaction level, which costs nothing — the resolver
 *    only reads — and makes the claim true by construction rather than by an
 *    inventory of tables somebody has to keep current.
 *
 * So the shape of the privilege is: this opens a door into a room containing
 * one telephone, and the room is now read-only.
 * `apps/api/src/auth/tenant-resolver.db.test.ts` proves it by querying — the
 * emptiness was asserted only in prose until F-47 pointed out that no test had
 * ever run a statement with no context at all, and it was not even true until
 * review wrote the one that mattered.
 *
 * NOT for general use, and enforced rather than requested:
 * `tools/check-app-boundaries.mjs` permits this symbol to be named only under
 * `apps/api/src/auth/`, the directory that owns the acceptance path.
 */
export async function withUnresolvedTenant<T>(
  fn: (tx: TenantTransaction) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await requirePool().connect();
  try {
    // READ ONLY is load-bearing — see 2. above. Postgres refuses every INSERT,
    // UPDATE and DELETE in this transaction regardless of policy, which is the
    // only thing that closes `audit_event`'s `WITH CHECK (true)`.
    await client.query('BEGIN READ ONLY');
    // Deliberately no set_config. Not "forgot to" — the absence IS the
    // mechanism, and `withTenant`'s docstring explains why the setting must be
    // transaction-local when there is one.
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
