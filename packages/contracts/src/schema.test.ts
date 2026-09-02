import { describe, expect, it } from 'vitest';

import {
  SchemaError,
  array,
  boolean,
  clientResponse,
  integer,
  internalResponse,
  nullable,
  number,
  object,
  oneOf,
  paginatedResponse,
  string,
  toJsonSchema,
  validate,
  validateDetailed,
} from './index.js';

/**
 * The response schema is the OpenAPI promise in §8.3 — "client-facing response
 * types are declared `additionalProperties: false`" — held as a value the
 * runtime validator reads directly. One object is both the published schema
 * and the thing that checks a response against it, so the two cannot drift.
 */

const project = clientResponse('Project', {
  id: string(),
  number: string(),
  name: string(),
  status: string({ enum: ['active', 'closed'] }),
});

describe('a closed object is closed', () => {
  it('accepts exactly the declared fields', () => {
    expect(validate(project, { id: 'p1', number: '26-0142', name: 'Harbor', status: 'active' })).toEqual([]);
  });

  it('refuses an extra field — additionalProperties is false, always', () => {
    // The leak this exists for: a column added to the entity that nobody
    // named in the DTO. `exclude([...])` would ship it; a closed schema stops it.
    const problems = validate(project, { id: 'p1', number: '26-0142', name: 'Harbor', status: 'active', organization_id: 'org-a' });
    expect(problems).toEqual(['organization_id: not a declared field of Project']);
  });

  it('refuses a missing required field', () => {
    expect(validate(project, { id: 'p1', number: '26-0142', status: 'active' })).toEqual(['name: required']);
  });

  it('refuses the wrong primitive type, naming the path', () => {
    expect(validate(project, { id: 1, number: '26-0142', name: 'Harbor', status: 'active' })).toEqual([
      'id: expected string, got number',
    ]);
  });

  it('refuses a value outside an enum', () => {
    expect(validate(project, { id: 'p1', number: '26-0142', name: 'Harbor', status: 'archived' })).toEqual([
      "status: 'archived' is not one of active, closed",
    ]);
  });

  it('refuses a non-object where an object is declared', () => {
    expect(validate(project, null)).toEqual(['expected object, got null']);
    expect(validate(project, [1])).toEqual(['expected object, got array']);
    expect(validate(project, 'p1')).toEqual(['expected object, got string']);
  });

  it('reports every problem, not the first', () => {
    const problems = validate(project, { id: 1, name: 'Harbor', status: 'active', extra: true });
    expect([...problems].sort()).toEqual(
      ['extra: not a declared field of Project', 'id: expected string, got number', 'number: required'].sort(),
    );
  });
});

describe('the primitive and composite schemas', () => {
  const s = internalResponse('Shape', {
    count: integer(),
    ratio: number(),
    flag: boolean(),
    note: nullable(string()),
    tags: array(string()),
    nested: object({ a: string() }),
    optionalThing: string(),
  }, { optional: ['optionalThing'] });

  it('accepts a well-formed value', () => {
    expect(validate(s, { count: 3, ratio: 0.5, flag: true, note: null, tags: ['x'], nested: { a: 'y' } })).toEqual([]);
    expect(validate(s, { count: 3, ratio: 0.5, flag: false, note: 'n', tags: [], nested: { a: 'y' }, optionalThing: 'z' })).toEqual([]);
  });

  it('an integer must be an integer, a number must be finite', () => {
    expect(validate(s, { count: 1.5, ratio: 0.5, flag: true, note: null, tags: [], nested: { a: 'y' } })).toEqual(['count: expected integer, got 1.5']);
    expect(validate(s, { count: 1, ratio: Number.NaN, flag: true, note: null, tags: [], nested: { a: 'y' } })).toEqual(['ratio: expected number, got NaN']);
    expect(validate(s, { count: 1, ratio: Number.POSITIVE_INFINITY, flag: true, note: null, tags: [], nested: { a: 'y' } })).toEqual(['ratio: expected number, got Infinity']);
  });

  it('a pinned boolean admits only its pin — OAS 3.0\'s spelling of a literal', () => {
    const pinned = internalResponse('Pinned', { watermarked: boolean({ enum: [true] }) });
    expect(validate(pinned, { watermarked: true })).toEqual([]);
    expect(validate(pinned, { watermarked: false })).toEqual(['watermarked: false is not one of true']);
    expect(validate(pinned, { watermarked: 'true' })).toEqual(['watermarked: expected boolean, got string']);
    expect(toJsonSchema(boolean({ enum: [true] }))).toEqual({ type: 'boolean', enum: [true] });
    expect(() => boolean({ enum: [] })).toThrow(/boolean enum needs at least one value/);
  });

  it('a boolean is not a truthy value', () => {
    expect(validate(s, { count: 1, ratio: 0.5, flag: 1, note: null, tags: [], nested: { a: 'y' } })).toEqual(['flag: expected boolean, got number']);
  });

  it('nullable admits null and nothing else outside the inner type', () => {
    expect(validate(s, { count: 1, ratio: 0.5, flag: true, note: 7, tags: [], nested: { a: 'y' } })).toEqual(['note: expected string, got number']);
    // undefined is a MISSING field, which is a different failure from null.
    expect(validate(s, { count: 1, ratio: 0.5, flag: true, tags: [], nested: { a: 'y' } })).toEqual(['note: required']);
  });

  it('array items are validated with their index in the path', () => {
    expect(validate(s, { count: 1, ratio: 0.5, flag: true, note: null, tags: ['ok', 2], nested: { a: 'y' } })).toEqual(['tags[1]: expected string, got number']);
    expect(validate(s, { count: 1, ratio: 0.5, flag: true, note: null, tags: 'ok', nested: { a: 'y' } })).toEqual(['tags: expected array, got string']);
  });

  it('a nested object is closed too, with the path to the stray field', () => {
    expect(validate(s, { count: 1, ratio: 0.5, flag: true, note: null, tags: [], nested: { a: 'y', b: 1 } })).toEqual(['nested.b: not a declared field']);
    expect(validate(s, { count: 1, ratio: 0.5, flag: true, note: null, tags: [], nested: {} })).toEqual(['nested.a: required']);
  });

  it('an optional field may be absent but not undefined-valued or wrong-typed', () => {
    expect(validate(s, { count: 1, ratio: 0.5, flag: true, note: null, tags: [], nested: { a: 'y' }, optionalThing: 3 })).toEqual(['optionalThing: expected string, got number']);
  });

  it('a key present with an undefined value is a missing field, reported once', () => {
    // JSON has no undefined: `{ count: undefined }` serializes as `{}`. The
    // validator judges the wire shape, so this is "required", not "wrong type"
    // — and not both.
    expect(validate(s, { count: undefined, ratio: 0.5, flag: true, note: null, tags: [], nested: { a: 'y' } })).toEqual(['count: required']);
    expect(validate(s, { count: 1, ratio: 0.5, flag: true, note: null, tags: [], nested: { a: 'y' }, optionalThing: undefined })).toEqual([]);
  });

  it('refuses an optional name that is not a declared property', () => {
    expect(() => internalResponse('X', { a: string() }, { optional: ['b'] })).toThrow(SchemaError);
    expect(() => internalResponse('X', { a: string() }, { optional: ['b'] })).toThrow(/optional field 'b' is not a property of X/);
  });
});

describe('oneOf — a closed union of closed objects', () => {
  const item = oneOf([
    object({ kind: string({ enum: ['rect'] }), width: integer() }),
    object({ kind: string({ enum: ['line'] }), length: integer() }),
  ]);
  const s = internalResponse('Drawing', { items: array(item) });

  it('accepts a value matching exactly one variant', () => {
    expect(validate(s, { items: [{ kind: 'rect', width: 3 }, { kind: 'line', length: 9 }] })).toEqual([]);
  });

  it('refuses a value matching no variant, listing each variant\'s complaint, then the closest variant\'s problems at their real paths', () => {
    const problems = validate(s, { items: [{ kind: 'rect', length: 9 }] });
    expect(problems[0]).toMatch(/^items\[0\]: matches none of 2 variants/);
    expect(problems[0]).toContain('width: required');
    expect(problems[0]).toContain("kind: 'rect' is not one of line");
    // The closest variant is LINE here (one complaint, the kind enum, against
    // rect's two), so its problem is what is hoisted — with its real kind and
    // path. `length` is a key the union declares, so it is not undeclared.
    expect(problems.slice(1)).toEqual(["items[0].kind: 'rect' is not one of line"]);
    const detailed = validateDetailed(s, { items: [{ kind: 'rect', length: 9 }] });
    expect(detailed.map((p) => `${p.kind}@${p.path}`)).toEqual(['oneOf@items[0]', 'enum@items[0].kind']);
    // A key NO variant declares is undeclared in every variant, so whichever
    // is closest reports it as undeclared — which is what the guard sorts on.
    const stray = validateDetailed(s, { items: [{ kind: 'rect', width: 3, stray: 1 }] });
    expect(stray.map((p) => `${p.kind}@${p.path}`)).toEqual(['oneOf@items[0]', 'undeclared@items[0].stray']);
  });

  it('hoists an own __proto__ or an innocent stray inside a union position as undeclared', () => {
    const wire = JSON.parse('{"items":[{"kind":"rect","width":3,"__proto__":{"organization_id":"org-a"}}]}') as unknown;
    const kinds = validateDetailed(s, wire).map((p) => `${p.kind}@${p.path}`);
    expect(kinds).toEqual(['oneOf@items[0]', 'undeclared@items[0].__proto__']);
    const stray = validateDetailed(s, { items: [{ kind: 'line', length: 1, created_by: 'staff-7' }] });
    expect(stray.map((p) => `${p.kind}@${p.path}`)).toEqual(['oneOf@items[0]', 'undeclared@items[0].created_by']);
  });

  it('picks the first variant on a tie', () => {
    const tie = internalResponse('Tie', { v: oneOf([object({ a: string() }), object({ b: string() })]) });
    const detailed = validateDetailed(tie, { v: {} });
    expect(detailed.map((p) => `${p.kind}@${p.path}`)).toEqual(['oneOf@v', 'required@v.a']);
  });

  it('refuses an empty union — a oneOf of nothing matches nothing and says so at declaration', () => {
    expect(() => oneOf([])).toThrow(/oneOf needs at least one variant/);
  });

  it('validates a bare closed object too, without a name in the message', () => {
    expect(validate(object({ a: string() }), { a: 'x', b: 1 })).toEqual(['b: not a declared field']);
    expect(validate(object({ a: string(), n: integer() }), { n: 'x' })).toEqual(['n: expected integer, got string', 'a: required']);
  });

  it('refuses a value matching more than one variant — an ambiguous union is a schema bug', () => {
    const loose = internalResponse('Loose', { v: oneOf([object({ a: string() }), object({ a: string() })]) });
    expect(validate(loose, { v: { a: 'x' } })).toEqual(['v: matches 2 variants; a oneOf must match exactly one']);
  });
});

describe('closed means closed for prototype-named keys too', () => {
  // The review plant (T-13b, R-12): `properties['constructor']` on a plain
  // object is Object.prototype.constructor — truthy, not undefined — so a
  // key named after any prototype member walked straight through the first
  // draft's "not a declared field" check. And JSON.parse creates an OWN
  // `__proto__` key, which is exactly how a wire payload would spell it.
  it('refuses constructor, hasOwnProperty and friends as stray keys', () => {
    expect(validate(project, { id: 'p1', number: '1', name: 'n', status: 'active', constructor: 'x' })).toEqual([
      'constructor: not a declared field of Project',
    ]);
    expect(validate(project, { id: 'p1', number: '1', name: 'n', status: 'active', hasOwnProperty: { organization_id: 'org-a' } })).toEqual([
      'hasOwnProperty: not a declared field of Project',
    ]);
  });

  it('refuses an own __proto__ key as JSON.parse creates it', () => {
    const wire = JSON.parse('{"id":"p1","number":"1","name":"n","status":"active","__proto__":{"organization_id":"org-a"}}') as unknown;
    expect(validate(project, wire)).toEqual(['__proto__: not a declared field of Project']);
  });

  it('a required field named after a prototype member must actually be present', () => {
    const s = internalResponse('Odd', { constructor: string(), toString: string() });
    expect(validate(s, {})).toEqual(['constructor: required', 'toString: required']);
    expect(validate(s, { constructor: 'a', toString: 'b' })).toEqual([]);
  });
});

describe('the pagination envelope is a response schema like any other', () => {
  it('wraps a client item as a client response, in the T-13a envelope\'s own field names', () => {
    const page = paginatedResponse('ProjectPage', project);
    expect(page.audience).toBe('client');
    expect(page.name).toBe('ProjectPage');
    expect(validate(page, { data: [{ id: 'p1', number: '1', name: 'n', status: 'active' }], pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } })).toEqual([]);
    expect(validate(page, { data: [{ id: 'p1', number: '1', name: 'n', status: 'active', cost: 1 }], pagination: { page: 1, pageSize: 25, totalItems: 1, totalPages: 1 } })).toEqual([
      'data[0].cost: not a declared field',
    ]);
    expect(validate(page, { data: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0, cursor: 'x' } })).toEqual([
      'pagination.cursor: not a declared field',
    ]);
  });

  it('wraps an internal item as an internal response', () => {
    expect(paginatedResponse('QueuePage', internalResponse('Q', { id: string() })).audience).toBe('internal');
  });

  it('goes through the client constructor, so an item that somehow carries a forbidden key is still refused', () => {
    // Cannot happen with a real client item (it was refused at its own
    // declaration); shown with a hand-built object smuggled past the type.
    const smuggled = { ...object({ id: string(), price: number() }), name: 'X', audience: 'client' } as unknown as Parameters<typeof paginatedResponse>[1];
    expect(() => paginatedResponse('Bad', smuggled)).toThrow(/'data\[\]\.price' is on FORBIDDEN_CLIENT_FIELDS/);
  });
});

describe('the client audience refuses a forbidden field at declaration time', () => {
  it('a top-level forbidden property throws when the schema is built, not when a response ships', () => {
    // This is T-13b's stated verification: "add `cost` to a client DTO, confirm red".
    expect(() => clientResponse('Bad', { id: string(), cost: number() })).toThrow(SchemaError);
    expect(() => clientResponse('Bad', { id: string(), cost: number() })).toThrow(
      /Bad: 'cost' is on FORBIDDEN_CLIENT_FIELDS and cannot be declared on a client response/,
    );
  });

  it('a nested forbidden property is found at any depth, with its path', () => {
    expect(() =>
      clientResponse('Bad', { lines: array(object({ id: string(), item_snapshot: object({ mpn: string() }) })) }),
    ).toThrow(/Bad: 'lines\[\]\.item_snapshot' is on FORBIDDEN_CLIENT_FIELDS/);
    expect(() =>
      clientResponse('Bad', { v: oneOf([object({ a: string() }), object({ margin: number() })]) }),
    ).toThrow(/Bad: 'v\|1\.margin' is on FORBIDDEN_CLIENT_FIELDS/);
    expect(() => clientResponse('Bad', { n: nullable(object({ supplier: string() })) })).toThrow(
      /Bad: 'n\.supplier' is on FORBIDDEN_CLIENT_FIELDS/,
    );
  });

  it('the internal audience may declare the same field — that is what the audience split is for', () => {
    expect(() => internalResponse('Fine', { id: string(), cost: number() })).not.toThrow();
  });

  it('an internal-audience schema cannot be embedded in a client response, even when its fields are clean today', () => {
    const staffOnly = internalResponse('StaffOnly', { id: string() });
    expect(() => clientResponse('Bad', { id: string(), detail: staffOnly })).toThrow(
      /Bad: 'detail' is an internal-audience schema and cannot be embedded in a client response/,
    );
    expect(() => clientResponse('Bad', { rows: array(staffOnly) })).toThrow(/'rows\[\]' is an internal-audience schema/);
    // The other direction is fine: a client schema is safe for staff by definition.
    expect(() => internalResponse('Ok', { item: project })).not.toThrow();
  });

  it('an empty client response is refused — a schema with no fields validates nothing', () => {
    expect(() => clientResponse('Empty', {})).toThrow(/Empty: a response schema must declare at least one field/);
  });

  it('a schema name is required', () => {
    expect(() => clientResponse('', { id: string() })).toThrow(/a response schema must be named/);
  });
});

describe('the published form is the same object', () => {
  it('emits JSON Schema with additionalProperties: false on every object, closed at every depth', () => {
    const s = clientResponse('Preview', {
      counts: object({ gross: integer(), net: integer() }),
      findings: array(object({ code: string(), severity: string({ enum: ['PASS', 'BLOCKER'] }) })),
      note: nullable(string()),
      shape: oneOf([object({ kind: string({ enum: ['a'] }) }), object({ kind: string({ enum: ['b'] }), n: number() })]),
      maybe: boolean(),
    }, { optional: ['maybe'] });

    expect(toJsonSchema(s)).toEqual({
      title: 'Preview',
      type: 'object',
      additionalProperties: false,
      required: ['counts', 'findings', 'note', 'shape'],
      properties: {
        counts: {
          type: 'object',
          additionalProperties: false,
          required: ['gross', 'net'],
          properties: { gross: { type: 'integer' }, net: { type: 'integer' } },
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['code', 'severity'],
            properties: { code: { type: 'string' }, severity: { type: 'string', enum: ['PASS', 'BLOCKER'] } },
          },
        },
        note: { type: 'string', nullable: true },
        shape: {
          oneOf: [
            { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { type: 'string', enum: ['a'] } } },
            {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'n'],
              properties: { kind: { type: 'string', enum: ['b'] }, n: { type: 'number' } },
            },
          ],
        },
        maybe: { type: 'boolean' },
      },
    });
  });

  it('emits a bare field schema without a title — a component, not a response', () => {
    expect(toJsonSchema(array(nullable(integer())))).toEqual({ type: 'array', items: { type: 'integer', nullable: true } });
  });

  it('omits `required` on an all-optional object — draft-04 and OAS 3.0 refuse an empty list', () => {
    expect(toJsonSchema(object({ a: string() }, { optional: ['a'] }))).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'string' } },
    });
  });

  it('refuses the two nullable forms the document cannot express or does not need', () => {
    // OpenAPI 3.0's `nullable` applies only beside a `type`; on a oneOf the
    // document would forbid null while validate() accepted it.
    expect(() => nullable(oneOf([object({ a: string() })]))).toThrow(/nullable\(oneOf\) cannot be expressed in OpenAPI 3\.0/);
    expect(() => nullable(nullable(string()))).toThrow(/redundant/);
  });

  it('carries the audience, so a document generator can file it under the right namespace', () => {
    expect(project.audience).toBe('client');
    expect(internalResponse('Q', { id: string() }).audience).toBe('internal');
    expect(project.name).toBe('Project');
  });

  it('is frozen — the contract is not a scratch buffer', () => {
    expect(Object.isFrozen(project)).toBe(true);
    expect(Object.isFrozen(project.properties)).toBe(true);
    expect(Object.isFrozen(toJsonSchema(project))).toBe(true);
  });
});
