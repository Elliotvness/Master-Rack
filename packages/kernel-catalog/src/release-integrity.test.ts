import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  REQUIRED_DATASETS,
  approvalRefusals,
  canPinForNewRevision,
  completenessRefusals,
  loadReleaseManifest,
  loadFrameTables,
  FrameCatalog,
} from './index.js';

/**
 * The gate, run against the REAL releases on disk.
 *
 * Everything in `release.test.ts` proves `approvalRefusals` behaves correctly on
 * objects a test constructed. None of it had ever looked at
 * `data/catalog/*\/manifest.json`, which is how `interlake-2026-09` came to
 * carry `"status": "APPROVED"` while shipping beams and no frames: the string
 * was written by hand, and no control read it back.
 *
 * A gate that only sees test fixtures is guarding the test.
 */

const CATALOG = fileURLToPath(new URL('../../../data/catalog/', import.meta.url));

function releaseDirs(): readonly string[] {
  return readdirSync(CATALOG, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function manifestOf(dir: string) {
  return loadReleaseManifest(JSON.parse(readFileSync(`${CATALOG}${dir}/manifest.json`, 'utf8')));
}

const DATASET_FILE: Readonly<Record<string, string>> = { beams: 'beams.json', frames: 'frames.json' };

describe('every release on disk parses', () => {
  it('finds at least the two known releases', () => {
    // Guard against a vacuous pass: if the glob ever stops finding releases,
    // every assertion below would hold trivially over an empty set.
    expect(releaseDirs().length).toBeGreaterThanOrEqual(2);
    expect(releaseDirs()).toContain('interlake-2026-09');
  });

  it.each(releaseDirs())('%s loads into the typed manifest', (dir) => {
    const m = manifestOf(dir);
    expect(m.rev).not.toBe('');
    expect(m.manufacturer).not.toBe('');
  });

  it.each(releaseDirs())('%s declares exactly the dataset files it ships', (dir) => {
    const m = manifestOf(dir);
    for (const dataset of m.datasets) {
      const file = DATASET_FILE[dataset];
      expect(file, `unknown dataset '${dataset}' declared by ${dir}`).toBeDefined();
      expect(existsSync(`${CATALOG}${dir}/${file}`), `${dir}/${file} declared but absent`).toBe(true);
    }
  });
});

describe('AC-18 over the real releases, not over a fixture', () => {
  it.each(releaseDirs())('%s: if it says APPROVED, it withstands the gate', (dir) => {
    const m = manifestOf(dir);
    if (m.status !== 'APPROVED') return;

    // A release cannot be APPROVED without a named approver: `approvedBy` is
    // the thing the gate is about, so a null here is not a skip, it is a fail.
    expect(m.approvedBy, `${dir} is APPROVED with no approver`).not.toBeNull();

    const reasons = approvalRefusals(m, m.approvedBy ?? '');
    expect(reasons, `${dir} is marked APPROVED but the gate refuses it: ${reasons.join(' | ')}`)
      .toEqual([]);
  });

  it.each(releaseDirs())('%s: if it says APPROVED, it can serve the check set', (dir) => {
    const m = manifestOf(dir);
    if (m.status !== 'APPROVED') return;
    expect(completenessRefusals(m)).toEqual([]);
    for (const dataset of REQUIRED_DATASETS) {
      expect(m.datasets, `${dir} does not ship '${dataset}'`).toContain(dataset);
    }
  });

  it('interlake-2026-08 is QUARANTINED, and is refused for stated reasons', () => {
    // It was never approved -- checked_by has always been empty -- and 2026-09
    // proved 264 of its capacities appear nowhere in the source document. It is
    // wrong, not old, and the status must say the harder of the two things.
    const m = manifestOf('interlake-2026-08');
    expect(m.status).toBe('QUARANTINED');
    expect(m.correctedBy).toBe('2026-09');
    expect(m.quarantineReason).not.toBeNull();

    const reasons = approvalRefusals(m, 'Elliott Villacorta');
    expect(reasons.some((r) => r.includes("corrected by '2026-09'"))).toBe(true);
    expect(canPinForNewRevision(m)).toBe(false);
  });

  it('no quarantined release keeps its wrong values hidden', () => {
    // The values stay exactly as transcribed. Silently "fixing" a quarantined
    // extract destroys the ability to reconcile it against its source and
    // erases the record of what was believed.
    const m = manifestOf('interlake-2026-08');
    expect(m.contentSha256).toBe(
      '9c3feb456c57b0fb6924a3661d4a493a6c4330ee859bbfb1cb0d683f25fbabcc',
    );
  });
});

describe('the approved release resolves a frame as well as a beam', () => {
  const dir = 'interlake-2026-09';

  it('ships frames.json and it loads', () => {
    const doc = JSON.parse(readFileSync(`${CATALOG}${dir}/frames.json`, 'utf8'));
    const catalog = new FrameCatalog(loadFrameTables(doc));
    expect(catalog.tableCount).toBe(3);
    expect(catalog.cellCount).toBe(435);
  });

  it('carried the frame tables forward from 2026-08 byte-for-byte', () => {
    // The 2026-09 re-source read PSG 2025 p.88 for beam CAPACITY only. If a
    // frame value ever moves, it must move because someone re-read the chart
    // and said so — not because a copy drifted.
    const hash = (p: string): string =>
      createHash('sha256')
        .update(JSON.stringify(JSON.parse(readFileSync(p, 'utf8')).tables))
        .digest('hex');
    const older = hash(`${CATALOG}interlake-2026-08/frames.json`);
    const newer = hash(`${CATALOG}${dir}/frames.json`);
    expect(newer).toBe(older);

    const doc = JSON.parse(readFileSync(`${CATALOG}${dir}/frames.json`, 'utf8')) as {
      tables_sha256: string;
      rev: string;
    };
    expect(doc.rev).toBe('2026-09');
    expect(doc.tables_sha256).toBe(newer);
  });

  it('holds approval on the release, never on the dataset', () => {
    // Two records of one fact is how they come to disagree. The release
    // manifest gates pinning, so it is the one that carries the signature.
    const doc = JSON.parse(readFileSync(`${CATALOG}${dir}/frames.json`, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(doc['status']).toBeUndefined();
    expect(doc['approved_by']).toBeUndefined();
    expect(doc['approved_at']).toBeUndefined();
  });

  it('records a verification path per dataset, each naming its own cell count', () => {
    const m = manifestOf(dir);
    const byDataset = new Map(m.verificationPaths.map((p) => [p.dataset, p]));
    expect(byDataset.get('beams')?.cells).toBe(336);
    expect(byDataset.get('frames')?.cells).toBe(435);
  });
});
