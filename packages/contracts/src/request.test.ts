import { describe, expect, it } from 'vitest';

import {
  CLIENT_ONLY_REFUSED_FIELDS,
  FORBIDDEN_CLIENT_FIELDS,
  SchemaError,
  array,
  boolean,
  clientRequestBody,
  clientResponse,
  integer,
  internalRequestBody,
  internalResponse,
  isRefusedOnClientBody,
  isRefusedOnInternalBody,
  isServerAssignedField,
  narrowToDeclared,
  nullable,
  number,
  object,
  oneOf,
  parseBody,
  string,
} from './index.js';

/**
 * T-13c: the input half of the audience boundary.
 *
 * The standing review question recorded for this task before it was written —
 * "a body schema never fed an extra key never refuses one" — is why every
 * refusal below is fed the thing it claims to refuse. The first review of the
 * task found the second half of the same lesson: a guard nothing feeds a
 * WRONG SCHEMA never refuses one either, and `parseBody` was binding shipped
 * response DTOs. Both are exercised here.
 */

const facility = clientRequestBody(
  'FacilityInput',
  { name: string(), clear_height_mm: integer(), note: string() },
  { optional: ['note'] },
);

// --------------------------------------------------------------------------
// The rule that decides what the server assigns
// --------------------------------------------------------------------------

describe('isServerAssignedField is a rule, not a list', () => {
  it.each(['created_at', 'frozen_at', 'expires_at', 'password_updated_at'])('claims the clock %s', (k) => {
    expect(isServerAssignedField(k)).toBe(true);
  });

  it.each(['created_by', 'submitted_by', 'invited_by', 'impersonated_by'])('claims the actor %s', (k) => {
    expect(isServerAssignedField(k)).toBe(true);
  });

  it.each(['content_hash', 'manifest_hash', 'token_hash', 'this_hash', 'prev_hash', 'hash'])(
    'claims the computed value %s',
    (k) => {
      expect(isServerAssignedField(k)).toBe(true);
    },
  );

  it.each([
    'id',
    'audience',
    'lifecycle_state',
    'status',
    'request_status',
    'actor_type',
    'is_internal',
    'revision_code',
    'iteration',
    'rev',
    'actor_organization_id',
    'subject_organization_id',
    'verification_tier',
  ])('claims the named column %s', (k) => {
    expect(isServerAssignedField(k)).toBe(true);
  });

  it.each(['name', 'label', 'clear_height_mm', 'unit_ref', 'email', 'body', 'is_selected_for_submission'])(
    'leaves the ordinary field %s alone',
    (k) => {
      expect(isServerAssignedField(k)).toBe(false);
    },
  );

  it('does not treat a bare suffix as a match — the key must have a stem', () => {
    for (const suffix of ['_at', '_by', '_hash']) expect(isServerAssignedField(suffix)).toBe(false);
  });

  it('leaves organization_id and role to the audience rule, not this one', () => {
    expect(isServerAssignedField('organization_id')).toBe(false);
    expect(isServerAssignedField('role')).toBe(false);
  });
});

describe('the two audience predicates differ in exactly one place', () => {
  it('refuses server-assigned keys on both', () => {
    for (const k of ['audience', 'lifecycle_state', 'created_at', 'content_hash', 'is_internal']) {
      expect(isRefusedOnClientBody(k)).toBe(true);
      expect(isRefusedOnInternalBody(k)).toBe(true);
    }
  });

  it('refuses organization_id and role on a client body and permits them on an internal one', () => {
    for (const k of CLIENT_ONLY_REFUSED_FIELDS) {
      expect(isRefusedOnClientBody(k)).toBe(true);
      expect(isRefusedOnInternalBody(k)).toBe(false);
    }
  });

  it('refuses every FORBIDDEN_CLIENT_FIELDS entry on a client body', () => {
    for (const k of FORBIDDEN_CLIENT_FIELDS) expect(isRefusedOnClientBody(k)).toBe(true);
  });

  it('permits an ordinary field on both', () => {
    expect(isRefusedOnClientBody('name')).toBe(false);
    expect(isRefusedOnInternalBody('name')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Declaration time
// --------------------------------------------------------------------------

describe('a client request body refuses to declare what a client may not set', () => {
  it.each(['organization_id', 'role', 'audience', 'lifecycle_state'])(
    "refuses '%s' — the four the acceptance criteria name",
    (field) => {
      expect(() => clientRequestBody('X', { [field]: string() })).toThrow(SchemaError);
      expect(() => clientRequestBody('X', { [field]: string() })).toThrow(field);
    },
  );

  it.each(['price', 'cost', 'unit_cost', 'landed_cost', 'buy_price', 'margin', 'margin_pct', 'discount'])(
    "refuses the price field '%s'",
    (field) => {
      expect(() => clientRequestBody('X', { [field]: integer() })).toThrow(SchemaError);
    },
  );

  it('refuses every forbidden and client-only field, not a sample of them', () => {
    for (const field of [...FORBIDDEN_CLIENT_FIELDS, ...CLIENT_ONLY_REFUSED_FIELDS]) {
      expect(() => clientRequestBody('X', { [field]: string() }), field).toThrow(SchemaError);
    }
  });

  it.each(['__proto__', 'constructor', 'prototype'])("refuses the prototype name '%s' on both audiences", (field) => {
    expect(() => clientRequestBody('X', { [field]: string() })).toThrow(/prototype/);
    expect(() => internalRequestBody('X', { [field]: string() })).toThrow(/prototype/);
  });

  it('accepts a declaration that names none of them', () => {
    expect(() => clientRequestBody('Clean', { name: string(), qty: integer() })).not.toThrow();
  });

  it('refuses an unnamed or empty declaration on both audiences', () => {
    expect(() => clientRequestBody('', { name: string() })).toThrow(SchemaError);
    expect(() => clientRequestBody('X', {})).toThrow(SchemaError);
    expect(() => internalRequestBody('', { name: string() })).toThrow(SchemaError);
    expect(() => internalRequestBody('X', {})).toThrow(SchemaError);
  });

  it("names the schema when object() itself refuses — an optional field that is not a property", () => {
    expect(() => clientRequestBody('Opts', { name: string() }, { optional: ['absent'] })).toThrow(/Opts/);
  });
});

describe('an internal request body may carry what the session cannot supply', () => {
  it('declares organization_id and role — §8.2 POST /api/internal/v1/invitations has no org path parameter', () => {
    expect(() =>
      internalRequestBody('InvitationCreate', {
        organization_id: string(),
        invited_email: string(),
        role: string({ enum: ['CLIENT_USER', 'CLIENT_ADMIN'] }),
      }),
    ).not.toThrow();
  });

  it('still refuses a field a client may not see — the split is only as wide as its justification', () => {
    for (const field of ['internal_note', 'price', 'cost', 'margin', 'supplier', 'bom', 'item_snapshot']) {
      expect(() => internalRequestBody('X', { [field]: string() }), field).toThrow(SchemaError);
    }
  });

  it('still refuses every server-assigned field', () => {
    for (const field of ['audience', 'lifecycle_state', 'id', 'created_at', 'submitted_by', 'content_hash', 'is_internal']) {
      expect(() => internalRequestBody('X', { [field]: string() }), field).toThrow(SchemaError);
    }
  });
});

describe('the refusal reaches every depth a field can hide at', () => {
  it('refuses one nested inside an object', () => {
    expect(() => clientRequestBody('X', { unit: object({ role: string() }) })).toThrow(/unit\.role/);
  });

  it('refuses one inside array items', () => {
    expect(() => clientRequestBody('X', { units: array(object({ audience: string() })) })).toThrow(/units\[\]\.audience/);
  });

  it('refuses one inside a oneOf variant', () => {
    const variants = oneOf([object({ kind: string() }), object({ lifecycle_state: string() })]);
    expect(() => clientRequestBody('X', { body: variants })).toThrow(/lifecycle_state/);
  });

  it('refuses one behind nullable', () => {
    expect(() => clientRequestBody('X', { meta: nullable(object({ margin: integer() })) })).toThrow(/margin/);
  });

  it('refuses one at the bottom of a stack of arrays', () => {
    expect(() => clientRequestBody('X', { g: array(array(array(object({ created_at: string() })))) })).toThrow(
      /g\[\]\[\]\[\]\.created_at/,
    );
  });

  it('accepts a clean oneOf and a clean nullable — the walk is not refusing everything', () => {
    expect(() =>
      clientRequestBody('Ok', {
        body: oneOf([object({ kind: string() }), object({ label: string() })]),
        meta: nullable(object({ note: string() })),
        tags: array(string()),
      }),
    ).not.toThrow();
  });
});

describe("'id' is the server's at the top level and the option graph's below it", () => {
  it('refuses a top-level id — the identity comes from the path', () => {
    expect(() => clientRequestBody('X', { id: string(), label: string() })).toThrow(/id/);
  });

  it('permits a nested id — §7.2: an entity graph with stable ids, so an edit can name what it edited', () => {
    expect(() =>
      clientRequestBody('OptionInput', {
        label: string(),
        runs: array(object({ id: string(), bays: array(object({ id: string(), qty: integer() })) })),
      }),
    ).not.toThrow();
  });

  it('permits an id inside a oneOf variant — a oneOf sits at a property, so its fields are nested', () => {
    expect(() => clientRequestBody('X', { body: oneOf([object({ id: string(), label: string() })]) })).not.toThrow();
  });

  it('still refuses a server-assigned field beside that nested id', () => {
    expect(() => clientRequestBody('X', { body: oneOf([object({ id: string(), audience: string() })]) })).toThrow(
      /audience/,
    );
  });
});

// --------------------------------------------------------------------------
// parseBody binds only a schema this module built
// --------------------------------------------------------------------------

describe('parseBody refuses any schema it did not build', () => {
  it('refuses a shipped internal response DTO that declares all four named fields', () => {
    const revision = internalResponse('Revision', {
      organization_id: string(),
      audience: string({ enum: ['client', 'internal'] }),
      lifecycle_state: string({ enum: ['DRAFT', 'FROZEN'] }),
    });
    expect(() => parseBody(revision as never, { organization_id: 'ATTACKER-ORG' })).toThrow(SchemaError);
  });

  it('refuses a client response schema', () => {
    const project = clientResponse('Project', { name: string() });
    expect(() => parseBody(project as never, { name: 'x' })).toThrow(/only a schema built by/);
  });

  it('refuses a hand-built object that satisfies every structural test', () => {
    const forged = {
      kind: 'request',
      name: 'Forged',
      audience: 'client',
      type: 'object',
      properties: { role: string() },
      required: ['role'],
      additionalProperties: false,
    };
    expect(() => parseBody(forged as never, { role: 'INTERNAL_ADMIN' })).toThrow(SchemaError);
  });

  it('refuses a non-object and null', () => {
    expect(() => parseBody(null as never, {})).toThrow(SchemaError);
    expect(() => parseBody('FacilityInput' as never, {})).toThrow(SchemaError);
  });

  it('accepts the schemas it did build, on both audiences', () => {
    expect(parseBody(facility, { name: 'A', clear_height_mm: 1 }).ok).toBe(true);
    const staff = internalRequestBody('S', { organization_id: string() });
    expect(parseBody(staff, { organization_id: 'org-1' }).ok).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Runtime: the extra key the schema never declared
// --------------------------------------------------------------------------

describe('a body carrying a key its schema does not declare is refused', () => {
  const good = { name: 'Bay A', clear_height_mm: 9144 };

  it('accepts a conforming body', () => {
    expect(parseBody(facility, good).ok).toBe(true);
  });

  it.each(['organization_id', 'role', 'audience', 'lifecycle_state', 'price'])(
    "refuses a body smuggling '%s'",
    (field) => {
      const result = parseBody(facility, { ...good, [field]: 'x' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problems.find((p) => p.path === field)?.kind).toBe('undeclared');
    },
  );

  it('refuses every refused-on-client field fed as an extra key', () => {
    for (const field of [...FORBIDDEN_CLIENT_FIELDS, ...CLIENT_ONLY_REFUSED_FIELDS]) {
      expect(parseBody(facility, { ...good, [field]: 'x' }).ok, field).toBe(false);
    }
  });

  it('refuses an ordinary extra key too — the list is not the boundary, the declaration is', () => {
    expect(parseBody(facility, { ...good, colour: 'red' }).ok).toBe(false);
  });

  it('reports a missing required field and a wrong type with their kinds', () => {
    const result = parseBody(facility, { clear_height_mm: 'tall' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byPath = new Map(result.problems.map((p) => [p.path, p.kind]));
    expect(byPath.get('name')).toBe('required');
    expect(byPath.get('clear_height_mm')).toBe('type');
  });

  it('refuses a body that is not an object at all', () => {
    for (const value of [null, [], 'string', 42]) {
      expect(parseBody(facility, value).ok, JSON.stringify(value)).toBe(false);
    }
  });
});

describe('the body is read once, and only its own enumerable data', () => {
  it('refuses a JSON-parsed __proto__ and pollutes nothing', () => {
    const body = JSON.parse('{"name":"A","clear_height_mm":1,"__proto__":{"polluted":true}}') as unknown;
    expect(parseBody(facility, body).ok).toBe(false);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it("refuses 'constructor' as a stray key", () => {
    expect(parseBody(facility, { name: 'A', clear_height_mm: 1, constructor: 'x' }).ok).toBe(false);
  });

  it('does not read a getter twice, so it cannot answer differently the second time', () => {
    let reads = 0;
    const body = {
      clear_height_mm: 1,
      get name() {
        reads += 1;
        return reads <= 1 ? 'Bay A' : ({ organization_id: 'ATTACKER-ORG' } as unknown as string);
      },
    };
    const result = parseBody(facility, body);
    expect(reads).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body['name']).toBe('Bay A');
  });

  it('treats a non-enumerable declared field as absent rather than accepting it unchecked', () => {
    const body: Record<string, unknown> = { clear_height_mm: 9144 };
    Object.defineProperty(body, 'name', { value: { role: 'INTERNAL_ADMIN' }, enumerable: false });
    const result = parseBody(facility, body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.find((p) => p.path === 'name')?.kind).toBe('required');
  });

  it('reports a function-valued stray as undeclared rather than laundering it away', () => {
    const result = parseBody(facility, { name: 'A', clear_height_mm: 1, toJSON: () => ({}) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.find((p) => p.path === 'toJSON')?.kind).toBe('undeclared');
  });

  it('drops a function at a declared position rather than handing it to a handler', () => {
    const result = parseBody(facility, { name: () => 'A', clear_height_mm: 1 });
    expect(result.ok).toBe(false);
  });

  it('reports an undefined-valued stray as undeclared', () => {
    const result = parseBody(facility, { name: 'A', clear_height_mm: 1, ghost: undefined });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.find((p) => p.path === 'ghost')?.kind).toBe('undeclared');
  });

  it('does not recur forever on a cyclic body, and says so rather than passing it', () => {
    const body: Record<string, unknown> = { name: 'A', clear_height_mm: 1 };
    body['self'] = body;
    const result = parseBody(facility, body);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.find((p) => p.path === 'self')?.kind).toBe('undeclared');
  });

  it('accepts a shared reference appearing twice — a DAG is not a cycle', () => {
    const shared = { label: 'x' };
    const s = clientRequestBody('D', { a: object({ label: string() }), b: object({ label: string() }) });
    const result = parseBody(s, { a: shared, b: shared });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body['b']).toEqual({ label: 'x' });
  });

  it('refuses a body nested past the depth cap instead of overflowing the stack', () => {
    let deep: unknown = 0;
    for (let i = 0; i < 3000; i += 1) deep = [deep];
    const body = JSON.parse(JSON.stringify({ name: 'A', clear_height_mm: 1, junk: deep })) as unknown;
    expect(() => parseBody(facility, body)).not.toThrow();
    expect(parseBody(facility, body).ok).toBe(false);
  });

  it('refuses a throwing getter instead of letting it escape', () => {
    const body = {
      clear_height_mm: 1,
      get name(): string {
        throw new Error('boom');
      },
    };
    expect(() => parseBody(facility, body)).not.toThrow();
    expect(parseBody(facility, body).ok).toBe(false);
  });

  it('ignores an inherited property', () => {
    const body = Object.create({ role: 'INTERNAL_ADMIN' }) as Record<string, unknown>;
    body['name'] = 'A';
    body['clear_height_mm'] = 1;
    const result = parseBody(facility, body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.hasOwn(result.body, 'role')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// No mass assignment: what the handler is handed
// --------------------------------------------------------------------------

describe('the parsed body is a new, narrowed object', () => {
  const good = { name: 'Bay A', clear_height_mm: 9144 };

  it('is not the object that came off the wire', () => {
    const input = { ...good };
    const result = parseBody(facility, input);
    if (!result.ok) return expect.fail('expected ok');
    expect(result.body).not.toBe(input);
    expect({ ...result.body }).toEqual(good);
  });

  it('has a null prototype and is frozen', () => {
    const result = parseBody(facility, good);
    if (!result.ok) return expect.fail('expected ok');
    expect(Object.getPrototypeOf(result.body)).toBeNull();
    expect(Object.isFrozen(result.body)).toBe(true);
  });

  it('does not track later mutation of the input', () => {
    const input: Record<string, unknown> = { ...good };
    const result = parseBody(facility, input);
    if (!result.ok) return expect.fail('expected ok');
    input['name'] = 'changed';
    expect(result.body['name']).toBe('Bay A');
  });

  it('omits an optional field that was absent rather than filling it in', () => {
    const result = parseBody(facility, good);
    if (!result.ok) return expect.fail('expected ok');
    expect(Object.hasOwn(result.body, 'note')).toBe(false);
  });

  it('keeps an optional field that was present', () => {
    const result = parseBody(facility, { ...good, note: 'hi' });
    if (!result.ok) return expect.fail('expected ok');
    expect(result.body['note']).toBe('hi');
  });
});

/**
 * The narrowing on its own, reaching past the refusal to the separate
 * question: if the validator were removed tomorrow, would the object still
 * carry only declared keys, at every depth? Review found the first draft
 * defended only the top level — four mutants (object, array, oneOf, nullable)
 * each survived a green suite.
 */
describe('narrowToDeclared holds without the validator, at every depth', () => {
  it('drops undeclared keys at the top level', () => {
    const out = narrowToDeclared(facility, { name: 'A', clear_height_mm: 1, organization_id: 'o', price: 10 });
    expect(Object.keys(out)).toEqual(['name', 'clear_height_mm']);
  });

  it('drops them inside a nested object', () => {
    const s = clientRequestBody('N', { unit: object({ label: string() }) });
    const out = narrowToDeclared(s, { unit: { label: 'x', role: 'INTERNAL_ADMIN' } });
    expect(out['unit']).toEqual({ label: 'x' });
    expect(Object.keys(out['unit'] as object)).not.toContain('role');
  });

  it('drops them inside array items', () => {
    const s = clientRequestBody('A', { units: array(object({ label: string() })) });
    const out = narrowToDeclared(s, { units: [{ label: 'x', organization_id: 'o' }] });
    expect(out['units']).toEqual([{ label: 'x' }]);
  });

  it('rebuilds the matching oneOf variant rather than passing the value through', () => {
    // A oneOf variant only matches when the keys are exactly the declared set,
    // so no input can make this branch DROP a key. What it must still do is
    // rebuild: a fresh frozen object, not the caller's (review round 2 — the
    // pass-through mutant survived a test that asserted only equality).
    const s = clientRequestBody('O', { body: oneOf([object({ kind: string() }), object({ label: string() })]) });
    const input = { body: { label: 'x' } };
    const out = narrowToDeclared(s, input);
    expect(out['body']).toEqual({ label: 'x' });
    expect(out['body']).not.toBe(input.body);
    expect(Object.isFrozen(out['body'])).toBe(true);
    expect(Object.getPrototypeOf(out['body'])).toBeNull();
  });

  it('narrows away a oneOf that matches no variant rather than passing it through', () => {
    const s = clientRequestBody('O', { body: oneOf([object({ kind: string() })]) });
    expect(Object.hasOwn(narrowToDeclared(s, { body: { nope: 1 } }), 'body')).toBe(false);
  });

  it('drops them behind nullable, and keeps a real null', () => {
    const s = clientRequestBody('Nu', { meta: nullable(object({ label: string() })) });
    expect(narrowToDeclared(s, { meta: { label: 'x', margin: 1 } })['meta']).toEqual({ label: 'x' });
    expect(narrowToDeclared(s, { meta: null })['meta']).toBeNull();
  });

  it('drops a value whose declared scalar type it does not have', () => {
    const s = clientRequestBody('S', { a: string(), b: integer(), c: number(), d: boolean() });
    const out = narrowToDeclared(s, { a: { role: 'x' }, b: 1.5, c: Number.NaN, d: 'true' });
    expect(Object.keys(out)).toEqual([]);
  });

  it('keeps a value that does have its declared scalar type', () => {
    const s = clientRequestBody('S', { a: string(), b: integer(), c: number(), d: boolean() });
    expect({ ...narrowToDeclared(s, { a: 'x', b: 1, c: 1.5, d: true }) }).toEqual({ a: 'x', b: 1, c: 1.5, d: true });
  });

  it('drops a non-array at an array position and a non-object at an object position', () => {
    const s = clientRequestBody('M', { units: array(string()), unit: object({ label: string() }) });
    const out = narrowToDeclared(s, { units: 'not-an-array', unit: [1, 2] });
    expect(Object.keys(out)).toEqual([]);
  });

  it('returns an empty object for a body that is not an object', () => {
    for (const value of [null, 'x', 42, [1]]) expect({ ...narrowToDeclared(facility, value) }).toEqual({});
  });

  it('skips a key present with an undefined value', () => {
    expect(Object.hasOwn(narrowToDeclared(facility, { name: undefined, clear_height_mm: 1 }), 'name')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// What the client is told
// --------------------------------------------------------------------------

describe('the refusal is an error envelope and says nothing extra', () => {
  it('carries VALIDATION_ERROR and the paths that failed', () => {
    const result = parseBody(facility, { name: 'A', clear_height_mm: 1, organization_id: 'org-1' });
    if (result.ok) return expect.fail('expected refusal');
    expect(result.error.error.code).toBe('VALIDATION_ERROR');
    const fields = result.error.error.details?.['fields'] as ReadonlyArray<{ path: string; kind: string }>;
    expect(fields).toContainEqual({ path: 'organization_id', kind: 'undeclared' });
  });

  it('never echoes a submitted value back to the caller', () => {
    const status = clientRequestBody('S', { status_hint: string({ enum: ['a', 'b'] }) });
    const result = parseBody(status, { status_hint: 'sekrit-value' });
    if (result.ok) return expect.fail('expected refusal');
    expect(JSON.stringify(result.error)).not.toContain('sekrit-value');
    expect(result.problems.some((p) => p.message.includes('sekrit-value'))).toBe(true);
  });

  it('caps a stray key name rather than reflecting it unbounded', () => {
    const long = 'x'.repeat(5000);
    const result = parseBody(facility, { name: 'A', clear_height_mm: 1, [long]: 1 });
    if (result.ok) return expect.fail('expected refusal');
    const fields = result.error.error.details?.['fields'] as ReadonlyArray<{ path: string }>;
    expect(fields[0]?.path.length).toBeLessThanOrEqual(120);
  });

  it('caps how many fields it reports and says how many it dropped', () => {
    const body: Record<string, unknown> = { name: 'A', clear_height_mm: 1 };
    for (let i = 0; i < 200; i += 1) body[`stray_${i}`] = i;
    const result = parseBody(facility, body);
    if (result.ok) return expect.fail('expected refusal');
    const details = result.error.error.details as { fields: readonly unknown[]; truncated?: number };
    expect(details.fields).toHaveLength(20);
    expect(details.truncated).toBe(180);
    expect(result.problems).toHaveLength(200);
  });

  it('omits the truncation count when nothing was dropped', () => {
    const result = parseBody(facility, { name: 'A', clear_height_mm: 1, one_stray: 1 });
    if (result.ok) return expect.fail('expected refusal');
    expect(Object.hasOwn(result.error.error.details ?? {}, 'truncated')).toBe(false);
  });
});


// --------------------------------------------------------------------------
// Round-two findings, each with the test that would have caught it
// --------------------------------------------------------------------------

describe('the rule reads a name however it is spelt', () => {
  it.each([
    ['organizationId', 'organization_id'],
    ['lifecycleState', 'lifecycle_state'],
    ['isInternal', 'is_internal'],
    ['actorType', 'actor_type'],
    ['createdAt', 'created_at'],
    ['createdBy', 'created_by'],
    ['contentSha256', 'content_sha256'],
    ['requestStatus', 'request_status'],
    ['revisionCode', 'revision_code'],
    ['verificationTier', 'verification_tier'],
  ])('refuses the camelCase spelling %s alongside %s', (camel) => {
    expect(() => clientRequestBody('X', { [camel]: string() }), camel).toThrow(SchemaError);
  });

  it.each(['Audience', 'ID', 'Lifecycle_State'])('refuses the capitalised spelling %s', (key) => {
    expect(() => clientRequestBody('X', { [key]: string() }), key).toThrow(SchemaError);
  });

  it('refuses a camelCase server-assigned key on an internal body too', () => {
    expect(() => internalRequestBody('X', { lifecycleState: string() })).toThrow(SchemaError);
  });

  it('leaves an ordinary camelCase field alone — the envelope already uses that style', () => {
    expect(() => clientRequestBody('P', { pageSize: integer(), totalItems: integer() })).not.toThrow();
  });

  it('refuses a camelCase key fed as an extra key at runtime', () => {
    expect(parseBody(facility, { name: 'A', clear_height_mm: 1, organizationId: 'o' }).ok).toBe(false);
  });
});

describe('content_sha256 is pinned by name, because no DDL signal reaches it', () => {
  it.each(['content_sha256', 'is_internal', 'outcome', 'severity', 'rev', 'iteration'])(
    'refuses %s on both audiences',
    (field) => {
      expect(() => clientRequestBody('X', { [field]: string() }), field).toThrow(SchemaError);
      expect(() => internalRequestBody('X', { [field]: string() }), field).toThrow(SchemaError);
    },
  );
});

describe('an internal-audience schema cannot be embedded in a client body', () => {
  it('refuses one even when its own declared fields are clean', () => {
    const clean = internalRequestBody('Clean', { label: string() });
    expect(() => clientRequestBody('Outer', { payload: clean })).toThrow(/internal-audience/);
  });

  it('permits a client-audience schema embedded in a client body', () => {
    const inner = clientRequestBody('Inner', { label: string() });
    expect(() => clientRequestBody('Outer', { payload: inner })).not.toThrow();
  });

  it('permits one embedded in an internal body', () => {
    const clean = internalRequestBody('Clean2', { label: string() });
    expect(() => internalRequestBody('Outer2', { payload: clean })).not.toThrow();
  });
});

describe('narrowToDeclared is branded like parseBody, not left open beside it', () => {
  it('refuses a response schema', () => {
    const revision = internalResponse('R', { organization_id: string(), audience: string() });
    expect(() => narrowToDeclared(revision as never, { organization_id: 'org-EVIL' })).toThrow(SchemaError);
  });

  it('refuses a hand-built object and a non-object', () => {
    expect(() => narrowToDeclared({ type: 'object', properties: {}, required: [] } as never, {})).toThrow(SchemaError);
    expect(() => narrowToDeclared(null as never, {})).toThrow(SchemaError);
  });
});
