import { sha256 } from '@rms/kernel-model';

import { anchorKey, WormError, type RetentionMode, type WormObject } from './store.js';

/**
 * E-07 — daily anchoring of the audit head to an external timestamp authority.
 *
 * A hash chain detects modification to anyone holding a trusted copy of a later
 * head. It does NOT prevent a database superuser from rewriting the chain from
 * genesis, and without an external anchor nobody would ever notice: the rewrite
 * is internally consistent, so every check the system runs on itself passes.
 *
 * The anchor is what makes that rewrite detectable. Once a day the current head
 * is submitted to an RFC 3161 timestamp authority, which returns a token
 * asserting "this digest existed at this time", signed by a party with no stake
 * in our data. An operator can rewrite our chain; they cannot rewrite a token
 * held by someone else.
 *
 * Authority (owner, 2026-09-01): FreeTSA, on the reasoning that a daily head
 * anchor does not need a paid assurance level. Recorded rather than assumed,
 * because a later dispute may turn on who attested the timestamp and a free
 * authority is a weaker witness than a commercial one. Moving to DigiCert or
 * Sectigo is a configuration change; the token format is the same standard.
 *
 * Pure: no I/O, no clock, no RNG. Submitting the token is the adapter's job.
 */

/** A timestamp token as returned by an RFC 3161 authority. */
export interface TimestampToken {
  /** The digest that was timestamped. */
  readonly digest: string;
  /** The authority's asserted time, ISO-8601. THEIR clock, not ours. */
  readonly timestampedAt: string;
  /** Authority identity, recorded so a later reader knows who attested. */
  readonly authority: string;
  /** The opaque DER token, base64. Stored verbatim; we never re-encode it. */
  readonly tokenBase64: string;
}

/** One day's anchor: the head we claimed, and the token that attests it. */
export interface DailyAnchor {
  /** YYYY-MM-DD. */
  readonly day: string;
  /** The audit chain head hash as at the end of that day. */
  readonly headHash: string;
  /** Rows covered, so a gap in the chain is visible in the anchor itself. */
  readonly eventCount: number;
  readonly token: TimestampToken;
}

/**
 * The claim an anchor makes, serialised for hashing and storage.
 *
 * Hand-written with a fixed field order rather than JSON.stringify over an
 * object, for the same reason canonicalBom is: a future field reordering must
 * not silently change a stored digest.
 */
export function anchorClaim(day: string, headHash: string, eventCount: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new WormError(`an anchor needs a YYYY-MM-DD day, got '${day}'`);
  }
  if (!/^[0-9a-f]{64}$/.test(headHash)) {
    throw new WormError(
      `an anchor needs a full SHA-256 head hash, got '${headHash}'. A truncated ` +
        'head would anchor a claim weaker than the chain it attests.',
    );
  }
  if (!Number.isInteger(eventCount) || eventCount < 0) {
    throw new WormError(`event count must be a non-negative integer, got ${eventCount}`);
  }
  return [`day=${day}`, `head=${headHash}`, `events=${eventCount}`].join('\u0000');
}

/** The digest submitted to the authority. */
export function anchorDigest(day: string, headHash: string, eventCount: number): string {
  return sha256(anchorClaim(day, headHash, eventCount));
}

/**
 * Every reason an anchor must not be trusted. Empty means it stands.
 *
 * Checked rather than assumed because a token that does not cover our digest
 * is worse than no token: it looks like evidence while attesting nothing we
 * care about, and it would be filed and forgotten.
 */
export function anchorRefusals(anchor: DailyAnchor): readonly string[] {
  const reasons: string[] = [];

  const expected = anchorDigest(anchor.day, anchor.headHash, anchor.eventCount);
  if (anchor.token.digest !== expected) {
    reasons.push(
      'the timestamp token attests a different digest than this anchor claims, so it ' +
        'is evidence about something else',
    );
  }
  if (anchor.token.authority.trim() === '') {
    reasons.push('the anchor does not name the authority that attested it');
  }
  if (anchor.token.tokenBase64.trim() === '') {
    reasons.push(
      'the anchor carries no token. A recorded head with no external attestation is ' +
        'exactly the state an operator rewriting the chain would leave behind.',
    );
  }
  if (Number.isNaN(Date.parse(anchor.token.timestampedAt))) {
    reasons.push(`the attested time '${anchor.token.timestampedAt}' is not parsable`);
  }

  return Object.freeze(reasons);
}

/**
 * Detect gaps in a run of daily anchors.
 *
 * A missing day is the signature of the attack this defends against: an
 * operator who rewrites history has every reason to skip anchoring while they
 * do it, and a system that only checks the anchors it HAS would report
 * everything fine. Days are compared as strings because ISO dates sort
 * lexicographically, which avoids constructing a Date and reading a timezone.
 */
export function anchorGaps(anchors: readonly DailyAnchor[]): readonly string[] {
  if (anchors.length < 2) return Object.freeze([]);

  const days = [...anchors.map((a) => a.day)].sort();
  const gaps: string[] = [];

  for (let i = 1; i < days.length; i += 1) {
    const prev = days[i - 1] as string;
    const cur = days[i] as string;
    if (prev === cur) {
      gaps.push(`${cur} is anchored twice; one of the two attests a head that was replaced`);
      continue;
    }
    const expected = nextDay(prev);
    if (cur !== expected) {
      gaps.push(`no anchor between ${prev} and ${cur}`);
    }
  }
  return Object.freeze(gaps);
}

/** The calendar day after an ISO date, computed without reading a clock. */
function nextDay(day: string): string {
  const parts = day.split('-').map((n) => Number.parseInt(n, 10));
  const y = parts[0] as number;
  const m = parts[1] as number;
  const d = parts[2] as number;
  // Date.UTC is arithmetic over an explicit instant, not a clock read, so it
  // stays inside the purity rule while handling month lengths and leap years.
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

/** Package an anchor for WORM storage. */
export function prepareAnchor(
  anchor: DailyAnchor,
  retainUntil: string,
  mode: RetentionMode,
): WormObject {
  const refusals = anchorRefusals(anchor);
  if (refusals.length > 0) {
    throw new WormError(`refusing to store an unsound anchor: ${refusals.join(' | ')}`);
  }
  // Sorted keys and a trailing newline: the anchor is itself a record that must
  // regenerate byte-identically.
  const body = `${JSON.stringify(anchor, Object.keys(anchor).sort())}\n`;
  return Object.freeze({
    key: anchorKey(anchor.day),
    body,
    sha256: sha256(body),
    mode,
    retainUntil,
  });
}
