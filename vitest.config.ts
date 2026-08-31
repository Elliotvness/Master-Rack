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
  '@rms/db': fileURLToPath(new URL('./packages/db/src/index.ts', import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/index.ts'],
      reporter: ['text', 'json-summary'],
      /**
       * Blueprint §16.1: 100% branch coverage is enforced on kernel-units,
       * kernel-derive and kernel-checks. These are pure, cheap to test, and
       * where correctness actually lives. A refusal that is never exercised is
       * a refusal nobody knows is broken.
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
      },
    },
  },
});
