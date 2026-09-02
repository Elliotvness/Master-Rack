/**
 * Writing the catalog projection, and answering where-used (task **T-09**,
 * audit **D-10**).
 *
 * `packages/kernel-catalog` builds the projection purely, from files; this
 * writes it. Same split as the submit transaction (AD-1): the rule is in a pure
 * package that needs no database to test, and the effects live where the
 * database is.
 *
 * These tables are **staff-only** by RLS, so every function here must be called
 * inside a `withTenant({ actorType: 'staff' })` transaction. Called as a client
 * they return nothing rather than erroring — which is how RLS fails, and why
 * the tenancy tests assert the empty result rather than an exception.
 */

import type { ProjectedPart, ProjectedPartRevision } from '@rms/kernel-catalog';

import type { TenantTransaction } from './with-tenant.js';

export interface ProjectionWriteResult {
  readonly partsSeen: number;
  readonly revisionsWritten: number;
}

/**
 * Upsert one release's projection.
 *
 * **Ids are supplied by the caller and preserved on conflict, and that is what
 * makes them stable across reloads.** `ON CONFLICT … DO UPDATE` leaves the
 * existing primary key in place, so re-loading a release does not re-issue ids
 * and a `bom_line` written last month still resolves. A `DEFAULT
 * gen_random_uuid()` would have been shorter and would have made the id an
 * accident of insert order; every other table in this schema takes its id from
 * the caller, and this one matches.
 *
 * `newId` is injected rather than imported for the same reason `SubmitEffects`
 * is: an id generator is a random source, and a function that reaches for one
 * itself cannot be tested for what it does with a given id.
 */
export async function upsertCatalogProjection(
  tx: TenantTransaction,
  catalogReleaseId: string,
  projection: {
    readonly parts: readonly ProjectedPart[];
    readonly partRevisions: readonly ProjectedPartRevision[];
  },
  newId: () => string,
): Promise<ProjectionWriteResult> {
  if (projection.partRevisions.length === 0) {
    // A write of nothing that reports success is the vacuous pass this
    // repository guards against everywhere else.
    throw new Error('refusing to write an empty catalog projection.');
  }

  for (const part of projection.parts) {
    await tx.query(
      `INSERT INTO app.part (id, manufacturer, code_18)
       VALUES ($1, $2, $3)
       ON CONFLICT (manufacturer, code_18) DO NOTHING`,
      [newId(), part.manufacturer, part.code18],
    );
  }

  let revisionsWritten = 0;
  for (const rev of projection.partRevisions) {
    const { rowCount } = await tx.query(
      `INSERT INTO app.part_revision
         (id, part_id, catalog_release_id, part_number, published_row)
       SELECT $1, p.id, $2, $3, $4::jsonb
         FROM app.part p
        WHERE p.manufacturer = $5 AND p.code_18 = $6
       ON CONFLICT (part_id, catalog_release_id) DO UPDATE
         SET part_number = EXCLUDED.part_number,
             published_row = EXCLUDED.published_row`,
      [
        newId(),
        catalogReleaseId,
        rev.partNumber,
        JSON.stringify(rev.publishedRow),
        rev.manufacturer,
        rev.code18,
      ],
    );
    // A SELECT-driven INSERT writes nothing when the SELECT matches nothing.
    // Silently writing 0 of 336 rows and reporting success is exactly the
    // failure shape this project keeps finding, so it is refused here.
    if (rowCount !== 1) {
      throw new Error(
        `part_revision for '${rev.code18}' wrote ${String(rowCount)} rows, expected 1. ` +
          'Its part row is missing, which means the projection was written out of order.',
      );
    }
    revisionsWritten += 1;
  }

  return Object.freeze({
    partsSeen: projection.parts.length,
    revisionsWritten,
  });
}

/** One place a part revision is referenced. */
export interface WhereUsedRow {
  readonly revisionId: string;
  readonly revisionCode: string;
  readonly lifecycleState: string;
  readonly organizationId: string;
  /** Null when the revision has never been submitted. */
  readonly submissionId: string | null;
  /** Null when there is no submission; otherwise its request status. */
  readonly requestStatus: string | null;
}

/**
 * **FR-BM-05.** Which revisions, and which open requests, reference this part
 * revision?
 *
 * Unanswerable before migration 0010: `bom_line.part_revision_id` referenced
 * nothing, so "where is this part used" could only be answered by scanning
 * every BOM line's text. It is a LEFT JOIN to submission on purpose — a
 * revision that uses the part and has never been submitted is still a use, and
 * a query that only returned submitted ones would under-report the impact of
 * superseding a part, which is FR-CT-06's whole question.
 */
export async function whereUsed(
  tx: TenantTransaction,
  partRevisionId: string,
): Promise<readonly WhereUsedRow[]> {
  const { rows } = await tx.query<{
    revision_id: string;
    revision_code: string;
    lifecycle_state: string;
    organization_id: string;
    submission_id: string | null;
    request_status: string | null;
  }>(
    `SELECT DISTINCT
            r.id               AS revision_id,
            r.revision_code    AS revision_code,
            r.lifecycle_state::text AS lifecycle_state,
            r.organization_id  AS organization_id,
            s.id               AS submission_id,
            s.request_status::text AS request_status
       FROM app.bom_line b
       JOIN app.revision r ON r.id = b.revision_id
       LEFT JOIN app.submission s ON s.revision_id = r.id
      WHERE b.part_revision_id = $1
      ORDER BY r.revision_code, r.id`,
    [partRevisionId],
  );

  return Object.freeze(
    rows.map((r) =>
      Object.freeze({
        revisionId: r.revision_id,
        revisionCode: r.revision_code,
        lifecycleState: r.lifecycle_state,
        organizationId: r.organization_id,
        submissionId: r.submission_id,
        requestStatus: r.request_status,
      }),
    ),
  );
}
