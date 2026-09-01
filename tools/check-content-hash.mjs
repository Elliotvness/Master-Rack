// Every catalog release records a `content_sha256`. Until 2026-09-01 nothing
// recomputed it: `load-manifest.ts` reads it as an opaque string and the only
// test asserts the 2026-08 value equals a hard-coded literal — which usefully
// pins that quarantine did not alter the data, and says nothing about whether
// the hash describes it. Review finding F-19.
//
// Worse, the method silently differed between two releases sitting in the same
// directory: 2026-09 hashes the canonical `rows` array, 2026-08 hashes the file
// text. One field name, two definitions, no verifier.
//
// So each manifest now DECLARES its method as an id, and this checker recomputes
// by that id. It FAILS CLOSED: a manifest with no declared method, or one this
// checker does not implement, is a failure — never a guess and never a skip.
// A checker that silently skips what it cannot handle reports a clean pass
// forever, which is the failure mode F-06 and F-08 were.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class ContentHashError extends Error {}

/**
 * Canonical JSON matching Python's
 * `json.dumps(obj, sort_keys=True, separators=(',',':'))` — which is what wrote
 * the hash. Keys sorted, no whitespace, and **numbers emitted as their original
 * source literal**.
 *
 * That last part is not pedantry. `beams.json` carries `"face_height_in": 4.0`
 * for the families whose published face height is a whole number. Python keeps
 * it a float and writes `4.0`; every other JSON implementation parses it to the
 * number 4 and writes `4`. One character, a different digest, identical data.
 *
 * So the digest as stored is reproducible only by an implementation that
 * preserves the literal. Node 22's source-preserving reviver gives us that.
 * Recorded as review finding F-19: an integrity number that only one language
 * can reproduce is a weak integrity number, and re-basing it onto an
 * implementation-independent form is a change to an APPROVED release, which is
 * a decision for the approver rather than for this checker.
 */
export function canonicalJson(value) {
  if (value === null) return 'null';
  if (value instanceof RawNumber) return value.source;
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(value[k]))
      .join(',') +
    '}'
  );
}

class RawNumber {
  constructor(source) {
    this.source = source;
  }
}

/** Parse keeping every number's original literal text. Throws if the runtime
 *  cannot do it, rather than silently hashing a normalised form. */
export function parsePreservingNumbers(text) {
  let supported = false;
  const parsed = JSON.parse(text, function (_key, value, context) {
    if (typeof value === 'number' && context !== undefined && typeof context.source === 'string') {
      supported = true;
      return new RawNumber(context.source);
    }
    return value;
  });
  if (!supported) {
    throw new ContentHashError(
      'this runtime does not expose source text in the JSON reviver (Node 22+ required); ' +
        'refusing to hash a normalised form and call it a match',
    );
  }
  return parsed;
}

const METHODS = {
  'rows-canonical-json': (beamsText) =>
    createHash('sha256').update(canonicalJson(parsePreservingNumbers(beamsText).rows)).digest('hex'),
  'file-text-no-trailing-newline': (beamsText) =>
    createHash('sha256').update(beamsText.replace(/\n+$/, '')).digest('hex'),
};

export const KNOWN_METHODS = Object.keys(METHODS).sort();

/** @returns {string[]} problems; empty means every release verified. */
export function violations(releases) {
  const out = [];
  if (releases.length === 0) {
    out.push('no catalog releases found — refusing to report coverage of nothing');
    return out;
  }
  for (const r of releases) {
    const declared = r.manifest['content_sha256_method'];
    const id = declared && typeof declared === 'object' ? declared.id : declared;
    if (typeof id !== 'string' || id.length === 0) {
      out.push(`${r.name}: no content_sha256_method declared — cannot verify, refusing to assume`);
      continue;
    }
    const fn = METHODS[id];
    if (fn === undefined) {
      out.push(`${r.name}: content_sha256_method '${id}' is not implemented here (known: ${KNOWN_METHODS.join(', ')})`);
      continue;
    }
    const stored = r.manifest['content_sha256'];
    if (typeof stored !== 'string') {
      out.push(`${r.name}: content_sha256 is missing or not a string`);
      continue;
    }
    const actual = fn(r.beamsText);
    if (actual !== stored) {
      out.push(`${r.name}: content_sha256 disagrees with the data under its own declared method '${id}'\n      stored: ${stored}\n      actual: ${actual}`);
    }
  }
  return out;
}

export function loadReleases(root) {
  const out = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = join(root, name.name);
    const mp = join(dir, 'manifest.json');
    const bp = join(dir, 'beams.json');
    if (!existsSync(mp) || !existsSync(bp)) continue;
    out.push({
      name: name.name,
      manifest: JSON.parse(readFileSync(mp, 'utf8')),
      beamsText: readFileSync(bp, 'utf8'),
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const releases = loadReleases('data/catalog');
  const v = violations(releases);
  if (v.length) {
    console.error('check-content-hash FAIL');
    for (const x of v) console.error('  - ' + x);
    process.exit(1);
  }
  console.log(`check-content-hash: PASS — ${releases.length} release(s) verified against their declared method.`);
}
