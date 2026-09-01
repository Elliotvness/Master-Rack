// Runs before the checker. Fixtures go to the OS temp directory, never beside
// the source: a probe left in the working tree on a mount that forbids deletion
// makes the NEXT run report a false failure, which happened on 2026-09-01.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { violations, loadReleases } from './check-spot-check-record.mjs';

let failures = 0;
const ok = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}   ${name}`);
  if (!cond) failures++;
};

const CELLS = ['59ER/F5M/120in', '27E/F3M/96in', '40E/F4M/60in'];
const pin = (over = {}) => ({
  dataset: 'beams',
  cells: 336,
  seed: 20260901,
  sampled_cells: [...CELLS],
  supplementary_cells: ['65ER/F5M/78in'],
  ...over,
});
const record = (over = {}) => ({
  dataset: 'beams',
  cells: 336,
  seed: 20260901,
  sampled_cells: [...CELLS],
  supplementary_cells: ['65ER/F5M/78in'],
  checked_by: 'A Person',
  checked_at: '2026-09-01',
  outcome: 'MATCHED',
  ...over,
});

const root = mkdtempSync(join(tmpdir(), 'rms-spot-record-'));
const put = (name, manifest) => {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return name;
};
const only = (manifest) => {
  const d = mkdtempSync(join(tmpdir(), 'rms-spot-record-'));
  mkdirSync(join(d, 'r'), { recursive: true });
  writeFileSync(join(d, 'r', 'manifest.json'), JSON.stringify(manifest, null, 1));
  const v = violations(loadReleases(d));
  rmSync(d, { recursive: true, force: true });
  return v;
};

try {
  put('honest', { pending_spot_checks: [pin()], human_spot_checks: [record()] });
  ok('a record that covers its pin passes', violations(loadReleases(root)).length === 0);

  ok(
    'a record with no pin behind it goes red',
    only({ human_spot_checks: [record()] }).some((x) => x.includes('no pinned draw behind it')),
  );
  ok(
    'a signature over DIFFERENT cells goes red',
    only({
      pending_spot_checks: [pin()],
      human_spot_checks: [record({ sampled_cells: ['59ER/F5M/120in', '27E/F3M/96in', '36E/F3M/84in'] })],
    }).some((x) => x.includes('does not cover the pinned draw')),
  );
  ok(
    'a REORDERED signature goes red — the draw is ordered evidence',
    only({
      pending_spot_checks: [pin()],
      human_spot_checks: [record({ sampled_cells: [...CELLS].reverse() })],
    }).some((x) => x.includes('does not cover the pinned draw')),
  );
  ok(
    'dropping one cell from the signature goes red',
    only({
      pending_spot_checks: [pin()],
      human_spot_checks: [record({ sampled_cells: CELLS.slice(0, 2) })],
    }).some((x) => x.includes('does not cover the pinned draw')),
  );
  ok(
    'a changed supplementary cell goes red',
    only({
      pending_spot_checks: [pin()],
      human_spot_checks: [record({ supplementary_cells: ['65E/F5M/78in'] })],
    }).some((x) => x.includes('supplementary cells differ')),
  );
  ok(
    'a changed seed goes red',
    only({ pending_spot_checks: [pin()], human_spot_checks: [record({ seed: 1 })] }).some((x) =>
      x.includes('seed differs'),
    ),
  );
  ok(
    'a changed population size goes red',
    only({ pending_spot_checks: [pin()], human_spot_checks: [record({ cells: 168 })] }).some((x) =>
      x.includes('population size differs'),
    ),
  );
  ok(
    'a pin with no record yet is NOT a failure — that is just unread',
    only({ pending_spot_checks: [pin()] }).length === 0,
  );
  ok('an empty release set is refused, not reported clean', violations([]).length === 1);
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`selftest-spot-check-record FAIL — ${failures} case(s)`);
  process.exit(1);
}
console.log('selftest-spot-check-record: PASS — 10 cases, fixtures written to the OS temp dir only.');
