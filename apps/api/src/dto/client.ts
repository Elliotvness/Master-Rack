/**
 * Data transfer objects, and the one constant that guards them.
 *
 * The rule that matters most in the whole product (blueprint §9.1): internal
 * commercial data never reaches a client. This module is the LAST line of that
 * defense — the physically separate tables and the RLS actor_type predicate are
 * the first — and it is built to make a leak a TEST failure, never a
 * code-review catch.
 *
 * Two disciplines:
 *   1. Deny-by-default construction. A DTO is built field by field, never
 *      spread from an entity and never `omit([...])`. Spreading ships the next
 *      column someone adds; naming the fields ships only what was named.
 *   2. One shared forbidden-field constant, used by the leakage test, the log
 *      redactor and (later) the response validator. One list, three consumers,
 *      so they cannot drift.
 */

/**
 * Keys that must never appear in a client-facing response, at any nesting
 * depth. This is AC-02's list: every row marked Hidden in blueprint §9.2.
 */
export const FORBIDDEN_CLIENT_FIELDS: readonly string[] = [
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
];

const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_CLIENT_FIELDS);

export function isForbiddenClientField(key: string): boolean {
  return FORBIDDEN_SET.has(key);
}

/**
 * Recursively find every forbidden key in a value, with the path to each.
 * Empty means the value is safe to send to a client.
 *
 * This is what the contract test calls over every client route's response, and
 * what the response validator can call in production to alert on a leak.
 */
export function findForbiddenFields(value: unknown, path = ''): readonly string[] {
  const hits: string[] = [];
  walk(value, path, hits, new Set());
  return hits;
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

// --------------------------------------------------------------------------
// Client DTOs — built field by field, never spread
// --------------------------------------------------------------------------

export interface ProjectClientDTO {
  readonly id: string;
  readonly number: string;
  readonly name: string;
  readonly status: string;
}

interface ProjectEntity {
  id: string;
  number: string;
  name: string;
  status: string;
  organization_id: string;
  [extra: string]: unknown;
}

/**
 * Note what this does NOT do: it never spreads `entity`. Even though a project
 * carries no commercial data today, spreading would ship whatever column is
 * added next. Naming the four fields ships exactly four fields, forever.
 */
export function toProjectClientDTO(entity: ProjectEntity): ProjectClientDTO {
  return {
    id: entity.id,
    number: entity.number,
    name: entity.name,
    status: entity.status,
  };
}

export interface FindingClientDTO {
  readonly code: string;
  readonly severity: string;
  /** What would resolve it — the only "internal" thing a client is shown, in plain words. */
  readonly closed_by: string;
}

interface FindingEntity {
  code: string;
  severity: string;
  closed_by: string;
  // These live on the internal projection and must never cross into the client one.
  rule_id?: string;
  citation?: string;
  verification_tier?: string;
  [extra: string]: unknown;
}

export function toFindingClientDTO(entity: FindingEntity): FindingClientDTO {
  return {
    code: entity.code,
    severity: entity.severity,
    closed_by: entity.closed_by,
  };
}

// --------------------------------------------------------------------------
// Log redaction — same constant, different consumer
// --------------------------------------------------------------------------

/**
 * Redact forbidden fields from a value before it reaches an application log.
 * Returns a copy; never mutates. Uses the same constant as the DTOs and the
 * contract test, so a field added to one is covered by all three.
 */
export function redactForLog(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactForLog);

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isForbiddenClientField(key) ? '[REDACTED]' : redactForLog(child);
  }
  return out;
}
