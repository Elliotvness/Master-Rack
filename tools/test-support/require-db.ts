/**
 * F-29 — a database suite that skips is a suite that reported nothing.
 *
 * Nine `.db.test.ts` files each probe Postgres and, when it is absent, print a
 * SKIPPING warning and swap `it` for `it.skip`. The run then reports a green
 * count. That behaviour is right on a developer's laptop and wrong everywhere a
 * result is believed, and it has now been observed three times:
 *
 *   - session 3, as the reason the DB suites had never run;
 *   - session 12, live — the container's Postgres died mid-session, `pnpm test`
 *     reported **52 passed | 7 skipped** and **1,359 passed | 132 skipped** and
 *     stayed green, and `verify` only went red three steps later at
 *     `check-rls` with ECONNREFUSED;
 *   - 2026-09-05 on Windows, reproduced again while assessing the repository:
 *     **1,359 passed | 132 skipped**, exit 0.
 *
 * The stakes are specific. `packages/db/src/tenancy.test.ts` says in its own
 * skip message that those tests are *"the ONLY evidence that tenant isolation
 * works — RLS fails silently, so nothing else catches it."* A silent skip of the
 * only evidence for the strongest control in the system is the exact shape this
 * repository hunts: green build, honest message, nothing behind it.
 *
 * `RMS_REQUIRE_DB=1` is the switch, and it is set in CI. Unset, the skip
 * survives and local development is unchanged; set, an unavailable database is
 * a hard failure at collection time.
 *
 * **Why per-file and not one global setup.** A global probe fails fast when the
 * database is down *at the start* of a run. Session 12's occurrence was a
 * database that died *between* two runs, and a mid-run death would leave later
 * files probing false and skipping green under a global setup that had already
 * passed. Each file asking for itself, at the moment it needs the database, is
 * what covers that.
 *
 * No I/O, no clock, no RNG. The probe stays with the caller; this module only
 * decides what an unavailable database means.
 */

/** The subset of `process.env` this module reads. Injectable so the test needs no globals. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/** The variable that turns a skip into a failure. */
export const REQUIRE_DB_VAR = 'RMS_REQUIRE_DB';

/**
 * Whether an unavailable database must fail rather than skip.
 *
 * Exactly `'1'`. Not `'true'`, not `'yes'`, not any non-empty string: a
 * requirement switch that accepts several spellings is one somebody sets to
 * `'0'` and believes they have turned off, and `'0'` is non-empty.
 */
export function databaseRequired(env: EnvLike): boolean {
  return env[REQUIRE_DB_VAR] === '1';
}

/**
 * Thrown at module scope by a `.db.test.ts` file when the database it needs is
 * absent and `RMS_REQUIRE_DB=1`. Collection fails, so the file reports red
 * rather than reporting a count of zero.
 */
export class DatabaseRequiredError extends Error {
  override readonly name = 'DatabaseRequiredError';
  constructor(message: string) {
    super(message);
  }
}

/**
 * The message an unavailable database produces, in both modes.
 *
 * Returned rather than printed so the test can assert the words without
 * capturing console output — and so the two modes cannot drift into saying
 * different things about the same condition.
 */
export function unavailableMessage(suite: string, adminUrl: string, required: boolean): string {
  const where = `no migrated database at ${adminUrl}`;
  if (required) {
    return (
      `${suite}: ${where}, and ${REQUIRE_DB_VAR}=1.\n` +
      `  These tests are REQUIRED here. Skipping them would report a green count for ` +
      `evidence that was never gathered (F-29).\n` +
      `  Run \`pnpm db:up && pnpm migrate\`, or unset ${REQUIRE_DB_VAR} to allow the skip locally.`
    );
  }
  return (
    `\n  SKIPPING ${suite} tests: ${where}.\n` +
    `  Run \`pnpm db:up && pnpm migrate\` first. Set ${REQUIRE_DB_VAR}=1 to make this a failure ` +
    `instead of a skip.\n`
  );
}

/**
 * Call once, at module scope, after probing — before building `maybe`.
 *
 * Throws when the database is unavailable and required; warns and returns
 * otherwise, leaving the caller's existing `available ? it : it.skip` intact.
 *
 * `warn` is injected so the test can observe the local-development path without
 * writing to the real console.
 */
export function requireDatabase(
  available: boolean,
  suite: string,
  adminUrl: string,
  env: EnvLike = process.env,
  warn: (message: string) => void = console.warn,
): void {
  if (available) return;

  const required = databaseRequired(env);
  const message = unavailableMessage(suite, adminUrl, required);

  if (required) throw new DatabaseRequiredError(message);
  warn(message);
}
