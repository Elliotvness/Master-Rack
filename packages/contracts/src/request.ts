/**
 * Closed request bodies — the input half of the audience boundary (T-13c).
 *
 * `schema.ts` closed what LEAVES. This closes what ENTERS, and the asymmetry
 * matters: a leaked field is a disclosure, an accepted field is a privilege
 * escalation. `apps/api/src/auth/invitation.ts` already states the rule in
 * prose — "none of those are ever accepted from the client, because taking
 * them from the request body is textbook mass assignment" — and prose in one
 * file is not a mechanism.
 *
 * Three guarantees, deliberately different in kind:
 *
 *   1. STRUCTURAL. A body cannot DECLARE a server-assigned field, at any
 *      depth: `clientRequestBody({ audience: string() })` throws when the
 *      module loads, so no handler has a declaration to bind to. The failure
 *      lands on the line that wrote the field.
 *
 *   2. UNFORGEABLE. `parseBody` accepts only a schema this module built. The
 *      first review of this task found the hole that makes the point: a
 *      `ResponseSchema` is structurally identical to a request schema, so
 *      `parseBody(Revision, body)` — `Revision` being a real, shipped DTO that
 *      declares `organization_id`, `audience` and `lifecycle_state` — compiled
 *      clean and bound all three. A `kind` discriminator closes it at the type
 *      level and a private WeakSet closes it at runtime, because a type-level
 *      brand alone is a cast away from gone.
 *
 *   3. NARROWED. A handler receives a NEW null-prototype object built key by
 *      key from the declaration, from a SNAPSHOT of the body taken once. Not
 *      the object off the wire: `Object.assign(row, body)` cannot assign a key
 *      the schema did not declare, and cannot re-read a getter that answered
 *      differently during validation. Validation makes a stray key LOUD; the
 *      narrowing makes it ABSENT, and does not depend on validation having run
 *      — every scalar position is type-checked again on the way through.
 *
 * WHAT IS SERVER-ASSIGNED IS A RULE, NOT A LIST. The first draft of this
 * module carried sixteen names written from memory; review found three that
 * match no column in `packages/db/migrations/` (`revision`, `tenant_id`,
 * `updated_at`) while `is_internal` — the tenant-root privilege bit, §7.2's
 * "McMurray Stern is itself an organization with is_internal = true" — was
 * wide open, along with `content_hash`, `revision_code` and `request_status`.
 * A list validated against itself is F-02's shape. So the predicate below is
 * a rule over column NAMES, and `tools/check-server-owned.mjs` feeds it the
 * columns the DDL ITSELF marks as the server's — a `now()` or
 * `gen_random_uuid()` default, a `GENERATED` clause, a lifecycle or privilege
 * enum type — and fails on one the rule does not cover. That is 15 of the
 * schema's ~129 columns, not all of them; a server-owned column carrying no
 * DDL signal (`content_hash`, `manifest_uri`, `payload`) rests on the suffix
 * rule and on there being no route that writes it.
 *
 * TWO AUDIENCES, mirroring `schema.ts`. `clientRequestBody` additionally
 * refuses `organization_id`, `role` and everything on
 * `FORBIDDEN_CLIENT_FIELDS`. `internalRequestBody` does not, and that is a
 * DEVIATION from a literal reading of T-13c's acceptance criteria, recorded
 * as one in `tasks/todo.md` for EL to confirm or reverse. The reason is §8.2:
 * `POST /api/internal/v1/invitations` issues an invitation into ANY
 * organization and has no path parameter for it, and §7.2 says of the
 * invitation row "Role and org live here, not in the URL." A blanket refusal
 * makes that MVP-1 route undeclarable. §14.3's mass-assignment sentence is
 * itself scoped to the client — "the acceptance form must not accept any of
 * them from the client" — so the blanket reading was never the blueprint's.
 *
 * Blind spots, stated in the same breath as the guarantee:
 *   - BODIES ONLY. Query strings, path parameters and headers pass nowhere
 *     near this. `?organization_id=` is T-14a's gate and its scoped fetch.
 *   - NOTHING BINDS A ROUTE TO IT. T-13b made "one DTO per route" measurable
 *     by putting `response` on `RoutePolicy`; the matching `request` field and
 *     its coverage assertion belong to T-14a, which is where a real router
 *     first exists. Until then a handler may still read `req.body` directly,
 *     and no mechanism here stops it. Recorded in `tasks/todo.md`.
 *   - BY KEY. A privilege smuggled under a permitted name — `note:
 *     "role=INTERNAL_ADMIN"` — is invisible here and is the handler's problem.
 *   - `id` is refused at the TOP LEVEL only. §7.2 gives the option an "entity
 *     graph with stable ids… so an edit can name what it edited", so a nested
 *     `id` is legitimate; the identity of the thing the request addresses
 *     comes from the path.
 *   - The snapshot walks own ENUMERABLE properties once. A non-enumerable or
 *     inherited property is not copied, so a declared field hiding there reads
 *     as absent — `required`, not accepted.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { errorEnvelope, type ErrorEnvelope } from './errors.js';
import { isForbiddenClientField } from './forbidden-fields.js';
import {
  SchemaError,
  object,
  validateDetailed,
  type Audience,
  type FieldSchema,
  type ObjectSchema,
  type Problem,
} from './schema.js';

// --------------------------------------------------------------------------
// What the server assigns
// --------------------------------------------------------------------------

/**
 * Suffixes that make a column the server's, whatever it is called.
 *
 * A pattern rather than an enumeration because the failure mode being guarded
 * is the column added next month: `_at` is a clock and `_by` is an actor, and
 * pure code has neither — which is exactly why a body must not supply them.
 * `_hash` is a value the server computes; a client-supplied hash is a forged
 * manifest, which is F-19's shape (a hash with nothing verifying it).
 */
const SERVER_ASSIGNED_SUFFIXES: readonly string[] = Object.freeze(['_at', '_by', '_hash']);

/**
 * Names no suffix catches, each here for a stated reason.
 *
 *   id                           identity is the server's. TOP LEVEL only —
 *                                see the module header on §7.2's option graph
 *   hash                         the bare spelling of the suffix
 *   audience                     client vs internal lineage; T-13b already
 *                                treats it as a leak key on the way out
 *   lifecycle_state              DRAFT/FROZEN is a server transition
 *                                (`0001_init.sql` enforces it in a trigger)
 *   status, request_status       OD-12's client status is derived, never set
 *   actor_type                   the RLS predicate keys on it
 *   is_internal                  the tenant-root privilege bit (§7.2). Setting
 *                                it true on a created org makes a client
 *                                organization the internal one
 *   revision_code, iteration,    the Windchill REVISION.ITERATION scheme is
 *   rev                          assigned, never claimed
 *   actor_organization_id,       audit columns; the audit chain writes them
 *   subject_organization_id
 *   verification_tier            the catalog gate's verdict, not an input
 *   content_sha256               the release manifest's hash. A client-supplied
 *                                hash is a forged manifest (F-19's shape), and
 *                                the `_hash` suffix does not catch this spelling
 *   outcome, severity            the audit chain's verdict and the rules
 *                                engine's grading. Both were found by
 *                                `tools/check-server-owned.mjs` on its first
 *                                run against the real schema, which is the
 *                                whole argument for having it
 *   lease_epoch                  the idempotency fence token. A body that names
 *                                it is a body claiming a lease it was not
 *                                granted, which is the whole thing the fence
 *                                stops
 *   claim_outcome                AD-3's idempotency states. A body that
 *                                names one claims its own intent already
 *                                succeeded — which is a request to skip the
 *                                effect and be told it happened. Found by the
 *                                same checker, on the migration that added the
 *                                column, before the column had a caller
 */
const SERVER_ASSIGNED_NAMES: ReadonlySet<string> = new Set([
  'id',
  'hash',
  'audience',
  'lifecycle_state',
  'status',
  'request_status',
  'actor_type',

  'is_internal',
  'revision_code',
  'iteration',
  'rev',
  'content_sha256',
  'outcome',
  'severity',
  'claim_outcome',
  'lease_epoch',
  'actor_organization_id',
  'subject_organization_id',
  'verification_tier',
]);

/**
 * A declared name reduced to the spelling the schema uses.
 *
 * Postgres identifiers are lower snake_case, so every name the checker can
 * feed the rule is already in that shape — which is exactly why the checker
 * could never have found this: `organizationId` and `lifecycleState` passed
 * the rule untouched, and camelCase is house style for at least one shipped
 * envelope (`pageSize`, `totalItems` in `pagination.ts`). Reviewed round 2.
 */
function normalise(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase();
}

/** The rule `tools/check-server-owned.mjs` runs against every signalled column. */
export function isServerAssignedField(key: string): boolean {
  const name = normalise(key);
  if (SERVER_ASSIGNED_NAMES.has(name)) return true;
  return SERVER_ASSIGNED_SUFFIXES.some((suffix) => name.length > suffix.length && name.endsWith(suffix));
}

/**
 * Fields a CLIENT may not set but staff may.
 *
 * `organization_id` and `role`: tenancy and privilege come from the session
 * for a client, and from the body for the one staff route that issues an
 * invitation into another organization (§8.2, §7.2).
 */
export const CLIENT_ONLY_REFUSED_FIELDS: readonly string[] = Object.freeze(['organization_id', 'role']);

const CLIENT_ONLY_SET: ReadonlySet<string> = new Set(CLIENT_ONLY_REFUSED_FIELDS);

/**
 * Whether a client request body may not declare `key`: server-assigned, or
 * client-only-refused, or a field a client may not SEE.
 *
 * The last clause reuses `FORBIDDEN_CLIENT_FIELDS` rather than copying the
 * price names into a second list — a value a client is not allowed to read
 * back is one it may certainly not write in, and two lists naming the same
 * fields is F-01's shape.
 */
export function isRefusedOnClientBody(key: string): boolean {
  return isRefusedOnInternalBody(key) || CLIENT_ONLY_SET.has(normalise(key));
}

/**
 * Keys refused on an INTERNAL request body: server-assigned, or a field a
 * client may not see.
 *
 * The split is exactly as wide as its justification and no wider. The first
 * revision let an internal body declare the whole forbidden list — `price`,
 * `cost`, `margin`, `supplier` — while the deviation put to EL named only
 * `organization_id` and `role` (review round 2). No MVP-1 staff route needs
 * any of the other 27: the notes route's column is `body`, and catalog
 * ingestion is file-loaded, not routed.
 */
export function isRefusedOnInternalBody(key: string): boolean {
  return isServerAssignedField(key) || isForbiddenClientField(normalise(key));
}

/**
 * Property names that are never a field, on any body, at any depth, because
 * they address the prototype rather than the data. `object()` builds a
 * null-prototype property map, which makes `__proto__` a perfectly legal
 * declared name — and a narrowed body carrying an own `__proto__` sets the
 * prototype of whatever a handler spreads it into.
 */
const RESERVED_PROPERTY_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

// --------------------------------------------------------------------------
// Declaration
// --------------------------------------------------------------------------

/**
 * A named, closed, audience-tagged request body schema.
 *
 * `kind` exists so a `ResponseSchema` is not structurally assignable to this.
 * It is not the security boundary — a cast defeats it — it is the compiler's
 * half. `parseBody`'s WeakSet is the other half.
 */
export interface RequestSchema extends ObjectSchema {
  readonly kind: 'request';
  readonly name: string;
  readonly audience: Audience;
}

/** Every schema this module built. Private, so it cannot be added to. */
const BUILT_HERE = new WeakSet<object>();

/** A client-facing request body: refuses server-assigned, client-only and forbidden keys. */
export function clientRequestBody(
  name: string,
  properties: Readonly<Record<string, FieldSchema>>,
  opts: { readonly optional?: readonly string[] } = {},
): RequestSchema {
  return build('client', name, properties, opts);
}

/** A staff request body: refuses server-assigned keys. See the header on the deviation. */
export function internalRequestBody(
  name: string,
  properties: Readonly<Record<string, FieldSchema>>,
  opts: { readonly optional?: readonly string[] } = {},
): RequestSchema {
  return build('internal', name, properties, opts);
}

function build(
  audience: Audience,
  name: string,
  properties: Readonly<Record<string, FieldSchema>>,
  opts: { readonly optional?: readonly string[] },
): RequestSchema {
  if (name === '') throw new SchemaError('a request body schema must be named');
  if (Object.keys(properties).length === 0) {
    throw new SchemaError(`${name}: a request body schema must declare at least one field`);
  }
  let base: ObjectSchema;
  try {
    base = object(properties, opts);
  } catch (e) {
    throw new SchemaError(`${(e as Error).message.replace(/\{[^}]*\}/, name)}`);
  }
  const complaint = firstAcceptanceViolation(base, '', audience, true);
  if (complaint !== null) throw new SchemaError(`${name}: ${complaint}`);
  const schema: RequestSchema = Object.freeze({ ...base, kind: 'request', name, audience });
  BUILT_HERE.add(schema);
  return schema;
}

/**
 * The first reason a schema may not be accepted, or null. Path notation
 * matches `schema.ts`: `a.b`, `a[]`, `a|1`.
 */
function firstAcceptanceViolation(
  schema: FieldSchema,
  path: string,
  audience: Audience,
  top: boolean,
): string | null {
  // An internal-audience schema embedded in a client body would carry its own
  // audience past every key check. Its declared fields may be clean today; its
  // audience says what it is allowed to grow into. `schema.ts` refuses the
  // mirror case for responses with the same sentence.
  if (audience === 'client' && 'audience' in schema && schema.audience === 'internal') {
    return `'${path}' is an internal-audience schema and cannot be embedded in a client request body`;
  }
  if ('nullable' in schema) return firstAcceptanceViolation(schema.inner, path, audience, false);
  if ('oneOf' in schema) {
    for (const [i, variant] of schema.oneOf.entries()) {
      const hit = firstAcceptanceViolation(variant, `${path}|${i}`, audience, false);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (schema.type === 'array') return firstAcceptanceViolation(schema.items, `${path}[]`, audience, false);
  if (schema.type === 'object') {
    for (const [key, child] of Object.entries(schema.properties)) {
      const here = path === '' ? key : `${path}.${key}`;
      const complaint = whyRefused(key, audience, top);
      if (complaint !== null) return `'${here}' ${complaint}`;
      const hit = firstAcceptanceViolation(child, here, audience, false);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function whyRefused(key: string, audience: Audience, top: boolean): string | null {
  if (RESERVED_PROPERTY_NAMES.has(key)) return 'names the prototype, not a field, and can never be declared';
  if (normalise(key) === 'id') {
    // Nested ids are the option graph's, and legitimate — see the header.
    return top ? 'is the server-assigned identity and comes from the path, not the body' : null;
  }
  if (isServerAssignedField(key)) return 'is server-assigned and cannot be declared on a request body';
  if (isForbiddenClientField(normalise(key))) {
    return 'is on FORBIDDEN_CLIENT_FIELDS and cannot be accepted from a request body';
  }
  if (audience === 'client' && CLIENT_ONLY_SET.has(normalise(key))) {
    return 'is set by the session, never accepted from a client';
  }
  return null;
}

// --------------------------------------------------------------------------
// Parsing
// --------------------------------------------------------------------------

/** One failed field, as the CLIENT is told it: a path and a kind, never a value. */
export interface FieldProblem {
  readonly path: string;
  readonly kind: Problem['kind'];
}

export type BodyResult =
  | { readonly ok: true; readonly body: Readonly<Record<string, unknown>> }
  | {
      readonly ok: false;
      /** Full detail, prose included, for the server's log. Never sent. */
      readonly problems: readonly Problem[];
      /** What goes on the wire. */
      readonly error: ErrorEnvelope;
    };

/** Caps on what a refusal reports back. A body with 400 strays is not 400 lines of envelope. */
const MAX_REPORTED_FIELDS = 20;
const MAX_REPORTED_PATH = 120;

/**
 * Validate a request body and narrow it to its declaration.
 *
 * The envelope carries paths and kinds only. `validate`'s prose can quote the
 * submitted value back — `'x' is not one of a, b` — and the caller already
 * knows what it sent; the server keeps the full text in `problems` for its
 * log. A path is the caller's own key name, so it is capped in length and in
 * number rather than echoed unbounded.
 *
 * Every body problem is `VALIDATION_ERROR` (400), not `UNPROCESSABLE` (422):
 * 422 is for a body that is well-formed and cannot be acted on, and a body
 * that violates its own schema never got that far.
 */
export function parseBody(schema: RequestSchema, value: unknown): BodyResult {
  if (typeof schema !== 'object' || schema === null || !BUILT_HERE.has(schema)) {
    // Not "looks like a request schema" — IS one this module built. A
    // ResponseSchema satisfies every structural test there is.
    throw new SchemaError('parseBody accepts only a schema built by clientRequestBody or internalRequestBody');
  }
  // One read of the body, before anything looks at it twice. A getter or Proxy
  // that answers differently on the second read cannot make validation and
  // narrowing disagree if there is no second read.
  const snapshot = snapshotOf(value);
  const problems = validateDetailed(schema, snapshot);
  if (problems.length > 0) {
    const shown = problems.slice(0, MAX_REPORTED_FIELDS);
    const fields: readonly FieldProblem[] = Object.freeze(
      shown.map((p) => Object.freeze({ path: p.path.slice(0, MAX_REPORTED_PATH), kind: p.kind })),
    );
    const details =
      problems.length > shown.length ? { fields, truncated: problems.length - shown.length } : { fields };
    return Object.freeze({
      ok: false,
      problems,
      error: errorEnvelope(
        'VALIDATION_ERROR',
        `${schema.name}: request body does not match its schema (${problems.length} problem(s))`,
        details,
      ),
    });
  }
  return Object.freeze({ ok: true, body: narrowObject(schema, snapshot) });
}

/**
 * Values a snapshot substitutes for something it will not copy. Each is a
 * symbol, so every declared type rejects it and every undeclared key still
 * reports as `undeclared` — the key is never silently dropped before the
 * validator can complain about it (review round 2).
 */
const UNREADABLE = Symbol('rms.unreadable');
const TOO_DEEP = Symbol('rms.tooDeep');
const CYCLIC = Symbol('rms.cyclic');

/** Deeper than any legitimate body, shallower than the stack. */
const MAX_BODY_DEPTH = 64;

/**
 * A plain-data copy of `value`'s own enumerable properties, taken once.
 *
 * Total: it never throws. A getter that throws, a body nested past
 * `MAX_BODY_DEPTH`, and a genuine cycle each become a sentinel that fails
 * validation, rather than an exception out of `parseBody` or a key that
 * quietly vanished. `seen` is unwound on the way out, so a shared reference
 * appearing twice in a DAG is copied twice and only a real cycle stops.
 * Functions are kept by reference: `typeof` reports `function`, which fails
 * every declared type and is dropped by the narrowing.
 */
function snapshotOf(value: unknown, seen: Set<object> = new Set(), depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_BODY_DEPTH) return TOO_DEEP;
  if (seen.has(value)) return CYCLIC;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (let i = 0; i < value.length; i += 1) out.push(readAndCopy(value, String(i), seen, depth));
      return out;
    }
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) out[key] = readAndCopy(value as object, key, seen, depth);
    return out;
  } finally {
    seen.delete(value);
  }
}

function readAndCopy(source: object, key: string, seen: Set<object>, depth: number): unknown {
  let raw: unknown;
  try {
    raw = (source as Record<string, unknown>)[key];
  } catch {
    return UNREADABLE;
  }
  return snapshotOf(raw, seen, depth + 1);
}

/**
 * A new frozen null-prototype object carrying ONLY the schema's declared keys,
 * recursively, and only where the declared TYPE is satisfied. Total: it never
 * throws, and anything it cannot place is dropped rather than passed through.
 *
 * This is the half of the no-mass-assignment guarantee that does not depend on
 * validation having run — which is why it re-checks scalars instead of copying
 * whatever sat at a scalar position. Deliberately NOT reachable as a "skip
 * validation" flag on `parseBody`: a control with a documented bypass is the
 * shape this project keeps finding hollow. It takes a `RequestSchema` for the
 * same reason `parseBody` does — the sibling function left unbranded is the
 * same hole in a second doorway (review round 2).
 */
export function narrowToDeclared(schema: RequestSchema, value: unknown): Readonly<Record<string, unknown>> {
  if (typeof schema !== 'object' || schema === null || !BUILT_HERE.has(schema)) {
    throw new SchemaError('narrowToDeclared accepts only a schema built by clientRequestBody or internalRequestBody');
  }
  return narrowObject(schema, value);
}

function narrowObject(schema: ObjectSchema, value: unknown): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return Object.freeze(out);
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(record, key)) continue;
    if (record[key] === undefined) continue;
    const narrowed = narrowField(child, record[key]);
    if (narrowed !== undefined) out[key] = narrowed;
  }
  return Object.freeze(out);
}

function narrowField(schema: FieldSchema, value: unknown): unknown {
  if ('nullable' in schema) return value === null ? null : narrowField(schema.inner, value);
  if ('oneOf' in schema) {
    // Exactly one variant matches a validated value. Called without
    // validation, a value matching none narrows away entirely.
    for (const variant of schema.oneOf) {
      if (validateDetailed(variant, value).length === 0) return narrowObject(variant, value);
    }
    return undefined;
  }
  switch (schema.type) {
    case 'array':
      return Array.isArray(value)
        ? Object.freeze(value.map((item) => narrowField(schema.items, item)).filter((item) => item !== undefined))
        : undefined;
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? narrowObject(schema, value)
        : undefined;
    case 'string':
      return typeof value === 'string' ? value : undefined;
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
  }
}
