import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Alias table. This must agree with `paths` in tsconfig.base.json and with the
 * bundler config when apps exist. The three-way agreement is asserted by
 * tools/check-aliases.mjs, because a silent disagreement here means the type
 * checker and the test runner resolve different files.
 */
const alias = {
  '@rms/kernel-units': fileURLToPath(
    new URL('./packages/kernel-units/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-model': fileURLToPath(
    new URL('./packages/kernel-model/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-catalog': fileURLToPath(
    new URL('./packages/kernel-catalog/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-derive': fileURLToPath(
    new URL('./packages/kernel-derive/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-rules': fileURLToPath(
    new URL('./packages/kernel-rules/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-checks': fileURLToPath(
    new URL('./packages/kernel-checks/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-bom': fileURLToPath(
    new URL('./packages/kernel-bom/src/index.ts', import.meta.url),
  ),
  '@rms/display-list': fileURLToPath(
    new URL('./packages/display-list/src/index.ts', import.meta.url),
  ),
  '@rms/kernel-geom': fileURLToPath(
    new URL('./packages/kernel-geom/src/index.ts', import.meta.url),
  ),
  '@rms/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
  '@rms/api': fileURLToPath(new URL('./apps/api/src/index.ts', import.meta.url)),
  '@rms/client-web': fileURLToPath(
    new URL('./apps/client-web/src/index.ts', import.meta.url),
  ),
  '@rms/internal-web': fileURLToPath(
    new URL('./apps/internal-web/src/index.ts', import.meta.url),
  ),
};

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
        'packages/kernel-geom/src/**': {
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
