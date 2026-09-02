/**
 * The outbound guard — the runtime half of §8.3.
 *
 * "Client-facing response types are declared `additionalProperties: false` in
 * the OpenAPI schema and validated at runtime — failing the response in
 * non-production, alerting in production." The schema half is `schema.ts`;
 * this is the part that stands where a response leaves the process.
 *
 * Two modes, chosen by the caller (this package cannot read `process.env` —
 * it is pure, and a guard whose behaviour depends on an unrecorded input is
 * the kind of control this project keeps finding hollow):
 *
 *   fail   — a response that does not match its schema is refused. For tests,
 *            CI and every non-production environment.
 *   alert  — a response that does not match its schema is reported to the
 *            alert sink and ships anyway. For production, where a schema DRIFT
 *            — a declared field arriving null, wrong-typed or missing — is an
 *            availability problem and not a reason to take the client app down.
 *
 * Two things are refused in BOTH modes, and only on a CLIENT response:
 *
 *   1. A field on `FORBIDDEN_CLIENT_FIELDS`, at any depth.
 *   2. Any field the schema does not declare, at any depth.
 *
 * §8.3's "alert in production" sentence is about schema validation; AC-02
 * says no forbidden key ever reaches a client, and R-02 — the risk that
 * "destroys the product's reason to exist" — is one margin figure in one
 * response. The second rule is the first one made honest: the forbidden list
 * only names what exists today, and the column added last week under a name
 * the list has never heard of (`token_hash`, `storage_key`, `audience`) is the
 * same leak. An undeclared key on a client response is therefore a LEAK, not
 * drift, whatever it is called. On an internal response the same stray key is
 * drift — a contract defect — and follows the mode.
 *
 * This is a deviation from a literal reading of §8.3 and is recorded as one
 * (tasks/todo.md, T-13b) for EL to confirm or reverse. The alert is raised in
 * every case, so production hears about it either way.
 *
 * Blind spots, stated:
 *   - The guard sees what it is handed. A handler that serializes around it,
 *     or a route with no schema wired, is T-14's boot-time gate to catch.
 *   - It judges the object graph, not the bytes. A `toJSON` on a prototype
 *     can emit keys the graph never showed; a `Map` serializes as `{}`. T-14
 *     hands the guard the PARSED serialized payload, which closes both.
 *   - The forbidden-field walk is by KEY. A margin figure under a permitted
 *     key name is invisible to it; the closed schema is why that key would
 *     have to be declared, and a declaration is a review point.
 *
 * Pure: no I/O, no clock, no RNG. The alert sink is the caller's.
 */

import { findForbiddenFields } from './forbidden-fields.js';
import { validateDetailed, type Audience, type ResponseSchema } from './schema.js';

export type OutboundMode = 'fail' | 'alert';

export interface OutboundReport {
  readonly schema: string;
  readonly audience: Audience;
  /** Every way the value fails its schema, as `validate` reports it. */
  readonly problems: readonly string[];
  /** The paths of every key the schema does not declare — a subset of `problems`. */
  readonly undeclared: readonly string[];
  /** Every forbidden field found in the value — client audience only; always empty for internal. */
  readonly leaks: readonly string[];
  /** Whether the response was allowed to leave. */
  readonly shipped: boolean;
}

export class OutboundValidationError extends Error {
  override readonly name: string = 'OutboundValidationError';
  readonly report: OutboundReport;
  constructor(report: OutboundReport) {
    super(
      `${report.schema}: response does not match its schema (${report.problems.length} problem(s)):\n` +
        report.problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.report = report;
  }
}

export class OutboundLeakError extends Error {
  override readonly name = 'OutboundLeakError';
  readonly report: OutboundReport;
  constructor(report: OutboundReport) {
    const what =
      report.leaks.length > 0
        ? `carries a forbidden field: ${report.leaks.join(', ')}`
        : `carries undeclared fields: ${report.undeclared.join(', ')}`;
    super(`${report.schema}: response to a client ${what}`);
    this.report = report;
  }
}

export interface OutboundGuard {
  readonly mode: OutboundMode;
  /**
   * Check `value` against `schema` before it leaves. Returns the same value
   * (never a copy — the guard judges, it does not launder) or throws.
   */
  check<T>(schema: ResponseSchema, value: T): T;
}

const MODES: ReadonlySet<string> = new Set<OutboundMode>(['fail', 'alert']);

export function outboundGuard(opts: {
  readonly mode: OutboundMode;
  readonly alert: (report: OutboundReport) => void;
}): OutboundGuard {
  if (!MODES.has(opts.mode)) throw new Error(`unknown outbound mode '${String(opts.mode)}'`);
  if (typeof opts.alert !== 'function') throw new Error('an alert sink is required');
  const { mode, alert } = opts;

  return Object.freeze({
    mode,
    check<T>(schema: ResponseSchema, value: T): T {
      if (typeof schema !== 'object' || schema === null || !('name' in schema) || !('audience' in schema)) {
        throw new Error('only a named response schema can guard a response');
      }
      const detailed = validateDetailed(schema, value);
      const problems = detailed.map((p) => p.message);
      const undeclared = detailed.filter((p) => p.kind === 'undeclared').map((p) => p.path);
      const leaks = schema.audience === 'client' ? findForbiddenFields(value) : [];

      const isLeak = schema.audience === 'client' && (leaks.length > 0 || undeclared.length > 0);
      if (isLeak) {
        const report = freeze({ schema: schema.name, audience: schema.audience, problems, undeclared, leaks, shipped: false });
        alert(report);
        throw new OutboundLeakError(report);
      }
      if (problems.length === 0) return value;

      const shipped = mode === 'alert';
      const report = freeze({ schema: schema.name, audience: schema.audience, problems, undeclared, leaks, shipped });
      alert(report);
      if (!shipped) throw new OutboundValidationError(report);
      return value;
    },
  });
}

function freeze(report: OutboundReport): OutboundReport {
  return Object.freeze({
    ...report,
    problems: Object.freeze([...report.problems]),
    undeclared: Object.freeze([...report.undeclared]),
    leaks: Object.freeze([...report.leaks]),
  });
}
