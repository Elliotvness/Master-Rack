import { describe, expect, it } from 'vitest';

import { ManifestError, loadReleaseManifest } from './index.js';

/**
 * The parser between hand-edited JSON and the objects the approval gate trusts.
 *
 * It existed with no test file of its own: its only exercise was
 * `release-integrity.test.ts` loading the two real manifests, which walk the
 * happy path and one or two others. A parser is mostly its error paths, and a
 * manifest half-read is how a release gets approved on fields nobody supplied.
 */

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manufacturer: 'Interlake Mecalux',
    rev: '2026-09',
    status: 'DRAFT',
    source_document: 'PSG 2025',
    source_url: 'https://example.invalid',
    page_ref: 'p.88',
    units: 'lbs',
    load_basis: 'per pair, UDL, L/180',
    deflection_limit: 'L/180',
    code_basis: '2012 RMI and 2001 AISI',
    digitised_by: 'automated extract',
    digitised_at: '2026-08-19',
    approved_by: null,
    approved_at: null,
    verification_paths: [
      { dataset: 'beams', kind: 'full_cross_check', cells: 336, note: 'n' },
    ],
    human_spot_checks: [
      {
        dataset: 'beams',
        cells: 336,
        sampled_cells: ['a', 'b'],
        seed: 20260901,
        source_document: 'PSG 2025',
        page_ref: 'p.88',
        checked_by: 'Elliott Villacorta',
        checked_at: '2026-09-01',
        outcome: 'MATCHED',
      },
    ],
    corrected_by: null,
    quarantine_reason: null,
    datasets: ['beams', 'frames'],
    content_sha256: 'abc',
    source_anomalies: [],
    constraints: { bracing_over_in: 126 },
    ...over,
  };
}

describe('a well-formed manifest becomes the shape the gate reads', () => {
  it('maps snake_case to the typed record', () => {
    const m = loadReleaseManifest(raw());
    expect(m.rev).toBe('2026-09');
    expect(m.status).toBe('DRAFT');
    expect(m.digitisedBy).toBe('automated extract');
    expect(m.datasets).toEqual(['beams', 'frames']);
    expect(m.verificationPaths[0]?.dataset).toBe('beams');
    expect(m.humanSpotChecks[0]?.seed).toBe(20260901);
    expect(m.constraints['bracing_over_in']).toBe(126);
  });

  it('reads an empty approver as nobody, not as a name', () => {
    // A hand-edited manifest spells "nobody has approved this" as "". If that
    // read as a name, the gate would see a signature.
    expect(loadReleaseManifest(raw({ approved_by: '   ' })).approvedBy).toBeNull();
    expect(loadReleaseManifest(raw({ approved_by: undefined })).approvedBy).toBeNull();
  });

  it('reads a recorded top-up, and treats its absence as none', () => {
    const withTop = loadReleaseManifest(
      raw({
        human_spot_checks: [
          { ...(raw()['human_spot_checks'] as Record<string, unknown>[])[0], supplementary_cells: ['65ER/F5M/78in'] },
        ],
      }),
    );
    expect(withTop.humanSpotChecks[0]?.supplementaryCells).toEqual(['65ER/F5M/78in']);
    expect(loadReleaseManifest(raw()).humanSpotChecks[0]?.supplementaryCells).toEqual([]);
  });

  it('treats absent optional arrays as empty, not as missing', () => {
    const m = loadReleaseManifest(
      raw({ verification_paths: undefined, human_spot_checks: undefined, source_anomalies: undefined, constraints: undefined }),
    );
    expect(m.verificationPaths).toEqual([]);
    expect(m.humanSpotChecks).toEqual([]);
    expect(m.sourceAnomalies).toEqual([]);
    expect(m.constraints).toEqual({});
  });

  it('is frozen — the gate must not be able to edit what it is judging', () => {
    const m = loadReleaseManifest(raw());
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.verificationPaths)).toBe(true);
    expect(Object.isFrozen(m.humanSpotChecks)).toBe(true);
  });
});

describe('a malformed manifest names the field, and does not half-load', () => {
  const cases: readonly [string, unknown, RegExp][] = [
    ['not an object', 'nope', /manifest must be an object/],
    ['null', null, /manifest must be an object/],
    ['no rev', { status: 'DRAFT' }, /'rev' must be a non-empty string/],
    ['empty rev', raw({ rev: '' }), /'rev' must be a non-empty string/],
    ['unknown status', raw({ status: 'PROBABLY_FINE' }), /unknown status 'PROBABLY_FINE'/],
    ['missing manufacturer', raw({ manufacturer: undefined }), /'manufacturer' must be a non-empty string/],
    ['missing content hash', raw({ content_sha256: undefined }), /'content_sha256'/],
    ['datasets not an array of strings', raw({ datasets: [1, 2] }), /'datasets' must be an array of strings/],
    ['datasets not an array', raw({ datasets: 'beams' }), /'datasets' must be an array of strings/],
    ['source_anomalies not strings', raw({ source_anomalies: [{}] }), /'source_anomalies'/],
    ['verification_paths not an array', raw({ verification_paths: {} }), /'verification_paths' must be an array/],
    ['a path that is not an object', raw({ verification_paths: ['x'] }), /verification_paths\[0\]: not an object/],
    ['a path with an unknown kind', raw({ verification_paths: [{ dataset: 'beams', kind: 'vibes', cells: 1, note: 'n' }] }), /unknown kind 'vibes'/],
    ['a path with non-integer cells', raw({ verification_paths: [{ dataset: 'beams', kind: 'full_cross_check', cells: 1.5, note: 'n' }] }), /'cells' must be an integer/],
    ['a path with no dataset', raw({ verification_paths: [{ kind: 'full_cross_check', cells: 1, note: 'n' }] }), /'dataset' must be a non-empty string/],
    ['spot checks not an array', raw({ human_spot_checks: 7 }), /'human_spot_checks' must be an array/],
    ['a spot check that is not an object', raw({ human_spot_checks: [null] }), /human_spot_checks\[0\]: not an object/],
    ['a spot check with non-integer cells', raw({ human_spot_checks: [{ cells: 'lots' }] }), /'cells' must be an integer/],
    ['a spot check with a non-integer seed', raw({ human_spot_checks: [{ cells: 1, seed: 'x' }] }), /the draw must be reproducible/],
    ['a spot check with non-string cells', raw({ human_spot_checks: [{ cells: 1, seed: 1, sampled_cells: [7] }] }), /'sampled_cells' must be an array of strings/],
    ['a spot check with no sampled_cells', raw({ human_spot_checks: [{ cells: 1, seed: 1 }] }), /'sampled_cells' must be an array of strings/],
    ['supplementary_cells not an array', raw({ human_spot_checks: [{ cells: 1, seed: 1, sampled_cells: ['a'], supplementary_cells: 'x' }] }), /'supplementary_cells' must be an array of strings/],
    ['supplementary_cells not strings', raw({ human_spot_checks: [{ cells: 1, seed: 1, sampled_cells: ['a'], supplementary_cells: [7] }] }), /'supplementary_cells' must be an array of strings/],
    ['a spot check with no outcome', raw({ human_spot_checks: [{ cells: 1, seed: 1, sampled_cells: ['a'], dataset: 'beams', source_document: 's', page_ref: 'p', checked_by: 'c', checked_at: 'a' }] }), /'outcome' must be a non-empty string/],
  ];

  it.each(cases)('%s', (_name, input, message) => {
    expect(() => loadReleaseManifest(input)).toThrow(ManifestError);
    expect(() => loadReleaseManifest(input)).toThrow(message);
  });

  it('names the release in the error, so a batch load says WHICH file', () => {
    expect(() => loadReleaseManifest(raw({ units: undefined }))).toThrow(/manifest 2026-09/);
  });

  it('a non-string in an optional string field reads as absent, not as a value', () => {
    // Deliberate and narrow: `approved_by: 42` is nobody, not "42". Flagged in
    // review as a silent fallback in a module that otherwise throws; kept
    // because the alternative reads a number as a signature, and pinned here so
    // the choice is visible rather than incidental.
    expect(loadReleaseManifest(raw({ approved_by: 42 })).approvedBy).toBeNull();
    expect(loadReleaseManifest(raw({ corrected_by: {} })).correctedBy).toBeNull();
  });
});
