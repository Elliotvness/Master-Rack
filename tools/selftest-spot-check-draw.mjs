#!/usr/bin/env node
/**
 * selftest-spot-check-draw — the tool and the kernel must draw the same cells.
 *
 * `tools/draw-spot-check.mjs` pins the sample an approver must read.
 * `packages/kernel-catalog` re-derives that sample when the release is
 * approved, and refuses the release if the record disagrees. The two
 * implementations are separate — a `.mjs` tool cannot import the TypeScript
 * package — so they can drift, and drift here is expensive in a specific way:
 * the tool pins twenty cells, a person spends an hour reading them off a PDF,
 * and the gate then refuses the honest record they wrote.
 *
 * Nothing else in the build would notice. `check-determinism` pins the engine,
 * not this. So: assert the agreement, over the real datasets, on every run.
 *
 * Three things are compared, because any one of them alone would pass while
 * the other two are wrong:
 *   1. the CELL IDS, in order — the draw is a shuffle over that list
 *   2. the REQUIRED SIZE for the same cell count
 *   3. the DRAWN SAMPLE for the same seed, in order
 *
 * Needs `tsc --build` to have run (it reads the compiled kernel), which
 * `pnpm verify` does first.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as tool from './draw-spot-check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'packages/kernel-catalog/dist');
const CATALOG = join(ROOT, 'data/catalog');

if (!existsSync(join(DIST, 'cell-ids.js'))) {
  console.error(
    'selftest-spot-check-draw: packages/kernel-catalog/dist is missing. Run `pnpm typecheck` ' +
      'first — this compares the tool against the COMPILED kernel, not against a copy of it.',
  );
  process.exit(1);
}

const { cellIdsOf } = await import(pathToFileURL(join(DIST, 'cell-ids.js')));
const { drawSpotCheckSample, drawSupplementarySample, requiredSampleSize } = await import(
  pathToFileURL(join(DIST, 'spot-check.js')),
);
const { publishedKeyOf } = await import(pathToFileURL(join(DIST, 'cell-ids.js')));

/** Seeds to compare on. The pinned one, plus values that stress the shuffle. */
const SEEDS = [20260901, 0, 1, 7, 4294967295, 123456789];

/** Datasets with a cell-id derivation on both sides. */
const DATASETS = ['beams', 'frames'];

let failures = 0;
let compared = 0;

const releases = readdirSync(CATALOG, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const dir of releases) {
  // Driven by the FILES present, not by the manifest's `datasets` list.
  // interlake-2026-08 ships both datasets and declares neither, so trusting the
  // manifest would have skipped a whole release in silence — and a checker that
  // skips quietly is the thing every self-test here exists to prevent.
  for (const dataset of DATASETS) {
    const datasetPath = join(CATALOG, dir, `${dataset}.json`);
    if (!existsSync(datasetPath)) continue;
    const doc = JSON.parse(readFileSync(datasetPath, 'utf8'));

    const toolIds = tool.cellsOf(dir, dataset);
    const kernelIds = [...cellIdsOf(dataset, doc)];

    if (toolIds.length !== kernelIds.length || toolIds.some((id, i) => id !== kernelIds[i])) {
      failures += 1;
      const at = toolIds.findIndex((id, i) => id !== kernelIds[i]);
      console.error(
        `  MISS  ${dir}/${dataset}: cell ids differ (tool ${toolIds.length}, kernel ` +
          `${kernelIds.length}` +
          (at >= 0 ? `, first at [${at}]: '${toolIds[at]}' vs '${kernelIds[at]}'` : '') +
          ')',
      );
      continue;
    }

    if (tool.requiredSampleSize(toolIds.length) !== requiredSampleSize(kernelIds.length)) {
      failures += 1;
      console.error(
        `  MISS  ${dir}/${dataset}: required sample size differs for ${toolIds.length} cells`,
      );
      continue;
    }

    // The published-key rule decides which rows count as one reading, so a
    // disagreement here changes the top-up without changing any draw.
    const keyMismatch = kernelIds.find(
      (id) => tool.publishedKeyOf(dataset, id) !== publishedKeyOf(dataset, id),
    );
    if (keyMismatch !== undefined) {
      failures += 1;
      console.error(
        `  MISS  ${dir}/${dataset}: published key differs for '${keyMismatch}' ` +
          `(tool '${tool.publishedKeyOf(dataset, keyMismatch)}', ` +
          `kernel '${publishedKeyOf(dataset, keyMismatch)}')`,
      );
    }

    for (const seed of SEEDS) {
      const size = requiredSampleSize(kernelIds.length);
      const a = tool.draw(toolIds, seed, size);
      const b = [...drawSpotCheckSample(kernelIds, seed, size)];
      compared += 1;
      if (a.length !== b.length || a.some((id, i) => id !== b[i])) {
        failures += 1;
        console.error(`  MISS  ${dir}/${dataset} @ seed ${seed}: the drawn samples differ`);
        console.error(`        tool:   ${a.slice(0, 3).join(', ')}…`);
        console.error(`        kernel: ${b.slice(0, 3).join(', ')}…`);
        continue;
      }

      // And the top-up, which is where the published-key rule actually bites.
      const covered = new Set(b.map((id) => publishedKeyOf(dataset, id))).size;
      const short = size - covered;
      const ta = tool.drawSupplementary(dataset, toolIds, seed, a, short);
      const tb = [...drawSupplementarySample(dataset, kernelIds, seed, b, short)];
      compared += 1;
      if (ta.length !== tb.length || ta.some((id, i) => id !== tb[i])) {
        failures += 1;
        console.error(
          `  MISS  ${dir}/${dataset} @ seed ${seed}: the top-ups differ (short by ${short})`,
        );
        console.error(`        tool:   ${ta.join(', ')}`);
        console.error(`        kernel: ${tb.join(', ')}`);
      }
    }
    const shortAt = SEEDS.filter((seed) => {
      const size = requiredSampleSize(kernelIds.length);
      const b = drawSpotCheckSample(kernelIds, seed, size);
      return new Set([...b].map((id) => publishedKeyOf(dataset, id))).size < size;
    });
    console.log(
      `  ok    ${dir}/${dataset}: ${kernelIds.length} ids, ${SEEDS.length} seeds` +
        (shortAt.length > 0 ? `, top-up needed at ${shortAt.length} of them` : ''),
    );
  }
}

if (compared === 0) {
  console.error('selftest-spot-check-draw: FAIL — nothing was compared. A vacuous pass is a fail.');
  process.exitCode = 1;
} else if (failures > 0) {
  console.error(`\nselftest-spot-check-draw: FAIL — ${failures} disagreement(s).`);
  process.exitCode = 1;
} else {
  console.log(`\nselftest-spot-check-draw: PASS — ${compared} draws agree.`);
}
