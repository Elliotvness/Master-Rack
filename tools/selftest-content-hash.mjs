// The self-test runs BEFORE the checker. A checker that silently stopped
// working would otherwise report a clean pass forever — the failure mode behind
// F-06 and F-08, and the reason this file exists at all.
//
// Fixtures are written to the OS temp directory, never beside the source. The
// other checkers here write probe files into the working tree and delete them
// at the end; on a mount that forbids deletion that leaves stranded fixtures
// and a FALSE FAILURE on the next run, which happened on 2026-09-01.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { violations, loadReleases, canonicalJson, parsePreservingNumbers } from './check-content-hash.mjs';

let failures = 0;
const ok = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}   ${name}`);
  if (!cond) failures++;
};

const BEAMS = {
  manufacturer: 'Test',
  rev: 'test',
  schema_version: 1,
  rows: [
    { family: '40E', series: 'F4M', span_in: 48, capacity_lbs: 5610, face_height_in: 4.0 },
    { family: '59E', series: 'F5M', span_in: 120, capacity_lbs: 7330, face_height_in: 5.9375 },
  ],
};
const beamsText = JSON.stringify(BEAMS, null, 1);

const rowsHash = (text) =>
  createHash('sha256').update(canonicalJson(parsePreservingNumbers(text).rows)).digest('hex');
const fileHash = (text) => createHash('sha256').update(text.replace(/\n+$/, '')).digest('hex');

const root = mkdtempSync(join(tmpdir(), 'rms-content-hash-'));
const release = (name, manifest, text = beamsText) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'beams.json'), text);
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return name;
};

try {
  // 1 — the honest pair, both methods
  release('honest-rows', {
    content_sha256: rowsHash(beamsText),
    content_sha256_method: { id: 'rows-canonical-json', note: 'x' },
  });
  release('honest-file', {
    content_sha256: fileHash(beamsText),
    content_sha256_method: { id: 'file-text-no-trailing-newline', note: 'x' },
  });
  ok('the honest pair passes, under both methods', violations(loadReleases(root)).length === 0);

  // 2 — the two methods really are different, which is why the id is declared
  ok('the two methods disagree on identical data', rowsHash(beamsText) !== fileHash(beamsText));
  const swapped = mkdtempSync(join(tmpdir(), 'rms-content-hash-'));
  mkdirSync(join(swapped, 'r'), { recursive: true });
  writeFileSync(join(swapped, 'r', 'beams.json'), beamsText);
  writeFileSync(
    join(swapped, 'r', 'manifest.json'),
    JSON.stringify({ content_sha256: fileHash(beamsText), content_sha256_method: { id: 'rows-canonical-json' } }, null, 1),
  );
  ok('a hash computed by the OTHER method is caught', violations(loadReleases(swapped)).length === 1);
  rmSync(swapped, { recursive: true, force: true });

  // 3 — a single changed value must go red
  const tampered = JSON.parse(JSON.stringify(BEAMS));
  tampered.rows[0].capacity_lbs = 5611;
  const bad = mkdtempSync(join(tmpdir(), 'rms-content-hash-'));
  mkdirSync(join(bad, 'r'), { recursive: true });
  writeFileSync(join(bad, 'r', 'beams.json'), JSON.stringify(tampered, null, 1));
  writeFileSync(
    join(bad, 'r', 'manifest.json'),
    JSON.stringify({ content_sha256: rowsHash(beamsText), content_sha256_method: { id: 'rows-canonical-json' } }, null, 1),
  );
  ok('one changed capacity value goes red', violations(loadReleases(bad)).length === 1);
  rmSync(bad, { recursive: true, force: true });

  // 4 — the 4.0 trap: normalising the literal must NOT be accepted as a match
  ok(
    'a number written 4.0 keeps its literal, and 4 hashes differently',
    canonicalJson(parsePreservingNumbers('{"a":4.0}')) !== canonicalJson(parsePreservingNumbers('{"a":4}')),
  );

  // 5 — fail closed on anything undeclared or unimplemented
  const closed = mkdtempSync(join(tmpdir(), 'rms-content-hash-'));
  const put = (name, manifest) => {
    mkdirSync(join(closed, name), { recursive: true });
    writeFileSync(join(closed, name, 'beams.json'), beamsText);
    writeFileSync(join(closed, name, 'manifest.json'), JSON.stringify(manifest, null, 1));
  };
  put('no-method', { content_sha256: rowsHash(beamsText) });
  put('unknown-method', { content_sha256: rowsHash(beamsText), content_sha256_method: { id: 'sha256-of-vibes' } });
  put('no-hash', { content_sha256_method: { id: 'rows-canonical-json' } });
  const v = violations(loadReleases(closed));
  ok('an undeclared method fails rather than being guessed', v.some((x) => x.includes('no content_sha256_method')));
  ok('an unimplemented method fails rather than being skipped', v.some((x) => x.includes('not implemented here')));
  ok('a missing content_sha256 fails', v.some((x) => x.includes('missing or not a string')));
  ok('all three fail-closed cases are caught, none silently', v.length === 3);
  rmSync(closed, { recursive: true, force: true });

  // 6 — a vacuous pass is refused
  ok('an empty release set is refused, not reported clean', violations([]).length === 1);

  // 7 — the plain-string form of the method field is still accepted
  const legacy = mkdtempSync(join(tmpdir(), 'rms-content-hash-'));
  mkdirSync(join(legacy, 'r'), { recursive: true });
  writeFileSync(join(legacy, 'r', 'beams.json'), beamsText);
  writeFileSync(
    join(legacy, 'r', 'manifest.json'),
    JSON.stringify({ content_sha256: rowsHash(beamsText), content_sha256_method: 'rows-canonical-json' }, null, 1),
  );
  ok('a bare-string method id is accepted', violations(loadReleases(legacy)).length === 0);
  rmSync(legacy, { recursive: true, force: true });
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`selftest-content-hash FAIL — ${failures} case(s)`);
  process.exit(1);
}
console.log('selftest-content-hash: PASS — 11 cases, fixtures written to the OS temp dir only.');
