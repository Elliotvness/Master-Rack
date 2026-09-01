import { sha256 } from '@rms/kernel-model';

/**
 * E-07 — the WORM record, as a provider-independent contract.
 *
 * The record of truth is a content-addressed snapshot, not a set of database
 * rows: rows can be migrated, re-typed and accidentally updated, and a manifest
 * under an irreversible retention lock cannot. This module is what the rest of
 * the system talks to; the provider adapter is written against it.
 *
 * Provider decision (owner, 2026-09-01): manifests go to Backblaze B2 with
 * Object Lock in COMPLIANCE mode and a 7-year retention. Cloudflare R2 was the
 * default and was REJECTED for this bucket after checking the mechanism rather
 * than the marketing: R2 offers "bucket locks", whose rules are removable with
 * a documented one-command call (`wrangler r2 bucket lock remove --id`). That
 * protects against accident, which is not the threat. The threat named in the
 * blueprint is an insider with account access, and a lock the attacker can
 * remove is not a control against them. B2 compliance-mode retention "cannot be
 * removed by any user" and can only be extended. R2 remains in use for
 * everything that does not need the irreversible lock.
 *
 * Pure: no I/O, no clock, no RNG. The transport lives in the adapter, so the
 * rules about what may be written can be tested without a network.
 */

/** Retention modes, named as the providers name them. */
export type RetentionMode = 'GOVERNANCE' | 'COMPLIANCE';

/**
 * Blueprint NFR-AUD-06: audit events retain seven years.
 *
 * Expressed in days rather than years because that is what the S3-compatible
 * API takes, and because "7 years" hides whether leap days were considered.
 * 2557 days is 7 x 365 plus two leap days, rounded UP: retention that expires
 * early is a silent failure of the guarantee, so the arithmetic errs long.
 */
export const RETENTION_DAYS_7_YEARS = 2557;

/** A refusal from the WORM layer. Every message names what and why. */
export class WormError extends Error {
  override readonly name = 'WormError';
}

/** An object destined for, or already in, WORM storage. */
export interface WormObject {
  /** Storage key. Content-addressed, so the key states what the bytes are. */
  readonly key: string;
  readonly body: string;
  readonly sha256: string;
  readonly mode: RetentionMode;
  /** ISO-8601. Supplied by the caller; this module never reads a clock. */
  readonly retainUntil: string;
}

/**
 * What a provider adapter must implement.
 *
 * `put` REFUSES rather than overwrites. That is the whole contract: a WORM
 * client whose put silently replaces an existing object would satisfy every
 * type check and destroy the guarantee, and the failure would be invisible
 * until the moment someone needed the original.
 */
export interface WormStore {
  put(object: WormObject): Promise<void>;
  get(key: string): Promise<WormObject | null>;
  /** Present so the overwrite refusal can be PROVEN, not assumed. */
  has(key: string): Promise<boolean>;
}

/**
 * The manifest key for a submission.
 *
 * Content-addressed: the hash is in the key, so two different manifests can
 * never collide on one key, and a key with the wrong bytes behind it is
 * detectable without reading the database.
 */
export function manifestKey(submissionId: string, manifestHash: string): string {
  if (submissionId.trim() === '') {
    throw new WormError('a manifest key needs a submission id');
  }
  if (!/^[0-9a-f]{64}$/.test(manifestHash)) {
    throw new WormError(
      `a manifest key needs a full SHA-256 hex digest, got '${manifestHash}'. ` +
        'A truncated hash in a key would let two manifests collide.',
    );
  }
  return `manifests/${submissionId}/${manifestHash}.json`;
}

/** The key for one day's audit head anchor. */
export function anchorKey(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new WormError(`an anchor key needs a YYYY-MM-DD day, got '${day}'`);
  }
  return `anchors/${day}.json`;
}

/**
 * Prepare a manifest for WORM storage.
 *
 * The hash is computed HERE from the bytes being stored, never accepted from
 * the caller. A caller-supplied hash would record what someone believed the
 * bytes were rather than what they are, which is the one thing this record
 * exists to make impossible.
 */
export function prepareManifest(input: {
  readonly submissionId: string;
  readonly canonicalJson: string;
  readonly retainUntil: string;
  readonly mode: RetentionMode;
}): WormObject {
  if (input.canonicalJson.trim() === '') {
    throw new WormError('refusing to store an empty manifest');
  }
  const digest = sha256(input.canonicalJson);
  return Object.freeze({
    key: manifestKey(input.submissionId, digest),
    body: input.canonicalJson,
    sha256: digest,
    mode: input.mode,
    retainUntil: input.retainUntil,
  });
}

/**
 * Every reason a WORM write must be refused. Empty means it may proceed.
 *
 * Returned as a list rather than thrown one at a time: an operator fixing a
 * misconfigured bucket should see every problem at once, not discover them
 * across five deploys.
 */
export function writeRefusals(
  object: WormObject,
  context: { readonly alreadyExists: boolean; readonly now: string },
): readonly string[] {
  const reasons: string[] = [];

  if (context.alreadyExists) {
    reasons.push(
      `an object already exists at '${object.key}'. WORM storage never overwrites: ` +
        'if the bytes differ, the existing record is the one that was attested.',
    );
  }

  if (sha256(object.body) !== object.sha256) {
    reasons.push(
      'the recorded digest does not match the bytes being written, so the object ' +
        'would be stored under a key that misdescribes it',
    );
  }

  const until = Date.parse(object.retainUntil);
  const now = Date.parse(context.now);
  if (Number.isNaN(until)) {
    reasons.push(`retainUntil '${object.retainUntil}' is not a parsable timestamp`);
  } else if (Number.isNaN(now)) {
    reasons.push(`now '${context.now}' is not a parsable timestamp`);
  } else if (until <= now) {
    reasons.push(
      'the retention date is not in the future, so the object would be immediately ' +
        'deletable and the lock would be decorative',
    );
  }

  return Object.freeze(reasons);
}

/**
 * Governance mode is for the staging bucket ONLY.
 *
 * Staged rollout (owner, 2026-09-01): prove upload-then-overwrite fails under
 * Governance first, then switch production to Compliance. Compliance is
 * irreversible - a misconfigured seven-year lock cannot be undone by anyone,
 * including the account root - so it is not the mode to discover a bug in.
 *
 * This function exists so that "staging only" is enforced rather than
 * remembered. A production write in Governance mode is refused.
 */
export function modeRefusals(
  mode: RetentionMode,
  environment: 'staging' | 'production',
): readonly string[] {
  if (environment === 'production' && mode === 'GOVERNANCE') {
    return Object.freeze([
      'production manifests require COMPLIANCE mode. Governance retention can be ' +
        'overridden by a client with the right key, which is exactly the insider ' +
        'this control exists to defeat.',
    ]);
  }
  return Object.freeze([]);
}
