/**
 * The catalog release, projected into the rows `app.part` and
 * `app.part_revision` hold (task **T-09**, audit **D-10**).
 *
 * **The files stay the source of truth.** `data/catalog/**` is what the release
 * content hash is taken over and what the approver signed; these rows are a
 * QUERYABLE PROJECTION of them, so that FR-BM-05 (where-used) and FR-CT-06
 * (supersede impact) become answerable. Nothing here may change a published
 * value — it copies, it does not re-derive.
 *
 * Pure: no I/O, no clock, no RNG. It returns rows; a caller with a database
 * writes them, and a caller with an id generator assigns the surrogate keys.
 * That split is the same one AD-1 makes for the submit transaction, and it is
 * why this can be tested without a database.
 */

import type { BeamRow } from './lookup.js';

/**
 * A part identity, stable across releases.
 *
 * **Keyed on `code_18`, not `partNumber`, and that is measured rather than
 * assumed.** In `interlake-2026-09`, `UM005516` appears on two rows — 54 in at
 * 24,940 lbs and 60 in at 22,540 lbs — and `UM005517` on two more. The same
 * duplication is present in `interlake-2026-08`, so it is carried forward
 * rather than introduced by the 2026-09 corrections. `code_18` is unique across
 * all 336 rows of both releases. A projection keyed on the part number would
 * refuse to load the approved catalog on its first run. See finding **F-30**:
 * whether those four rows are a source fact or an extract defect is the
 * approver's call, and nothing here alters the release either way.
 */
export interface ProjectedPart {
  readonly manufacturer: string;
  readonly code18: string;
}

/**
 * The part AS PUBLISHED IN ONE RELEASE — what a BOM line references.
 *
 * `publishedRow` is the source row verbatim. Beams and frames do not share a
 * shape, and flattening one into columns invented for the other is how a
 * projection stops matching the thing it projects.
 */
export interface ProjectedPartRevision {
  readonly manufacturer: string;
  readonly code18: string;
  readonly partNumber: string;
  readonly publishedRow: Readonly<Record<string, string | number>>;
}

export interface CatalogProjection {
  readonly parts: readonly ProjectedPart[];
  readonly partRevisions: readonly ProjectedPartRevision[];
}

export class ProjectionError extends Error {
  override readonly name = 'ProjectionError';
}

/**
 * Project one release's beam rows.
 *
 * **Frames are not projected, and the omission is deliberate rather than
 * forgotten.** `frames.json` carries zero part numbers and zero codes: it holds
 * capacity TABLES indexed by independent variables, not orderable parts. A
 * frame row has no part identity to project, and inventing one would put a
 * fabricated key in the one table whose entire purpose is resolvable
 * references. When frames acquire published part codes, they project the same
 * way and this function gains a second input.
 */
export function projectBeamRelease(
  manufacturer: string,
  rows: readonly BeamRow[],
): CatalogProjection {
  if (manufacturer.trim() === '') {
    throw new ProjectionError('a projection needs the manufacturer that published it.');
  }
  if (rows.length === 0) {
    // A projection over no rows would write nothing and report success, which
    // is the vacuous pass every checker in this repository guards against.
    throw new ProjectionError('refusing to project an empty release.');
  }

  const seen = new Set<string>();
  const parts: ProjectedPart[] = [];
  const partRevisions: ProjectedPartRevision[] = [];

  for (const row of rows) {
    if (seen.has(row.code18)) {
      // Not a defensive nicety: the unique constraint in migration 0010 would
      // refuse this at write time, and finding out here names the duplicate
      // instead of surfacing a constraint violation with no context.
      throw new ProjectionError(
        `code_18 '${row.code18}' appears twice in this release; it is the part identity ` +
          'and must be unique. Check the extract before loading it.',
      );
    }
    seen.add(row.code18);

    parts.push(Object.freeze({ manufacturer, code18: row.code18 }));
    partRevisions.push(
      Object.freeze({
        manufacturer,
        code18: row.code18,
        partNumber: row.partNumber,
        publishedRow: Object.freeze({
          family: row.family,
          series: row.series,
          face_height_in: row.faceHeightIn,
          span_in: row.spanIn,
          part_number: row.partNumber,
          code_18: row.code18,
          capacity_lbs: row.capacityLbs,
        }),
      }),
    );
  }

  return Object.freeze({
    parts: Object.freeze(parts),
    partRevisions: Object.freeze(partRevisions),
  });
}
