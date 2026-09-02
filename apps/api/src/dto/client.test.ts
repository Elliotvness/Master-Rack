import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_CLIENT_FIELDS,
  findForbiddenFields,
  isForbiddenClientField,
  redactForLog,
  toFindingClientDTO,
  toProjectClientDTO,
} from '../index.js';

describe('AC-02 — the forbidden-field constant', () => {
  it('covers every field marked Hidden in §9.2', () => {
    // The blueprint's explicit list. If §9.2 grows a Hidden row, this fails
    // until the constant is updated — which is the point.
    const required = [
      'cost', 'unit_cost', 'landed_cost', 'buy_price', 'price', 'margin',
      'margin_pct', 'discount', 'supplier', 'supplier_id', 'mpn',
      'manufacturer_part_number', 'bom', 'bom_line', 'item_snapshot', 'capacity',
      'capacity_case', 'catalog_release', 'source_document', 'page_ref',
      'catalog_page_ref', 'digitised_by', 'approved_by', 'citation',
      'verification_tier', 'rule_id', 'internal_note',
    ];
    for (const field of required) {
      expect(isForbiddenClientField(field)).toBe(true);
    }
    expect(FORBIDDEN_CLIENT_FIELDS).toHaveLength(required.length);
  });
});

describe('findForbiddenFields walks every nesting depth', () => {
  it('finds a forbidden key at the top level', () => {
    expect(findForbiddenFields({ price: 10 })).toEqual(['price']);
  });

  it('finds one nested in an object', () => {
    expect(findForbiddenFields({ a: { b: { margin: 0.2 } } })).toEqual(['a.b.margin']);
  });

  it('finds one nested in an array', () => {
    expect(findForbiddenFields({ lines: [{ ok: 1 }, { cost: 5 }] })).toEqual(['lines[1].cost']);
  });

  it('finds several at once', () => {
    // Copied before sorting: the result is frozen since the walk moved to
    // @rms/contracts, so a caller cannot reorder the shared array in place.
    const hits = findForbiddenFields({ price: 1, item: { supplier: 'x', bom_line: {} } });
    expect([...hits].sort()).toEqual(['item.bom_line', 'item.supplier', 'price'].sort());
  });

  it('returns a frozen result — a leak report is not a scratch buffer', () => {
    const hits = findForbiddenFields({ price: 1 });
    expect(Object.isFrozen(hits)).toBe(true);
  });

  it('returns empty for a clean object', () => {
    expect(findForbiddenFields({ id: '1', name: 'ok', nested: { count: 4 } })).toEqual([]);
  });

  it('terminates on a cycle', () => {
    const cyclic: Record<string, unknown> = { ok: 1 };
    cyclic['self'] = cyclic;
    expect(findForbiddenFields(cyclic)).toEqual([]);
  });

  it('ignores primitives and null', () => {
    expect(findForbiddenFields(null)).toEqual([]);
    expect(findForbiddenFields(42)).toEqual([]);
    expect(findForbiddenFields('price')).toEqual([]); // a value, not a key
  });
});

describe('client DTOs are built field by field, never spread', () => {
  it('a project DTO drops organization_id and any extra column', () => {
    const dto = toProjectClientDTO({
      id: 'p1',
      number: '26-0142',
      name: 'Harbor',
      status: 'active',
      organization_id: 'org-a',
      // A column added later. Spreading would ship it; naming fields does not.
      internal_note: 'do not show this',
      margin_pct: 0.3,
    });
    expect(dto).toEqual({ id: 'p1', number: '26-0142', name: 'Harbor', status: 'active' });
    expect(findForbiddenFields(dto)).toEqual([]);
  });

  it('a finding DTO shows severity and closed_by but never the citation or tier', () => {
    const dto = toFindingClientDTO({
      code: 'AISLE_CLEAR_SHORTFALL',
      severity: 'BLOCKER',
      closed_by: 'widen the aisle to the stated equipment requirement',
      subject_object_ids: [],
      parameters: [],
      rule_id: 'RULE-AISLE-01',
      citation: 'NFPA 13 §x',
      verification_tier: 'SECONDARY',
    });
    // T-13b widened this to §11.3's client shape: subjects and parameters are
    // client-facing; the citation and tier still are not.
    expect(dto).toEqual({
      code: 'AISLE_CLEAR_SHORTFALL',
      severity: 'BLOCKER',
      subject_object_ids: [],
      parameters: [],
      closed_by: 'widen the aisle to the stated equipment requirement',
    });
    expect(findForbiddenFields(dto)).toEqual([]);
  });
});

describe('the contract test catches a real leak', () => {
  it('would fail if a DTO builder let a forbidden field through', () => {
    // Simulate a regression: someone spreads the entity into the DTO.
    const leaky = { id: 'p1', name: 'Harbor', margin_pct: 0.3, item_snapshot: { mpn: 'X' } };
    const hits = findForbiddenFields(leaky);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain('margin_pct');
    // And it catches the field nested inside item_snapshot too.
    expect(hits).toContain('item_snapshot');
  });
});

describe('log redaction uses the same constant', () => {
  it('redacts forbidden fields at every depth without mutating the input', () => {
    const input = { id: '1', price: 10, nested: { supplier: 'x', ok: 2 }, list: [{ cost: 3 }] };
    const redacted = redactForLog(input) as Record<string, unknown>;

    expect(redacted['price']).toBe('[REDACTED]');
    expect((redacted['nested'] as Record<string, unknown>)['supplier']).toBe('[REDACTED]');
    expect((redacted['nested'] as Record<string, unknown>)['ok']).toBe(2);
    expect((redacted['list'] as Array<Record<string, unknown>>)[0]?.['cost']).toBe('[REDACTED]');

    // Input untouched.
    expect(input.price).toBe(10);
  });

  it('leaves a clean value alone', () => {
    expect(redactForLog({ id: '1', count: 4 })).toEqual({ id: '1', count: 4 });
    expect(redactForLog('plain')).toBe('plain');
    expect(redactForLog(null)).toBe(null);
  });
});
