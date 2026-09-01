/**
 * The one list of fields a client may never see, and the walk that finds them.
 *
 * Relocated here from `apps/api/src/dto` (T-13a) because it has three consumers
 * and they must not drift: the leakage contract test, the log redactor, and the
 * outbound response validator. One list, three consumers — and now one package
 * that neither app owns, so neither can quietly amend it for its own
 * convenience.
 *
 * This is AC-02's list: every row marked Hidden in blueprint §9.2. It is the
 * LAST line of the defense, not the only one — the physically separate tables
 * and the RLS `actor_type` predicate come first. It exists so a leak is a test
 * failure rather than a code-review catch.
 *
 * Pure: no I/O, no clock, no RNG.
 */

/** Keys that must never appear in a client-facing response, at any depth. */
export const FORBIDDEN_CLIENT_FIELDS: readonly string[] = Object.freeze([
  'cost',
  'unit_cost',
  'landed_cost',
  'buy_price',
  'price',
  'margin',
  'margin_pct',
  'discount',
  'supplier',
  'supplier_id',
  'mpn',
  'manufacturer_part_number',
  'bom',
  'bom_line',
  'item_snapshot',
  'capacity',
  'capacity_case',
  'catalog_release',
  'source_document',
  'page_ref',
  'catalog_page_ref',
  'digitised_by',
  'approved_by',
  'citation',
  'verification_tier',
  'rule_id',
  'internal_note',
]);

const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_CLIENT_FIELDS);

export function isForbiddenClientField(key: string): boolean {
  return FORBIDDEN_SET.has(key);
}

/**
 * Every forbidden key in a value, with the path to each. Empty means safe.
 *
 * Depth matters: `{ options: [{ bom: [...] }] }` leaks just as thoroughly as
 * `{ bom: [...] }`, and a check that only looks at the top level is a check
 * that passes on the shapes this API actually returns.
 */
export function findForbiddenFields(value: unknown, path = ''): readonly string[] {
  const hits: string[] = [];
  walk(value, path, hits, new Set());
  return Object.freeze(hits);
}

function walk(value: unknown, path: string, hits: string[], seen: Set<object>): void {
  if (value === null || typeof value !== 'object') return;
  // A cycle cannot leak a new field; stop rather than recurse forever.
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${path}[${i}]`, hits, seen));
    return;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const here = path === '' ? key : `${path}.${key}`;
    if (isForbiddenClientField(key)) hits.push(here);
    walk(child, here, hits, seen);
  }
}
