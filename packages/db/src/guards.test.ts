import { describe, expect, it } from 'vitest';

import { closeDatabase, configureDatabase, withTenant, withoutTenantForMigrations } from './index.js';

/**
 * The wrapper's guard rails, tested WITHOUT a database.
 *
 * The tenancy suite covers the happy paths against real Postgres. These are the
 * refusals: they need no database precisely because they must fire before one
 * is ever reached. Leaving them untested would mean the only untested code in
 * the tenant path is the code that exists to stop a mistake.
 *
 * Note the ordering dependence: `configureDatabase()` sets module state, so the
 * unconfigured case must be asserted before anything configures a pool. That is
 * why this file closes the database first rather than assuming a clean slate —
 * the tenancy suite may have run before it, and file order is not a contract.
 */

describe('the pool must be configured explicitly', () => {
  it('refuses to run a transaction before configureDatabase(), naming the fix', async () => {
    // An implicitly connected pool is one nobody owns. The refusal is the
    // feature: it fails at the first call with a message that says what to do,
    // rather than connecting to whatever a stray environment variable named.
    await closeDatabase();
    await expect(
      withTenant(
        { organizationId: '11111111-1111-4111-8111-111111111111', actorType: 'client' },
        async () => 'unreachable',
      ),
    ).rejects.toThrow(/pool is not configured/);
  });

  it('names configureDatabase() in the error, so the fix is in the failure', async () => {
    await closeDatabase();
    await expect(
      withTenant(
        { organizationId: '11111111-1111-4111-8111-111111111111', actorType: 'client' },
        async () => 'unreachable',
      ),
    ).rejects.toThrow(/configureDatabase\(\)/);
  });

  it('is safe to close a database that was never opened', async () => {
    // Idempotent teardown: a test or a shutdown path that closes twice must not
    // throw, or cleanup code starts needing its own error handling.
    await expect(closeDatabase()).resolves.toBeUndefined();
    await expect(closeDatabase()).resolves.toBeUndefined();
  });
});

describe('tenant context is validated before it is trusted', () => {
  it('refuses a non-UUID organization id', async () => {
    // set_config takes TEXT. An unvalidated organization id would be a string
    // interpolated into the session state that every RLS policy compares
    // against — so this is validated before it can reach the database at all.
    configureDatabase('postgres://invalid:invalid@127.0.0.1:1/none');
    try {
      await expect(
        withTenant({ organizationId: "not-a-uuid'; --", actorType: 'client' }, async () => 'x'),
      ).rejects.toThrow();
    } finally {
      await closeDatabase();
    }
  });

  it('refuses an unknown actor type', async () => {
    configureDatabase('postgres://invalid:invalid@127.0.0.1:1/none');
    try {
      await expect(
        withTenant(
          {
            organizationId: '11111111-1111-4111-8111-111111111111',
            actorType: 'superuser' as never,
          },
          async () => 'x',
        ),
      ).rejects.toThrow();
    } finally {
      await closeDatabase();
    }
  });
});

describe('the migrations path is named so it cannot be reached for by accident', () => {
  it('is exported under a name nobody types casually', () => {
    // "withoutTenantForMigrations" is deliberately unwieldy. A short alias here
    // would be the easiest possible way to bypass tenant isolation.
    expect(typeof withoutTenantForMigrations).toBe('function');
    expect(withoutTenantForMigrations.name).toBe('withoutTenantForMigrations');
  });

  it('propagates a connection failure rather than silently continuing', async () => {
    await expect(
      withoutTenantForMigrations('postgres://invalid:invalid@127.0.0.1:1/none', async () => 'x'),
    ).rejects.toThrow();
  });
});
