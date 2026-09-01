/**
 * Canonical cell identifiers for a catalog dataset.
 *
 * A spot-check record names the cells an approver read. For the gate to verify
 * that those are the cells the tool drew, both sides must agree on what a cell
 * is CALLED — and they must agree forever, because a manifest pinned in 2026 is
 * re-checkable in 2029 only if the ids still resolve.
 *
 * Two properties are deliberate:
 *
 *   1. **A human can find the cell on the page.** `59ER/F5M/120in` is a row
 *      someone can point at in the published chart. An array index is not, and
 *      an index also silently re-targets when a row is inserted.
 *   2. **The ORDER is the file's order.** The draw is a partial Fisher-Yates
 *      over this list, so a different order is a different sample for the same
 *      seed. Reordering a dataset file therefore invalidates a pinned draw,
 *      which is correct: the extract changed.
 *
 * `tools/draw-spot-check.mjs` derives the same ids in plain JS, because a
 * `.mjs` tool cannot import this package. `tools/selftest-spot-check-draw.mjs`
 * asserts the two agree over the real datasets — the duplication is permitted
 * only because that binding exists.
 *
 * Pure: the caller does the I/O and hands the parsed JSON in, same posture as
 * `load.ts`, `load-frames.ts` and `load-manifest.ts`.
 */

import { CatalogError } from './release.js';

export class CellIdError extends CatalogError {
  override readonly name = 'CellIdError';
}

/** The datasets whose cell ids this module knows how to derive. */
export const CELL_ID_DATASETS: readonly string[] = Object.freeze(['beams', 'frames']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function beamCellIds(doc: unknown): readonly string[] {
  if (!isRecord(doc) || !Array.isArray(doc['rows'])) {
    throw new CellIdError("beams: expected an object with a 'rows' array");
  }
  return Object.freeze(
    doc['rows'].map((row, i) => {
      if (!isRecord(row)) throw new CellIdError(`beams: rows[${i}] is not an object`);
      const { family, series, span_in: span } = row;
      if (typeof family !== 'string' || typeof series !== 'string' || typeof span !== 'number') {
        throw new CellIdError(`beams: rows[${i}] needs family, series and span_in`);
      }
      return `${family}/${series}/${span}in`;
    }),
  );
}

function frameCellIds(doc: unknown): readonly string[] {
  if (!isRecord(doc) || !Array.isArray(doc['tables'])) {
    throw new CellIdError("frames: expected an object with a 'tables' array");
  }
  const ids: string[] = [];
  for (const [t, table] of doc['tables'].entries()) {
    if (!isRecord(table)) throw new CellIdError(`frames: tables[${t}] is not an object`);
    const tableId = table['table_id'];
    if (typeof tableId !== 'string') {
      throw new CellIdError(`frames: tables[${t}] needs a string table_id`);
    }
    const rows = table['rows'];
    if (!isRecord(rows)) throw new CellIdError(`frames: ${tableId} needs a rows object`);
    // Object.entries preserves insertion order for string keys that are not
    // array indices; HbL keys ARE integer-like, so V8 orders them ascending.
    // Either way the order is a property of the parsed file, and both the tool
    // and the kernel read the same file the same way.
    for (const [hbl, values] of Object.entries(rows)) {
      if (!Array.isArray(values)) {
        throw new CellIdError(`frames: ${tableId}/HbL${hbl} is not an array`);
      }
      for (let i = 0; i < values.length; i += 1) ids.push(`${tableId}/HbL${hbl}/col${i}`);
    }
  }
  return Object.freeze(ids);
}

/**
 * Every cell id in a dataset, in the file's own order.
 *
 * Throws for an unknown dataset rather than returning an empty list: an empty
 * list would make the gate's sample comparison vacuous, which is the failure
 * this whole module exists to prevent.
 */
export function cellIdsOf(dataset: string, doc: unknown): readonly string[] {
  if (dataset === 'beams') return beamCellIds(doc);
  if (dataset === 'frames') return frameCellIds(doc);
  throw new CellIdError(
    `no cell-id derivation for dataset '${dataset}'; add one before a release may ship it`,
  );
}
