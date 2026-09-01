/**
 * The benchmark runner, deliberately separate from the test runner.
 *
 * A benchmark inside the normal suite is either slow on every run or skipped on
 * every run, and the skipped kind is how §5.4's budgets came to have no
 * measurement behind them at all. Its own config, its own command, its own CI
 * step.
 *
 * It shares `vitest.alias.ts` with the test config rather than copying the
 * table: the aliases must agree with tsconfig and the bundler, and a second
 * copy is a fourth thing to keep in agreement.
 */
import { defineConfig } from 'vitest/config';

import { alias } from './vitest.alias.js';

export default defineConfig({
  resolve: { alias },
  test: {
    include: ['tools/bench/**/*.bench-run.ts'],
    environment: 'node',
    fileParallelism: false,
    // A benchmark that times out mid-sample reports a truncated distribution.
    testTimeout: 120_000,
  },
});
