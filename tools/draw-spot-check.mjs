#!/usr/bin/env node
/**
 * draw-spot-check — draw the cells an approver must read, and pin the draw.
 *
 * A gate nobody can satisfy is not a control, it is an obstacle. Section 10.2
 * requires the approver to spot-check 20 cells or 5% of a table, "with the tool
 * drawing the sample at random", because an approver-chosen sample drifts
 * toward the cells that are easy to read — which are not the cells that are
 * wrong. This is that tool.
 *
 * It writes `pending_spot_checks` into the release manifest. Pinning the draw
 * is the point: without it, an unfavourable sample can be redrawn until an easy
 * one appears, and the randomness stops meaning anything. The seed is recorded
 * so a reviewer in two years can redraw the same cells and confirm the approver
 * checked what they said they checked.
 *
 *   node tools/draw-spot-check.mjs interlake-2026-09 [--seed N]
 *
 * The approver then reads each listed cell off the named page of the source
 * document and reports the outcome. Any mismatch fails the entire release.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function requiredSampleSize(cells) {
  return Math.min(cells, Math.max(20, Math.ceil(cells * 0.05)));
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function draw(cellIds, seed, size) {
  const pool = [...cellIds];
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < size; i += 1) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}

/**
 * Cell identifiers a human can find on a page, not array indices.
 *
 * This duplicates `packages/kernel-catalog/src/cell-ids.ts` in plain JS, because
 * a `.mjs` tool cannot import the TypeScript package. The duplication is only
 * permitted because `selftest-spot-check-draw.mjs` asserts the two agree over
 * the real datasets — if they ever diverge, the tool pins cells the gate will
 * refuse, and an approver reads twenty cells for nothing.
 */
export function cellsOf(dir, dataset) {
  const path = join(ROOT, 'data/catalog', dir, `${dataset}.json`);
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (dataset === 'beams') {
    return doc.rows.map((r) => `${r.family}/${r.series}/${r.span_in}in`);
  }
  if (dataset === 'frames') {
    const ids = [];
    for (const t of doc.tables) {
      for (const [hbl, values] of Object.entries(t.rows)) {
        for (let i = 0; i < values.length; i += 1) {
          ids.push(`${t.table_id}/HbL${hbl}/col${i}`);
        }
      }
    }
    return ids;
  }
  throw new Error(`unknown dataset '${dataset}'`);
}

function main() {
const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/draw-spot-check.mjs <release-dir> [--seed N]');
  process.exit(2);
}
const seedArg = process.argv.indexOf('--seed');
const manifestPath = join(ROOT, 'data/catalog', dir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (Array.isArray(manifest.pending_spot_checks) && manifest.pending_spot_checks.length > 0) {
  console.error(
    `${dir} already has a pinned draw. Refusing to redraw: a sample that can be redrawn until it ` +
      'is convenient is not a random sample. Delete pending_spot_checks deliberately if the draw ' +
      'must genuinely be reset, and record why.',
  );
  process.exit(1);
}

const seed = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 20260901;
const pending = [];
for (const dataset of manifest.datasets ?? []) {
  const ids = cellsOf(dir, dataset);
  const size = requiredSampleSize(ids.length);
  pending.push({
    dataset,
    cells: ids.length,
    seed,
    sampled_cells: draw(ids, seed, size),
    source_document: manifest.source_document,
    page_ref: manifest.page_ref,
  });
  console.log(`\n${dataset}: read ${size} of ${ids.length} cells (seed ${seed})`);
  console.log(draw(ids, seed, size).join('\n'));
}

manifest.pending_spot_checks = pending;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`\nPinned into ${dir}/manifest.json. Read each cell off the named page, then move the`);
console.log('entry into human_spot_checks with checked_by, checked_at and outcome: MATCHED.');
console.log('Any mismatch fails the entire release — there is no partial pass.');
}

// Same guard as check-boundaries.mjs and check-rls.mjs: importing this module
// for its helpers must not draw a sample or write a manifest.
if (process.argv[1]?.endsWith('draw-spot-check.mjs')) {
  main();
}
