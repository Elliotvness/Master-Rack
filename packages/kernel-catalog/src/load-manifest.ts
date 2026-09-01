/**
 * Loading a release manifest from its declarative file into the typed shape the
 * approval gate reads.
 *
 * This module exists because of a gap the Rev C conformance audit found: the
 * two-person gate in `release.ts` was thoroughly unit-tested and had never once
 * been run against a manifest on disk. `interlake-2026-09` carries
 * `"status": "APPROVED"` because a human wrote those characters into JSON, not
 * because `approveRelease` returned it. A gate that only ever sees objects a
 * test constructed is not guarding the data - it is guarding the test.
 *
 * So the manifest is parsed and validated here, and the gate is run against the
 * real releases in `release-integrity.test.ts`.
 *
 * Pure: the caller does the I/O and hands the parsed JSON in, same posture as
 * `load.ts` and `load-frames.ts`.
 */

import { CatalogError } from './errors.js';
import {
  type CatalogReleaseManifest,
  type DatasetVerificationPath,
  type HumanSpotCheck,
  type ReleaseStatus,
} from './release.js';

export class ManifestError extends CatalogError {
  override readonly name = 'ManifestError';
}

const STATUSES: readonly string[] = ['DRAFT', 'APPROVED', 'SUPERSEDED', 'RETIRED', 'QUARANTINED'];
const PATH_KINDS: readonly string[] = ['full_cross_check', 'two_path_reconciliation'];

function str(raw: Record<string, unknown>, key: string, where: string): string {
  const v = raw[key];
  if (typeof v !== 'string' || v === '') {
    throw new ManifestError(`${where}: '${key}' must be a non-empty string`);
  }
  return v;
}

function strOrNull(raw: Record<string, unknown>, key: string): string | null {
  const v = raw[key];
  // An empty string is how a hand-edited manifest spells "nobody has approved
  // this". It must read as null, not as a name, or the gate sees a signature.
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  if (typeof v !== 'string') return null;
  return v;
}

function strArray(raw: Record<string, unknown>, key: string, where: string): readonly string[] {
  const v = raw[key];
  if (v === undefined) return Object.freeze([]);
  if (!Array.isArray(v) || v.some((e) => typeof e !== 'string')) {
    throw new ManifestError(`${where}: '${key}' must be an array of strings`);
  }
  return Object.freeze([...(v as string[])]);
}

function verificationPaths(
  raw: Record<string, unknown>,
  where: string,
): readonly DatasetVerificationPath[] {
  const v = raw['verification_paths'];
  if (v === undefined || v === null) return Object.freeze([]);
  if (!Array.isArray(v)) {
    throw new ManifestError(`${where}: 'verification_paths' must be an array`);
  }
  return Object.freeze(
    v.map((entry, i): DatasetVerificationPath => {
      const at = `${where}: verification_paths[${i}]`;
      if (typeof entry !== 'object' || entry === null) {
        throw new ManifestError(`${at}: not an object`);
      }
      const e = entry as Record<string, unknown>;
      const kind = str(e, 'kind', at);
      if (!PATH_KINDS.includes(kind)) {
        throw new ManifestError(`${at}: unknown kind '${kind}'`);
      }
      const cells = e['cells'];
      if (typeof cells !== 'number' || !Number.isInteger(cells)) {
        throw new ManifestError(`${at}: 'cells' must be an integer`);
      }
      return Object.freeze({
        dataset: str(e, 'dataset', at),
        kind: kind as DatasetVerificationPath['kind'],
        cells,
        note: str(e, 'note', at),
      }) as DatasetVerificationPath;
    }),
  );
}

function humanSpotChecks(raw: Record<string, unknown>, where: string): readonly HumanSpotCheck[] {
  const v = raw['human_spot_checks'];
  if (v === undefined || v === null) return Object.freeze([]);
  if (!Array.isArray(v)) {
    throw new ManifestError(`${where}: 'human_spot_checks' must be an array`);
  }
  return Object.freeze(
    v.map((entry, i): HumanSpotCheck => {
      const at = `${where}: human_spot_checks[${i}]`;
      if (typeof entry !== 'object' || entry === null) {
        throw new ManifestError(`${at}: not an object`);
      }
      const e = entry as Record<string, unknown>;
      const cells = e['cells'];
      const seed = e['seed'];
      if (typeof cells !== 'number' || !Number.isInteger(cells)) {
        throw new ManifestError(`${at}: 'cells' must be an integer`);
      }
      if (typeof seed !== 'number' || !Number.isInteger(seed)) {
        throw new ManifestError(`${at}: 'seed' must be an integer — the draw must be reproducible`);
      }
      const sampled = e['sampled_cells'];
      if (!Array.isArray(sampled) || sampled.some((c) => typeof c !== 'string')) {
        throw new ManifestError(`${at}: 'sampled_cells' must be an array of strings`);
      }
      // Absent means none, which is the common case: a top-up exists only when
      // the primary draw covered fewer published values than cells.
      const supplementary = e['supplementary_cells'] ?? [];
      if (!Array.isArray(supplementary) || supplementary.some((c) => typeof c !== 'string')) {
        throw new ManifestError(`${at}: 'supplementary_cells' must be an array of strings`);
      }
      return Object.freeze({
        dataset: str(e, 'dataset', at),
        cells,
        sampledCells: Object.freeze([...(sampled as string[])]),
        supplementaryCells: Object.freeze([...(supplementary as string[])]),
        seed,
        sourceDocument: str(e, 'source_document', at),
        pageRef: str(e, 'page_ref', at),
        checkedBy: str(e, 'checked_by', at),
        checkedAt: str(e, 'checked_at', at),
        outcome: str(e, 'outcome', at),
      });
    }),
  );
}

/**
 * Parse a release manifest. Throws with the field named rather than returning a
 * partially-populated object - a manifest half-read is how a release gets
 * approved on fields nobody supplied.
 */
export function loadReleaseManifest(raw: unknown): CatalogReleaseManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new ManifestError('manifest must be an object');
  }
  const m = raw as Record<string, unknown>;
  const rev = str(m, 'rev', 'manifest');
  const where = `manifest ${rev}`;

  const status = str(m, 'status', where);
  if (!STATUSES.includes(status)) {
    throw new ManifestError(`${where}: unknown status '${status}'`);
  }

  return Object.freeze({
    manufacturer: str(m, 'manufacturer', where),
    rev,
    status: status as ReleaseStatus,
    sourceDocument: str(m, 'source_document', where),
    sourceUrl: strOrNull(m, 'source_url'),
    pageRef: strOrNull(m, 'page_ref'),
    units: str(m, 'units', where),
    loadBasis: str(m, 'load_basis', where),
    deflectionLimit: str(m, 'deflection_limit', where),
    codeBasis: str(m, 'code_basis', where),
    digitisedBy: str(m, 'digitised_by', where),
    digitisedAt: str(m, 'digitised_at', where),
    approvedBy: strOrNull(m, 'approved_by'),
    approvedAt: strOrNull(m, 'approved_at'),
    verificationPaths: verificationPaths(m, where),
    humanSpotChecks: humanSpotChecks(m, where),
    correctedBy: strOrNull(m, 'corrected_by'),
    quarantineReason: strOrNull(m, 'quarantine_reason'),
    datasets: strArray(m, 'datasets', where),
    contentSha256: str(m, 'content_sha256', where),
    sourceAnomalies: strArray(m, 'source_anomalies', where),
    constraints: Object.freeze({ ...((m['constraints'] as Record<string, number>) ?? {}) }),
  });
}
