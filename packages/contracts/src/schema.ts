/**
 * Closed response schemas — the OpenAPI promise held as a value.
 *
 * Blueprint §8.3: "client-facing response types are declared
 * `additionalProperties: false` in the OpenAPI schema and validated at
 * runtime". The usual way to keep that promise is two artifacts — a schema file
 * somebody publishes and a validator somebody configures — and two artifacts
 * drift. Here there is one: the schema is a plain frozen object, `validate`
 * reads it directly, and `toJsonSchema` emits it for the document. What the
 * validator enforces and what the document says are the same thing by
 * construction, not by review.
 *
 * Every object is closed. There is no way to declare an open one, because an
 * open object is `exclude([...])` in another spelling: allow-by-default, and it
 * ships the next column someone adds.
 *
 * A CLIENT response refuses to be declared at all if any property, at any
 * depth, is on `FORBIDDEN_CLIENT_FIELDS`. That moves the leak from "caught when
 * a response ships" to "caught when the module loads" — the test suite goes red
 * on the line that declared the field, which is T-13b's stated verification.
 *
 * Deliberately a small subset of JSON Schema: string (with enum), number,
 * integer, boolean, nullable, array, closed object, and oneOf over closed
 * objects. Anything the subset cannot say is a review point, not a silent
 * loosening — the same reasoning as the display list's closed item union.
 *
 * Pure: no I/O, no clock, no RNG.
 */

import { isForbiddenClientField } from './forbidden-fields.js';

export class SchemaError extends Error {
  override readonly name = 'SchemaError';
}

export type StringSchema = { readonly type: 'string'; readonly enum?: readonly string[] };
export type NumberSchema = { readonly type: 'number' };
export type IntegerSchema = { readonly type: 'integer' };
export type BooleanSchema = { readonly type: 'boolean'; readonly enum?: readonly boolean[] };
export type ArraySchema = { readonly type: 'array'; readonly items: FieldSchema };
export type ObjectSchema = {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, FieldSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};
export type OneOfSchema = { readonly oneOf: readonly ObjectSchema[] };
export type NullableSchema = { readonly nullable: true; readonly inner: FieldSchema };

export type FieldSchema =
  | StringSchema
  | NumberSchema
  | IntegerSchema
  | BooleanSchema
  | ArraySchema
  | ObjectSchema
  | OneOfSchema
  | NullableSchema;

export type Audience = 'client' | 'internal';

/** A named, audience-tagged closed object: the shape of one route's response. */
export interface ResponseSchema extends ObjectSchema {
  readonly name: string;
  readonly audience: Audience;
}

// --------------------------------------------------------------------------
// Builders
// --------------------------------------------------------------------------

export function string(opts: { readonly enum?: readonly string[] } = {}): StringSchema {
  return Object.freeze(opts.enum ? { type: 'string', enum: Object.freeze([...opts.enum]) } : { type: 'string' });
}
export function number(): NumberSchema {
  return Object.freeze({ type: 'number' });
}
export function integer(): IntegerSchema {
  return Object.freeze({ type: 'integer' });
}
/** A boolean, optionally pinned: `boolean({ enum: [true] })` is OAS 3.0's spelling of a literal. */
export function boolean(opts: { readonly enum?: readonly boolean[] } = {}): BooleanSchema {
  if (opts.enum !== undefined && opts.enum.length === 0) throw new SchemaError('boolean enum needs at least one value');
  return Object.freeze(opts.enum ? { type: 'boolean', enum: Object.freeze([...opts.enum]) } : { type: 'boolean' });
}
export function array(items: FieldSchema): ArraySchema {
  return Object.freeze({ type: 'array', items });
}
export function nullable(inner: FieldSchema): NullableSchema {
  // OpenAPI 3.0 applies `nullable` only beside a `type`; a nullable oneOf
  // would validate null here and forbid it in the document. Refused rather
  // than published wrong.
  if ('oneOf' in inner) throw new SchemaError('nullable(oneOf) cannot be expressed in OpenAPI 3.0 — wrap the variants instead');
  if ('nullable' in inner) throw new SchemaError('nullable(nullable(...)) is redundant');
  return Object.freeze({ nullable: true, inner });
}
export function oneOf(variants: readonly ObjectSchema[]): OneOfSchema {
  if (variants.length === 0) throw new SchemaError('oneOf needs at least one variant');
  return Object.freeze({ oneOf: Object.freeze([...variants]) });
}

/**
 * A closed object. Every declared property is required unless named in
 * `optional`; an optional property may be ABSENT, never present-and-wrong.
 */
export function object(
  properties: Readonly<Record<string, FieldSchema>>,
  opts: { readonly optional?: readonly string[] } = {},
): ObjectSchema {
  const optional = new Set(opts.optional ?? []);
  const names = Object.keys(properties);
  for (const name of optional) {
    if (!names.includes(name)) {
      throw new SchemaError(`optional field '${name}' is not a property of ${describe(names)}`);
    }
  }
  // A null-prototype map: `properties['constructor']` must be undefined, not
  // Object.prototype.constructor, or the object is open for every key a
  // prototype happens to carry.
  return Object.freeze({
    type: 'object',
    properties: Object.freeze(Object.assign(Object.create(null) as Record<string, FieldSchema>, properties)),
    required: Object.freeze(names.filter((n) => !optional.has(n))),
    additionalProperties: false,
  });
}

function describe(names: readonly string[]): string {
  return `{${names.join(', ')}}`;
}

/**
 * A client-facing response. Refuses, at declaration, any property on the
 * forbidden list at any depth — see the module header for why the refusal
 * belongs here and not at send time.
 */
export function clientResponse(
  name: string,
  properties: Readonly<Record<string, FieldSchema>>,
  opts: { readonly optional?: readonly string[] } = {},
): ResponseSchema {
  return response('client', name, properties, opts);
}

/** An internal (staff) response. Closed like every object; may carry the internal fields. */
export function internalResponse(
  name: string,
  properties: Readonly<Record<string, FieldSchema>>,
  opts: { readonly optional?: readonly string[] } = {},
): ResponseSchema {
  return response('internal', name, properties, opts);
}

function response(
  audience: Audience,
  name: string,
  properties: Readonly<Record<string, FieldSchema>>,
  opts: { readonly optional?: readonly string[] },
): ResponseSchema {
  if (name === '') throw new SchemaError('a response schema must be named');
  if (Object.keys(properties).length === 0) {
    throw new SchemaError(`${name}: a response schema must declare at least one field`);
  }
  let base: ObjectSchema;
  try {
    base = object(properties, opts);
  } catch (e) {
    // Re-raise with the schema's name in front, so the message says WHICH one.
    throw new SchemaError(`${(e as Error).message.replace(/\{[^}]*\}/, name)}`);
  }
  if (audience === 'client') {
    const complaint = firstClientViolation(base, '');
    if (complaint !== null) throw new SchemaError(`${name}: ${complaint}`);
  }
  return Object.freeze({ ...base, name, audience });
}

/**
 * The first reason a schema may not be published to a client, or null.
 * Path notation: `a.b` for properties, `a[]` for array items, `a|1` for oneOf variant 1.
 */
function firstClientViolation(schema: FieldSchema, path: string): string | null {
  // An internal-audience response embedded as a field of a client one would
  // carry its audience tag past every key check. Its declared fields may be
  // clean today; its audience says what it is allowed to grow into.
  if ('audience' in schema && schema.audience === 'internal') {
    return `'${path}' is an internal-audience schema and cannot be embedded in a client response`;
  }
  if ('nullable' in schema) return firstClientViolation(schema.inner, path);
  if ('oneOf' in schema) {
    for (const [i, variant] of schema.oneOf.entries()) {
      const hit = firstClientViolation(variant, `${path}|${i}`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (schema.type === 'array') return firstClientViolation(schema.items, `${path}[]`);
  if (schema.type === 'object') {
    for (const [key, child] of Object.entries(schema.properties)) {
      const here = path === '' ? key : `${path}.${key}`;
      if (isForbiddenClientField(key)) {
        return `'${here}' is on FORBIDDEN_CLIENT_FIELDS and cannot be declared on a client response`;
      }
      const hit = firstClientViolation(child, here);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/**
 * The AD-4 pagination envelope around an item schema, as one response schema.
 * The audience is the item's: a list of client items is a client response,
 * and the envelope itself goes through `clientResponse` so the forbidden walk
 * and the registry see it — a hand-built wrapper outside `clientResponse`
 * would be the one object every list shares that nothing checks.
 *
 * Field names follow `@rms/contracts`' `Paginated<T>` (T-13a) verbatim, so the
 * envelope on the wire is the one `paginate()` builds.
 */
export function paginatedResponse(name: string, item: ResponseSchema): ResponseSchema {
  const properties = {
    data: array(item),
    pagination: object({ page: integer(), pageSize: integer(), totalItems: integer(), totalPages: integer() }),
  };
  return item.audience === 'client' ? clientResponse(name, properties) : internalResponse(name, properties);
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

export type ProblemKind = 'undeclared' | 'required' | 'type' | 'enum' | 'oneOf';

/** One way a value fails its schema, with the failure's kind kept separate from its prose. */
export interface Problem {
  readonly path: string;
  readonly kind: ProblemKind;
  /** `path: reason`, as `validate` reports it. */
  readonly message: string;
}

/**
 * Every way `value` fails `schema`, as `path: reason` strings. Empty means it
 * conforms. Reports all problems rather than the first: a response with three
 * strays is fixed in one round, not three.
 */
export function validate(schema: ObjectSchema | ResponseSchema, value: unknown): readonly string[] {
  return Object.freeze(validateDetailed(schema, value).map((p) => p.message));
}

/** The same problems with their kind attached — what the outbound guard sorts on. */
export function validateDetailed(schema: ObjectSchema | ResponseSchema, value: unknown): readonly Problem[] {
  const problems: Problem[] = [];
  const label = 'name' in schema ? schema.name : null;
  checkObject(schema, value, '', label, problems);
  return Object.freeze(problems);
}

function push(problems: Problem[], path: string, kind: ProblemKind, reason: string): void {
  problems.push(Object.freeze({ path, kind, message: path === '' ? reason : `${path}: ${reason}` }));
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
  return typeof value;
}

function checkObject(
  schema: ObjectSchema,
  value: unknown,
  path: string,
  label: string | null,
  problems: Problem[],
): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    push(problems, path, 'type', `expected object, got ${kindOf(value)}`);
    return;
  }
  const record = value as Record<string, unknown>;
  const required = new Set(schema.required);

  for (const key of Object.keys(record)) {
    const here = path === '' ? key : `${path}.${key}`;
    // Own keys only, on both sides. `schema.properties` is a null-prototype
    // map, but a schema built by hand might not be; `record` came off the
    // wire, where JSON.parse creates an own `__proto__` key.
    const child = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (child === undefined) {
      push(problems, here, 'undeclared', `not a declared field${label === null ? '' : ` of ${label}`}`);
      continue;
    }
    if (record[key] === undefined) {
      // A key present with an undefined value is a missing field in JSON terms.
      if (required.has(key)) push(problems, here, 'required', 'required');
      continue;
    }
    checkField(child, record[key], here, problems);
  }
  for (const key of schema.required) {
    if (!Object.hasOwn(record, key)) push(problems, path === '' ? key : `${path}.${key}`, 'required', 'required');
  }
}

function checkField(schema: FieldSchema, value: unknown, path: string, problems: Problem[]): void {
  if ('nullable' in schema) {
    if (value === null) return;
    checkField(schema.inner, value, path, problems);
    return;
  }
  if ('oneOf' in schema) {
    checkOneOf(schema, value, path, problems);
    return;
  }
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') {
        push(problems, path, 'type', `expected string, got ${kindOf(value)}`);
      } else if (schema.enum && !schema.enum.includes(value)) {
        push(problems, path, 'enum', `'${value}' is not one of ${schema.enum.join(', ')}`);
      }
      return;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        push(problems, path, 'type', `expected number, got ${kindOf(value)}`);
      }
      return;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        push(problems, path, 'type', `expected integer, got ${typeof value === 'number' ? String(value) : kindOf(value)}`);
      }
      return;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        push(problems, path, 'type', `expected boolean, got ${kindOf(value)}`);
      } else if (schema.enum && !schema.enum.includes(value)) {
        push(problems, path, 'enum', `${String(value)} is not one of ${schema.enum.map(String).join(', ')}`);
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        push(problems, path, 'type', `expected array, got ${kindOf(value)}`);
        return;
      }
      value.forEach((item, i) => checkField(schema.items, item, `${path}[${i}]`, problems));
      return;
    }
    case 'object': {
      checkObject(schema, value, path, null, problems);
      return;
    }
  }
}

function checkOneOf(schema: OneOfSchema, value: unknown, path: string, problems: Problem[]): void {
  const complaints: Problem[][] = [];
  let matches = 0;
  for (const variant of schema.oneOf) {
    const own: Problem[] = [];
    checkObject(variant, value, '', null, own);
    if (own.length === 0) matches += 1;
    complaints.push(own);
  }
  if (matches === 1) return;
  if (matches > 1) {
    push(problems, path, 'oneOf', `matches ${matches} variants; a oneOf must match exactly one`);
    return;
  }
  const detail = complaints.map((c, i) => `variant ${i}: ${c.map((p) => p.message).join('; ')}`).join(' / ');
  push(problems, path, 'oneOf', `matches none of ${schema.oneOf.length} variants — ${detail}`);

  // The summary above swallows every kind into 'oneOf'. The outbound guard
  // sorts on kind, so an undeclared key inside a union position — the display
  // list, the finding parameters — would read as drift and ship in alert
  // mode (T-13b review, round two). Re-run the CLOSEST variant (fewest
  // complaints, first on ties) against the real path so its problems land
  // with their real kinds. The conservative direction: a key the closest
  // shape did not declare is reported as undeclared, never as drift.
  // `complaints[i]` exists for every variant — both arrays were built in the
  // same loop — so the pair is walked together rather than by index.
  let closest: ObjectSchema = schema.oneOf[0] as ObjectSchema; // oneOf() refuses an empty list
  let fewest = Number.POSITIVE_INFINITY;
  schema.oneOf.forEach((variant, i) => {
    const count = (complaints[i] as Problem[]).length;
    if (count < fewest) {
      fewest = count;
      closest = variant;
    }
  });
  checkObject(closest, value, path, null, problems);
}

// --------------------------------------------------------------------------
// The published form
// --------------------------------------------------------------------------

export type JsonSchema = Readonly<Record<string, unknown>>;

/**
 * The same schema as a JSON Schema / OpenAPI 3.0 object. `nullable: true` is
 * the OpenAPI 3.0 spelling; every object carries `additionalProperties: false`
 * because there is no other kind.
 */
export function toJsonSchema(schema: FieldSchema | ResponseSchema): JsonSchema {
  const out = emit(schema);
  if ('name' in schema) return Object.freeze({ title: schema.name, ...out });
  return out;
}

function emit(schema: FieldSchema): JsonSchema {
  if ('nullable' in schema) return Object.freeze({ ...emit(schema.inner), nullable: true });
  if ('oneOf' in schema) return Object.freeze({ oneOf: Object.freeze(schema.oneOf.map(emit)) });
  switch (schema.type) {
    case 'string':
      return Object.freeze(schema.enum ? { type: 'string', enum: [...schema.enum] } : { type: 'string' });
    case 'boolean':
      return Object.freeze(schema.enum ? { type: 'boolean', enum: [...schema.enum] } : { type: 'boolean' });
    case 'number':
    case 'integer':
      return Object.freeze({ type: schema.type });
    case 'array':
      return Object.freeze({ type: 'array', items: emit(schema.items) });
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      for (const [key, child] of Object.entries(schema.properties)) properties[key] = emit(child);
      // `required` MUST be non-empty in JSON Schema draft-04 / OAS 3.0; an
      // all-optional object omits it rather than publishing `[]`.
      return Object.freeze(
        schema.required.length === 0
          ? { type: 'object', additionalProperties: false, properties: Object.freeze(properties) }
          : { type: 'object', additionalProperties: false, required: [...schema.required], properties: Object.freeze(properties) },
      );
    }
  }
}
