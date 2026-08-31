/**
 * Loading the declarative frame-capacity data into typed tables.
 *
 * Same posture as `load.ts` for beams: the catalog is DATA, validated at load
 * time rather than trusted. A malformed row here is worse than a malformed beam
 * row, because a short row would shift every capacity one column left and still
 * look entirely plausible on a sheet.
 */

import { type FrameTable, type FrameVariant, FrameCatalogError } from './frames.js';

interface RawTable {
  table_id?: unknown;
  page_ref?: unknown;
  load_basis?: unknown;
  column_order?: unknown;
  variants?: unknown;
  rows?: unknown;
}

function requireString(value: unknown, field: string, where: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new FrameCatalogError(`${where}: '${field}' must be a non-empty string`);
  }
  return value;
}

export function loadFrameTables(raw: unknown): readonly FrameTable[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new FrameCatalogError('frames document must be an object');
  }
  const doc = raw as { tables?: unknown };
  if (!Array.isArray(doc.tables) || doc.tables.length === 0) {
    throw new FrameCatalogError('frames document must carry a non-empty `tables` array');
  }

  return Object.freeze(
    doc.tables.map((entry, index): FrameTable => {
      const where = `table ${index}`;
      if (typeof entry !== 'object' || entry === null) {
        throw new FrameCatalogError(`${where}: not an object`);
      }
      const t = entry as RawTable;

      const tableId = requireString(t.table_id, 'table_id', where);
      const columnOrder = t.column_order;
      if (!Array.isArray(columnOrder) || columnOrder.length === 0) {
        throw new FrameCatalogError(`${tableId}: 'column_order' must be a non-empty array`);
      }

      const rawVariants = t.variants;
      if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
        throw new FrameCatalogError(`${tableId}: 'variants' must be a non-empty array`);
      }
      const variants: FrameVariant[] = rawVariants.map((v, i) => {
        if (typeof v !== 'object' || v === null) {
          throw new FrameCatalogError(`${tableId}: variant ${i} is not an object`);
        }
        const rv = v as { model?: unknown; banded?: unknown };
        return Object.freeze({
          model: requireString(rv.model, 'model', `${tableId} variant ${i}`),
          banded: rv.banded === true,
        });
      });

      const rawRows = t.rows;
      if (typeof rawRows !== 'object' || rawRows === null) {
        throw new FrameCatalogError(`${tableId}: 'rows' must be an object keyed by HbL`);
      }
      const rows = new Map<number, readonly number[]>();
      for (const [key, value] of Object.entries(rawRows as Record<string, unknown>)) {
        const hbl = Number(key);
        if (!Number.isInteger(hbl) || hbl <= 0) {
          throw new FrameCatalogError(`${tableId}: HbL key '${key}' is not a positive integer`);
        }
        if (!Array.isArray(value)) {
          throw new FrameCatalogError(`${tableId}: HbL ${hbl} is not an array of capacities`);
        }
        // The check that matters: a short row shifts every capacity one column
        // to the left and remains plausible. Refuse it at load time.
        if (value.length !== columnOrder.length) {
          throw new FrameCatalogError(
            `${tableId}: HbL ${hbl} has ${value.length} values but ${columnOrder.length} columns`,
          );
        }
        for (const n of value) {
          if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) {
            throw new FrameCatalogError(
              `${tableId}: HbL ${hbl} carries a non-positive-integer capacity`,
            );
          }
        }
        rows.set(hbl, Object.freeze([...(value as number[])]));
      }

      return Object.freeze({
        tableId,
        pageRef: requireString(t.page_ref, 'page_ref', tableId),
        loadBasis: requireString(t.load_basis, 'load_basis', tableId),
        columnOrder: Object.freeze([...(columnOrder as string[])]),
        variants: Object.freeze(variants),
        rows,
      });
    }),
  );
}
