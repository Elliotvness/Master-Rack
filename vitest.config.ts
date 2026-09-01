import { defineConfig } from 'vitest/config';

import { alias } from './vitest.alias.js';


export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    // Integration suites share ONE Postgres and each truncates the tables it
    // seeds. Running files in parallel would let one suite wipe another's
    // fixture mid-run. Serial files keep the shared database deterministic;
    // the pure suites are fast enough that this costs nothing noticeable.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      /**
       * Everything shipped is MEASURED. An unmeasured directory reports no
       * number, which reads as no problem — apps/ was excluded here and its
       * authorization layer sat at 71% behind a headline of 100%.
       */
      include: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.test.ts',
        'packages/*/src/index.ts',
        'apps/*/src/**/*.test.ts',
        'apps/*/src/index.ts',
      ],
      reporter: ['text', 'json-summary'],
      /**
       * Blueprint §16.1: 100% coverage is enforced on every pure package. They
       * are pure, cheap to test, and where correctness actually lives. A
       * refusal that is never exercised is a refusal nobody knows is broken.
       *
       * The application and database layers carry FLOOR thresholds rather than
       * 100%, and the difference is deliberate rather than a concession:
       *
       *   - A pure function's every branch is reachable from its arguments, so
       *     100% is achievable and anything less means a refusal is untested.
       *   - An I/O layer has branches reachable only from a driver fault or a
       *     corrupted row. Chasing those to 100% produces mocks that assert the
       *     mock, which is worse than an honest gap: it converts a known
       *     weakness into a false assurance.
       *
       * These floors are a RATCHET. They sit just under the measured value, so
       * a regression fails the build while an improvement is free. Raise them
       * when the number rises; never lower them to make a build pass.
       */
      thresholds: {
        'packages/kernel-units/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/kernel-model/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/kernel-catalog/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/kernel-derive/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/kernel-rules/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/kernel-checks/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/kernel-bom/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/display-list/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/contracts/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'packages/kernel-geom/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // The submit transaction, moved off the client bundle by T-07. Pure
        // orchestration with injected effects, so every refusal is reachable
        // from its arguments — and every refusal here is one that stops a
        // submission, which is not a place to carry an unexercised branch.
        'packages/workflow/src/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },

        // --- Application and database layers: ratcheted floors, not 100% ---

        // The authorization layer is the control for R-02, the leakage risk
        // that destroys the product's reason to exist. Every action x every
        // role is enumerated in authz/matrix.test.ts; what remains uncovered is
        // defensive branching.
        // The client bundle's namespace guard and the AC-01 collapse are the
        // two controls that keep an internal field off a client screen. Both
        // are pure logic, so 100% is achievable and anything less is untested.
        // The internal trace is the evidence an estimator relies on to defend
        // a number. Pure logic, so 100% is achievable and anything less means
        // an unexercised branch in the one feature that explains the engine.
        'apps/internal-web/src/lib/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'apps/client-web/src/lib/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'apps/api/src/authz/**': {
          branches: 90,
          functions: 100,
          lines: 92,
          statements: 92,
        },
        // Session, invitation and password handling. The uncovered lines are
        // driver-fault paths inside scrypt and Postgres error handling.
        'apps/api/src/auth/**': {
          branches: 85,
          functions: 100,
          lines: 96,
          statements: 96,
        },
        // The DTO layer is the leakage boundary itself, and the audit chain
        // must be provably complete. Both are fully covered and stay that way.
        'apps/api/src/dto/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'apps/api/src/audit/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        'apps/api/src/outbox/**': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // The submit transaction's server half. Lines, statements and functions
        // at 100 — every refusal here stops a submission. Branches sit at a
        // floor of 97 for ONE branch, named rather than waved at: step 8 asks
        // the chain whether each event this transaction wrote is present, and
        // the "absent" arm is unreachable because three other controls already
        // prevent it — the write and the read share a transaction, DELETE on
        // `app.audit_event` is revoked from the application role, and an
        // append-only trigger raises besides. Covering it would mean disabling
        // those to prove this one, which credits one control for another's
        // work. The check stays because it is what ties AC-15's claim to the
        // chain; the floor stays because pretending it is covered would be the
        // false assurance this file's own comment warns about.
        'apps/api/src/workflow/**': {
          branches: 97,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // withTenant() is the only correct path to the database. Its guards are
        // covered; the remainder is pool and driver plumbing.
        'packages/db/src/**': {
          branches: 85,
          functions: 83,
          lines: 73,
          statements: 73,
        },
      },
    },
  },
});
