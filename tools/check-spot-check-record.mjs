// The two-person rule's evidence is a PAIR of records, not one:
//
//   pending_spot_checks  — the question. A tool-drawn sample, pinned before
//                          anybody read a chart. draw-spot-check.mjs refuses to
//                          redraw while it exists, because a sample that can be
//                          redrawn until it is convenient is not a sample.
//   human_spot_checks    — the answer. What a named person actually read, when,
//                          and whether it matched.
//
// record-spot-check.mjs deliberately KEEPS the pin after recording: "it is the
// record of what was ASKED, and removing it once answered would delete the
// evidence that the sample was fixed before it was read."
//
// The whole value of that design is that the answer covers the question. Nothing
// asserted it. A recorder bug, a rebase, or a hand-edit could leave a human
// record that signs off a DIFFERENT set of cells from the one that was pinned,
// and every existing gate would still pass: approveRelease reads only
// human_spot_checks (release.ts:243), and never compares it to the pin.
//
// This is that comparison. Review finding F-14, as restated after reading the
// mechanism rather than pattern-matching it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const arrayEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** @returns {string[]} problems; empty means every answered pin agrees with its record. */
export function violations(releases) {
  const out = [];
  if (releases.length === 0) {
    out.push('no catalog releases found — refusing to report coverage of nothing');
    return out;
  }
  for (const r of releases) {
    const pins = Array.isArray(r.manifest['pending_spot_checks']) ? r.manifest['pending_spot_checks'] : [];
    const records = Array.isArray(r.manifest['human_spot_checks']) ? r.manifest['human_spot_checks'] : [];

    for (const rec of records) {
      const pin = pins.find((p) => p.dataset === rec.dataset);
      if (pin === undefined) {
        out.push(
          `${r.name}/${rec.dataset}: a human spot-check record exists with no pinned draw behind it — ` +
            'the sample cannot be shown to have been fixed before it was read',
        );
        continue;
      }
      const pinCells = pin.sampled_cells ?? [];
      const recCells = rec.sampled_cells ?? [];
      if (!arrayEq(pinCells, recCells)) {
        out.push(
          `${r.name}/${rec.dataset}: the signed record does not cover the pinned draw\n` +
            `      pinned  (${pinCells.length}): ${pinCells.join(', ')}\n` +
            `      signed  (${recCells.length}): ${recCells.join(', ')}`,
        );
      }
      const pinSupp = pin.supplementary_cells ?? [];
      const recSupp = rec.supplementary_cells ?? [];
      if (!arrayEq(pinSupp, recSupp)) {
        out.push(
          `${r.name}/${rec.dataset}: supplementary cells differ between the pin and the record — ` +
            `pinned [${pinSupp.join(', ')}], signed [${recSupp.join(', ')}]`,
        );
      }
      if (pin.seed !== undefined && rec.seed !== undefined && pin.seed !== rec.seed) {
        out.push(`${r.name}/${rec.dataset}: seed differs — pinned ${pin.seed}, signed ${rec.seed}`);
      }
      if (pin.cells !== undefined && rec.cells !== undefined && pin.cells !== rec.cells) {
        out.push(
          `${r.name}/${rec.dataset}: population size differs — pinned ${pin.cells}, signed ${rec.cells}`,
        );
      }
    }
  }
  return out;
}

export function loadReleases(root) {
  const out = [];
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const mp = join(root, e.name, 'manifest.json');
    if (!existsSync(mp)) continue;
    out.push({ name: e.name, manifest: JSON.parse(readFileSync(mp, 'utf8')) });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const releases = loadReleases('data/catalog');
  const v = violations(releases);
  if (v.length) {
    console.error('check-spot-check-record FAIL');
    for (const x of v) console.error('  - ' + x);
    process.exit(1);
  }
  const signed = releases.reduce((n, r) => n + (r.manifest['human_spot_checks']?.length ?? 0), 0);
  console.log(
    `check-spot-check-record: PASS — ${signed} signed record(s) across ${releases.length} release(s) cover their pinned draw exactly.`,
  );
}
