#!/usr/bin/env node
/**
 * record-spot-check — write the approver's reading into the manifest, safely.
 *
 * The gate re-derives the draw and refuses a record whose cells are not the ones
 * the tool chose. That is deliberate, and it makes hand-editing the JSON a good
 * way to spend an hour reading a chart and then be refused on a typo. So the
 * recorder copies the pinned cells VERBATIM, in the drawn order, and fills in
 * only what a person can legitimately supply: who read them, when, and whether
 * they matched.
 *
 *   node tools/record-spot-check.mjs interlake-2026-09 --checked-by "Elliott Villacorta" --matched
 *   node tools/record-spot-check.mjs interlake-2026-09 --checked-by "…" --dataset beams --matched
 *   node tools/record-spot-check.mjs interlake-2026-09 --checked-by "…" \
 *     --failed "59E/F5M/120in reads 7530 not 7330"
 *
 * `--matched` and `--failed` are both explicit and exactly one is required. There
 * is no default, because the default would be a signature nobody typed — and the
 * signature is the entire product of the hour spent reading the chart.
 *
 * It does not approve anything. Approval is a separate act: this makes the
 * release approvABLE, and prints what the gate now says.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const dir = process.argv[2];
if (!dir || dir.startsWith('--')) {
  console.error('usage: node tools/record-spot-check.mjs <release-dir> --checked-by "Name" [--dataset X] [--failed "note"]');
  process.exit(2);
}

const checkedBy = arg('checked-by');
if (!checkedBy || checkedBy.trim() === '') {
  console.error('--checked-by is required: the signature attaches to the person who did the reading.');
  process.exit(2);
}

const only = arg('dataset');
const failed = arg('failed');
const matched = process.argv.includes('--matched');

if (matched === (failed !== undefined)) {
  console.error(
    'exactly one of --matched or --failed is required. There is no default: a default would be ' +
      'a signature nobody typed, and the signature is the whole product of reading the chart.',
  );
  process.exit(2);
}
const checkedAt = arg('checked-at') ?? new Date().toISOString().slice(0, 10);

const manifestPath = join(ROOT, 'data/catalog', dir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const pending = manifest.pending_spot_checks ?? [];

if (pending.length === 0) {
  console.error(`${dir} has no pinned draw to record against. Nothing to do.`);
  process.exit(1);
}

if (checkedBy === manifest.digitised_by) {
  console.error(
    `--checked-by is '${checkedBy}', which is the digitiser. A machine is a tool, not an ` +
      'independent party, and a person may not check their own extract (§10.2).',
  );
  process.exit(1);
}

const existing = new Map((manifest.human_spot_checks ?? []).map((c) => [c.dataset, c]));
const force = process.argv.includes('--force');
const recorded = [];

// Overwriting an existing record would replace one person's signature with
// another's, silently. It is occasionally right — a re-read after a corrected
// extract — and never right by accident.
for (const entry of pending) {
  if (only !== undefined && entry.dataset !== only) continue;
  const prior = existing.get(entry.dataset);
  if (prior !== undefined && !force) {
    console.error(
      `${entry.dataset} already carries a spot-check recorded by '${prior.checked_by}' on ` +
        `${prior.checked_at} (${prior.outcome}). Pass --force to replace it, and know that you are ` +
        'replacing a signature.',
    );
    process.exit(1);
  }
}

for (const entry of pending) {
  if (only !== undefined && entry.dataset !== only) continue;
  recorded.push({
    dataset: entry.dataset,
    cells: entry.cells,
    // Verbatim, in the drawn order. The gate compares against
    // drawSpotCheckSample(cellIds, seed, requiredSampleSize(cells)), and the
    // draw records its order precisely so this comparison is possible.
    sampled_cells: [...entry.sampled_cells],
    seed: entry.seed,
    source_document: entry.source_document,
    page_ref: entry.page_ref,
    checked_by: checkedBy,
    checked_at: checkedAt,
    outcome: failed === undefined ? 'MATCHED' : `MISMATCH: ${failed}`,
  });
  existing.delete(entry.dataset);
}

if (recorded.length === 0) {
  console.error(`no pinned draw for dataset '${only}' in ${dir}.`);
  process.exit(1);
}

manifest.human_spot_checks = [...existing.values(), ...recorded].sort((a, b) =>
  a.dataset.localeCompare(b.dataset),
);

// The pinned draw stays in the file. It is the record of what was ASKED, and
// removing it once answered would delete the evidence that the sample was fixed
// before it was read.
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));

for (const r of recorded) {
  console.log(`recorded ${r.dataset}: ${r.sampled_cells.length} cells, ${r.checked_by}, ${r.outcome}`);
}
console.log(`\nWritten to data/catalog/${dir}/manifest.json.`);
console.log('The pinned draw is kept — it is the record of what was asked.\n');

console.log('Now run the gate against the real file:');
console.log('  pnpm test packages/kernel-catalog/src/release-integrity.test.ts');
console.log('\nThe release stays DRAFT until someone calls approveRelease(). This only makes it');
console.log('approvable — and if any dataset is still unrecorded, it is not approvable yet.');

const stillPending = pending
  .filter((e) => !manifest.human_spot_checks.some((c) => c.dataset === e.dataset))
  .map((e) => e.dataset);
if (stillPending.length > 0) {
  console.log(`\nStill unrecorded: ${stillPending.join(', ')}.`);
}
