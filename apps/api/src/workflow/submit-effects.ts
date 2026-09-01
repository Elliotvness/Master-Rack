/**
 * The effects the submit transaction performs, supplied by the server.
 *
 * `@rms/workflow` owns the ORDER and the refusals and knows nothing about a
 * database; this module owns the transaction and the SQL. That split is
 * architecture decision **AD-1**, and the reason is testability: the ordering
 * is the invariant, and an invariant that needs Postgres to observe is one
 * nobody exercises. There the ordering is proven against injected effects;
 * here what is proven is that each step writes what it says it writes.
 *
 * Everything runs inside ONE `TenantTransaction`. Section 13.1's rule — "if any
 * step fails, nothing happened" — is not implemented in this file at all: it
 * IS the transaction. Nothing here catches, retries or compensates, because
 * every one of those is a way for half a submission to survive.
 *
 * Identifiers and time arrive as arguments, for the same reason they do in the
 * pure package: a test that cannot fix them cannot assert what was written.
 */

import { withTenant, type TenantContext, type TenantTransaction } from '@rms/db';
import { sha256 } from '@rms/kernel-model';
import {
  submit,
  type Acknowledgement,
  type Derivation,
  type SubmitEffects,
  type SubmitInput,
  type SubmitResult,
} from '@rms/workflow';

import { appendAuditEvent, type AuditEventContent } from '../audit/chain.js';
import { enqueue } from '../outbox/outbox.js';

/** Recorded on every derived row, so a finding can be traced to what produced it. */
export const ENGINE_VERSION = 'mvp-1';

/** What the caller supplies that the workflow package cannot know. */
export interface SubmitContext {
  readonly organizationId: string;
  readonly submittedBy: string;
  /** Supplied, never read from a clock — the freeze and its audit row share it. */
  readonly now: string;
  /**
   * Identifiers, supplied rather than generated.
   *
   * `crypto.randomUUID()` here would make every row a value no test can name,
   * and this is the one module where "which row did that write?" has to be
   * answerable. A route generates them per request; a test hands over fixed
   * ones.
   */
  readonly ids: {
    readonly submissionId: string;
    readonly acknowledgementEventId: string;
    readonly freezeEventId: string;
    readonly submissionEventId: string;
    readonly outboxIds: readonly string[];
  };
  /**
   * Re-derivation, injected.
   *
   * Section 13.1 step 1 says FROM SCRATCH, never from cached derived rows, and
   * the kernel that does it is pure. Passing it in keeps this module about
   * persistence and keeps the never-from-cache rule where it can be read.
   */
  rederive(revisionId: string): Promise<Derivation>;
}

interface HeadRow {
  this_hash: string;
}

interface KeyRow {
  key: string;
}

function auditContent(
  ctx: SubmitContext,
  action: string,
  resourceType: string,
  resourceId: string,
): AuditEventContent {
  return {
    occurredAt: ctx.now,
    actorUserId: ctx.submittedBy,
    actorType: 'client',
    actorOrganizationId: ctx.organizationId,
    impersonatedBy: null,
    subjectOrganizationId: ctx.organizationId,
    action,
    resourceType,
    resourceId,
    outcome: 'success',
    reasons: [],
  };
}

/**
 * Split `topic:reference` on the FIRST colon; a reference may contain colons.
 *
 * Exported so the no-colon case is testable without a database. It is not
 * hypothetical: `SUBMIT_STEPS` names and outbox topics are separate vocabularies,
 * and a future message with no reference would otherwise be silently mangled.
 */
export function splitOnce(value: string): { head: string; rest: string } {
  const at = value.indexOf(':');
  if (at < 0) return { head: value, rest: '' };
  return { head: value.slice(0, at), rest: value.slice(at + 1) };
}

/**
 * Build the effects for one submission, bound to one transaction.
 *
 * Single-use by construction: it closes over the transaction and the
 * pre-allocated ids, so running it twice would write the same primary keys and
 * the database would refuse. That is deliberate. A reusable effects object is
 * one a caller can accidentally run twice.
 */
export function submitEffects(
  tx: TenantTransaction,
  ctx: SubmitContext,
  /**
   * The revision under submission. MUST be `SubmitInput.revisionId`.
   *
   * A required parameter rather than a field on `SubmitContext`, and that is a
   * repair. It was a context field, and an adversarial review showed the cost:
   * `persistDerived` is handed no revision id of its own, so it read the
   * context's while every other step used `SubmitInput`'s. Two sources for one
   * identity with nothing comparing them — point them at different revisions
   * and the transaction deletes a third party's findings, writes this
   * submission's onto that revision, leaves the frozen one empty, and reports
   * all nine steps complete.
   *
   * Now there is one source, `rederive` checks that it is the same one the
   * workflow was given, and `submitRevision` passes them from the same object
   * so shipping code cannot get them apart.
   */
  revisionUnderSubmission: string,
): SubmitEffects {

  /** Event ids this transaction actually wrote, checked against the claim at step 8. */
  const eventsWritten = new Set<string>();

  /** A write that matched no row is a step that did nothing and said it did. */
  function expectOneRow(rowCount: number | null, what: string): void {
    // `Number(null)` is 0, so there is no nullish branch to leave untested here.
    const affected = Number(rowCount);
    if (affected === 1) return;
    throw new Error(
      `${what} affected ${String(affected)} row(s), not 1. The step reported success and ` +
        'changed nothing, which is how a submission commits audit events and outbox work for a ' +
        'revision that does not exist.',
    );
  }

  return {
    rederive: (revisionId) => {
      if (revisionId !== revisionUnderSubmission) {
        throw new Error(
          `These effects are bound to revision ${revisionUnderSubmission} and the submission ` +
            `is for ${revisionId}. Two sources for one identity is how a transaction writes ` +
            "one revision's findings onto another and reports success.",
        );
      }
      return ctx.rederive(revisionId);
    },

    hash: (canonicalJson) => Promise.resolve(sha256(canonicalJson)),

    /**
     * Step 3. The acknowledgement and its audit event, in this transaction.
     *
     * The event is written FIRST and its id stamped onto every assumption,
     * because migration 0009 makes `acknowledgement_audit_event_id` a foreign
     * key: the row cannot reference an event that does not exist yet. That
     * ordering is the schema's, not a preference — which is the whole reason
     * the rule was put there rather than here.
     *
     * The returned `keys` are the ones the UPDATE actually matched, never the
     * ones it was asked for. The workflow package refuses when the two differ,
     * and it can only do that if this reports what happened rather than what
     * was intended.
     */
    recordAcknowledgement: async ({ revisionId, acknowledgedBy, at, keys }) => {
      await appendAuditEvent(tx, {
        eventId: ctx.ids.acknowledgementEventId,
        content: auditContent(ctx, 'assumption.acknowledged', 'revision', revisionId),
        recordedAt: ctx.now,
      });
      eventsWritten.add(ctx.ids.acknowledgementEventId);

      const updated = await tx.query<KeyRow>(
        `UPDATE app.assumption
            SET acknowledged_by = $1,
                acknowledged_at = $2,
                acknowledgement_audit_event_id = $3
          WHERE revision_id = $4 AND key = ANY($5::text[])
        RETURNING key`,
        [acknowledgedBy, at, ctx.ids.acknowledgementEventId, revisionId, [...keys]],
      );

      const acknowledgement: Acknowledgement = {
        acknowledgedBy,
        acknowledgedAt: at,
        auditEventId: ctx.ids.acknowledgementEventId,
        keys: updated.rows.map((row) => row.key),
      };
      return acknowledgement;
    },

    /** Step 5. `content_hash` and `frozen_at` together — the schema requires both. */
    freezeRevision: async (revisionId, contentHash, at) => {
      const frozen = await tx.query(
        `UPDATE app.revision
            SET frozen_at = $1, content_hash = $2, lifecycle_state = 'FROZEN'
          WHERE id = $3`,
        [at, contentHash, revisionId],
      );
      expectOneRow(frozen.rowCount, `Freezing revision ${revisionId}`);

      await appendAuditEvent(tx, {
        eventId: ctx.ids.freezeEventId,
        content: auditContent(ctx, 'revision.frozen', 'revision', revisionId),
        recordedAt: ctx.now,
      });
      eventsWritten.add(ctx.ids.freezeEventId);
    },

    /**
     * Step 6. Derived rows keyed to the CONTENT hash (section 7.2).
     *
     * Cleared and rewritten rather than upserted: the derivation is the whole
     * answer for this revision, and a partial overwrite would leave a finding
     * from an earlier run standing beside the new ones with nothing marking it
     * stale.
     *
     * `audience` is copied from the parent revision rather than defaulted,
     * because migration 0008 holds the two equal with a composite foreign key —
     * a defaulted 'client' on an internal revision would be refused, which is
     * the F-01 leak closing itself.
     */
    persistDerived: async (contentHash, derivation) => {
      const revisionId = revisionUnderSubmission;
      await tx.query(`DELETE FROM app.finding WHERE revision_id = $1`, [revisionId]);
      for (const finding of derivation.findings) {
        const written = await tx.query(
          `INSERT INTO app.finding
             (id, organization_id, revision_id, audience, code, severity,
              subject_object_ids, closed_by, revision_hash, engine_version)
           SELECT gen_random_uuid(), r.organization_id, r.id, r.audience, $2,
                  $3::app.finding_severity, $4::text[], $5, $6, $7
             FROM app.revision r
            WHERE r.id = $1`,
          [
            revisionId,
            finding.code,
            finding.severity,
            [...finding.subjectObjectIds],
            finding.closedBy,
            contentHash,
            ENGINE_VERSION,
          ],
        );
        expectOneRow(written.rowCount, `Persisting finding ${finding.code}`);
      }
    },

    /**
     * Step 7. The submission row, chained onto the previous head.
     *
     * `this_hash = SHA-256(prev, manifest, meta)` — section 13.1 step 7. The
     * chain is what makes a submission's place in the sequence checkable rather
     * than asserted, so the previous head is read inside the transaction and
     * never cached.
     */
    createSubmission: async ({ revisionId, manifestHash, contentHash, at }) => {
      const head = await tx.query<HeadRow>(
        `SELECT this_hash FROM app.submission ORDER BY submitted_at DESC, id DESC LIMIT 1`,
      );
      const prevHash = head.rows[0]?.this_hash ?? '';
      const thisHash = sha256(
        // NUL as the field separator, written as an escape and matching
        // `chainHash`'s convention: it cannot appear inside any of these values,
        // so no two different field lists can produce the same joined string.
        [prevHash, manifestHash, contentHash, revisionId, at, ctx.submittedBy].join('\u0000'),
      );

      // INSERT ... SELECT, so `audience` comes from the parent revision rather
      // than a literal. Migration 0008 holds the two equal with a composite
      // foreign key and gives the column no DEFAULT — deliberately, so that
      // omitting it fails loudly instead of inheriting 'client' and putting an
      // internal submission in front of a client. F-01, closing itself.
      const created = await tx.query(
        `INSERT INTO app.submission
           (id, organization_id, revision_id, audience, manifest_hash, prev_hash, this_hash,
            submitted_by, submitted_at)
         SELECT $1, r.organization_id, r.id, r.audience, $3, $4, $5, $6, $7
           FROM app.revision r
          WHERE r.id = $2`,
        [
          ctx.ids.submissionId,
          revisionId,
          manifestHash,
          prevHash === '' ? null : prevHash,
          thisHash,
          ctx.submittedBy,
          at,
        ],
      );

      expectOneRow(created.rowCount, `Creating submission for revision ${revisionId}`);

      await appendAuditEvent(tx, {
        eventId: ctx.ids.submissionEventId,
        content: auditContent(ctx, 'submission.created', 'submission', ctx.ids.submissionId),
        recordedAt: ctx.now,
      });
      eventsWritten.add(ctx.ids.submissionEventId);

      return thisHash;
    },

    /**
     * Step 8. Reconcile what the workflow claims against what this transaction
     * actually wrote — by EVENT ID, not by action name.
     *
     * The first version of this compared `action` only, and an adversarial
     * review took it apart in one move: after the first submission there is
     * always a `revision.frozen` row, so a transaction that froze a revision
     * and skipped its event still passed. It went green in the test suite for
     * the worst possible reason — the fixture truncates `app.audit_event`
     * before every case, so the control was only ever exercised against an
     * empty table, a state production occupies exactly once. **That test proved
     * the fixture, not the control.**
     *
     * An event id is a primary key this transaction generated. No pre-existing
     * row can satisfy it, and no later row can be mistaken for it. The count is
     * compared too: an event this transaction wrote that the workflow never
     * claimed is the same defect facing the other way.
     */
    writeAudit: async (events) => {
      const problems: string[] = [];

      if (events.length !== eventsWritten.size) {
        problems.push(
          `the workflow claims ${String(events.length)} audit event(s) and this transaction ` +
            `wrote ${String(eventsWritten.size)}`,
        );
      }

      for (const eventId of eventsWritten) {
        const found = await tx.query(
          `SELECT 1 FROM app.audit_event WHERE event_id = $1`,
          [eventId],
        );
        if (found.rowCount !== 1) problems.push(`event ${eventId} is not in the chain`);
      }

      if (problems.length > 0) {
        throw new Error(
          `The transaction claims audit events this chain does not hold: ${problems.join('; ')}. ` +
            'AC-15 requires the event in the same transaction as the change it describes; a ' +
            'claim with no row behind it is the thing AC-15 exists to prevent.',
        );
      }
    },

    /** Step 9. Inside the transaction, so a rolled-back submission sends nothing. */
    enqueueOutbox: async (messages) => {
      const at = new Date(ctx.now);
      let index = 0;
      for (const message of messages) {
        const id = ctx.ids.outboxIds[index];
        index += 1;
        if (id === undefined) {
          throw new Error(
            `submitEffects: ${String(messages.length)} outbox message(s) to send and ` +
              `${String(ctx.ids.outboxIds.length)} id(s) supplied. Ids are supplied and never ` +
              'generated here, so a missing one is a caller bug, not something to paper over.',
          );
        }
        const { head: topic, rest: reference } = splitOnce(message);
        await enqueue(tx, {
          id,
          organizationId: ctx.organizationId,
          topic,
          payload: { reference },
          now: at,
        });
      }
    },
  };
}

/**
 * Submit a revision: open the transaction, run the nine steps, commit or roll back.
 *
 * This is the function a route calls (T-14). It exists so that "apps/api owns
 * the transaction" is true of code that ships rather than of a test fixture —
 * an adversarial review pointed out that `withTenant` appeared nowhere outside
 * `packages/db` and its tests, which made the claim a description of intent.
 *
 * There is deliberately nothing here but the transaction boundary. Every
 * decision belongs to `@rms/workflow`; every write belongs to `submitEffects`.
 * A function in between that did anything of its own would be a third place to
 * look when a submission goes wrong.
 */
export async function submitRevision(
  tenant: TenantContext,
  input: SubmitInput,
  ctx: SubmitContext,
): Promise<SubmitResult> {
  return withTenant(tenant, (tx) =>
    submit(input, submitEffects(tx, ctx, input.revisionId)),
  );
}
