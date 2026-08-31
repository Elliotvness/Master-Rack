/**
 * Loading the declarative catalog data into typed rows.
 *
 * The catalog is DATA (JSON), never executable code — the blueprint rejects the
 * reference project's `runpy.run_path` approach as an arbitrary-code-execution
 * vector the moment a catalog file could be edited. This module validates the
 * shape of that data and refuses anything malformed, rather than trusting it.
 *
 * Validation is deliberately strict: a row missing a field, or carrying a
 * non-finite capacity, is a data error worth refusing at load time rather than
 * discovering at lookup time.
 */

import type { BeamRow } from './lookup.js';

export class CatalogDataError extends Error {
  override readonly name = 'CatalogDataError';
}

interface RawBeamRow {
  family?: unknown;
  series?: unknown;
  face_height_in?: unknown;
  span_in?: unknown;
  part_number?: unknown;
  code_18?: unknown;
  capacity_lbs?: unknown;
}

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || value === '') {
    throw new CatalogDataError(`row ${index}: '${field}' must be a non-empty string`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, field: string, index: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CatalogDataError(`row ${index}: '${field}' must be a finite number`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string, index: number): number {
  const n = requireFiniteNumber(value, field, index);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CatalogDataError(`row ${index}: '${field}' must be a positive integer, got ${n}`);
  }
  return n;
}

/**
 * Parse and validate the `rows` array of a beams.json document. The document is
 * `{ schema_version, manufacturer, rev, rows: [...] }`; this consumes `rows`.
 */
export function loadBeamRows(rows: readonly unknown[]): readonly BeamRow[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new CatalogDataError('beam rows must be a non-empty array');
  }

  return rows.map((raw, index): BeamRow => {
    if (typeof raw !== 'object' || raw === null) {
      throw new CatalogDataError(`row ${index}: not an object`);
    }
    const r = raw as RawBeamRow;
    return Object.freeze({
      family: requireString(r.family, 'family', index),
      series: requireString(r.series, 'series', index),
      faceHeightIn: requireFiniteNumber(r.face_height_in, 'face_height_in', index),
      // Spans are published as whole inches. A fractional span is a data error.
      spanIn: requirePositiveInteger(r.span_in, 'span_in', index),
      partNumber: requireString(r.part_number, 'part_number', index),
      code18: requireString(r.code_18, 'code_18', index),
      capacityLbs: requirePositiveInteger(r.capacity_lbs, 'capacity_lbs', index),
    });
  });
}
