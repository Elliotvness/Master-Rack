import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadBeamRows } from './load.js';
import type { BeamRow } from './lookup.js';

/**
 * The PSG 2025 beam capacity chart, WIRED INTO THE TEST RUN.
 *
 * Owner decision 2026-08-31 (P0-008): the Interlake Mecalux Product Support
 * Guide 2025 (SEL-PSG-12/2025) is the SOLE authority for beam capacity. The
 * Mecalux Material Catalog is disregarded for capacity values.
 *
 * The rationale is recorded because a future reader will find the Material
 * Catalog and reasonably wonder why it was ignored. It covers a different
 * product line (25E, 31E, 35E, 39E, 43E, 47E, 55E, 65Q-DX) and carries no
 * capacity data for twelve of our sixteen families, so the earlier
 * recommendation to prefer it for capacity lookups cannot be satisfied at all.
 * PSG 2025 is the only source covering all sixteen.
 *
 * This fixture is transcribed from PDF page 88, "BEAM WITH TAB END PLATE
 * CAPACITY CHART: 27E - 65Q, 48"-168"". It is the published chart, not our
 * data: the point is to catch our catalog drifting away from the source, so a
 * test that read our own file and compared it to itself would be worthless.
 */

/** Spans as printed, in inches. Note 92" between 84" and 96" - not a typo. */
const SPANS = [
  48, 54, 60, 66, 72, 78, 84, 92, 96, 102, 108, 114, 120, 126, 132, 138, 144, 150, 156, 162, 168,
] as const;

/**
 * One column per family PAIR, in printed order. The chart's own sub-header
 * groups these columns by end plate: F3M covers 27E and 36E, F4M covers 40E,
 * 45E and 50E, F5M covers 59E, 65E and 65Q. That grouping is the reason a
 * single column can serve a family: within a family, every published beam has
 * exactly one end plate.
 */
const COLUMNS = ['27E', '36E', '40E', '45E', '50E', '59E', '65E', '65Q'] as const;

/** Page 88, transcribed row by row. Values are lbs per PAIR of beams. */
const CHART: readonly (readonly number[])[] = [
  [5610, 8050, 9810, 11090, 12880, 16910, 17115, 27940], // 48"
  [5080, 7230, 8830, 9950, 11530, 15140, 17110, 24940], // 54"
  [4640, 6570, 8040, 9050, 10460, 13720, 15850, 22540], // 60"
  [4290, 6030, 7390, 8300, 9580, 12560, 14480, 20570], // 66"
  [3990, 5590, 6850, 7680, 8850, 11590, 13360, 18940], // 72"
  [3510, 5210, 6390, 7150, 8220, 10780, 12400, 17550], // 78"
  [3080, 4880, 6010, 6700, 7690, 10080, 11580, 16370], // 84"
  [2630, 4510, 5560, 6190, 7090, 9280, 10650, 15030], // 92"
  [2440, 4170, 5370, 5960, 6820, 8940, 10240, 14430], // 96"
  [2200, 3740, 4870, 5650, 6470, 8460, 9690, 13640], // 102"
  [1990, 3370, 4390, 5380, 6150, 8040, 9190, 12920], // 108"
  [1810, 3050, 3990, 5040, 5870, 7660, 8760, 12300], // 114"
  [1660, 2780, 3640, 4590, 5610, 7330, 8370, 11730], // 120"
  [1530, 2550, 3340, 4210, 5230, 7020, 8000, 11210], // 126"
  [1410, 2350, 3080, 3870, 4800, 6740, 7680, 10750], // 132"
  [1310, 2170, 2850, 3570, 4420, 6490, 7380, 10310], // 138"
  [1220, 2010, 2650, 3310, 4100, 6250, 7110, 9920], // 144"
  [1140, 1870, 2470, 3080, 3800, 5820, 6850, 9560], // 150"
  [1070, 1740, 2300, 2870, 3540, 5420, 6630, 9040], // 156"
  [1000, 1630, 2160, 2690, 3310, 5060, 6250, 8420], // 162"
  [940, 1530, 2030, 2520, 3100, 4740, 5840, 7870], // 168"
];

/**
 * The end plate published for each family (page 84, BEAM PROFILES, and the
 * page 88 column grouping). A family has exactly ONE. This is the fact that
 * makes a per-family capacity column well defined.
 */
const PUBLISHED_END_PLATE: Readonly<Record<string, string>> = Object.freeze({
  '27E': 'F3M',
  '36E': 'F3M',
  '40E': 'F4M',
  '45E': 'F4M',
  '50E': 'F4M',
  '59E': 'F5M',
  '65E': 'F5M',
  '65Q': 'F5M',
});

function chartValue(family: string, spanIn: number): number | undefined {
  // 27ER is the slotted variant of 27E and shares its column, as the chart's
  // own "27E / 27ER" heading states.
  const base = family.endsWith('R') && family !== '65Q' ? family.slice(0, -1) : family;
  const col = COLUMNS.indexOf(base as (typeof COLUMNS)[number]);
  const row = SPANS.indexOf(spanIn as (typeof SPANS)[number]);
  if (col < 0 || row < 0) return undefined;
  return CHART[row]?.[col];
}

function loadCatalog(): readonly BeamRow[] {
  const url = new URL('../../../data/catalog/interlake-2026-09/beams.json', import.meta.url);
  const doc = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as { rows: unknown[] };
  return loadBeamRows(doc.rows);
}

describe('PSG 2025 is the sole authority for beam capacity', () => {
  it('the transcribed chart is complete: 21 spans x 8 columns', () => {
    expect(CHART).toHaveLength(SPANS.length);
    for (const row of CHART) {
      expect(row).toHaveLength(COLUMNS.length);
    }
  });

  it('every shipped row matches the published chart cell exactly', () => {
    const rows = loadCatalog();
    const mismatches: string[] = [];
    for (const r of rows) {
      const published = chartValue(r.family, r.spanIn);
      if (published === undefined) {
        mismatches.push(`${r.family} ${r.spanIn}in has no chart cell`);
      } else if (published !== r.capacityLbs) {
        mismatches.push(
          `${r.family} ${r.series} ${r.spanIn}in: catalog ${r.capacityLbs}, chart ${published}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('no family carries a beam under an end plate the guide does not publish', () => {
    // This is the check that catches the defect the 2026-08 extract carried:
    // 42 rows of 40E/40ER under an F3M (6", 3-tab) end plate, which page 84
    // publishes for 27E and 36E only. Those rows also read ~4-12% BELOW the
    // published 40E capacity, so the phantom variant made the engine look
    // conservative while quoting a beam that is not in the catalog.
    const rows = loadCatalog();
    const wrong = rows
      .filter((r) => {
        const base = r.family.endsWith('R') && r.family !== '65Q' ? r.family.slice(0, -1) : r.family;
        return PUBLISHED_END_PLATE[base] !== r.series;
      })
      .map((r) => `${r.family} ${r.spanIn}in carries ${r.series}, published is ${PUBLISHED_END_PLATE[r.family.replace(/R$/, '')]}`);
    expect(wrong).toEqual([]);
  });

  it('each family has exactly one end plate, so a per-family column is well defined', () => {
    const rows = loadCatalog();
    const byFamily = new Map<string, Set<string>>();
    for (const r of rows) {
      const s = byFamily.get(r.family) ?? new Set<string>();
      s.add(r.series);
      byFamily.set(r.family, s);
    }
    const multi = [...byFamily.entries()]
      .filter(([, s]) => s.size > 1)
      .map(([f, s]) => `${f}: ${[...s].join(', ')}`);
    expect(multi).toEqual([]);
  });

  it('the 18-digit code end-plate letter agrees with the series', () => {
    // Character 13 of code_18 is the end plate: C = F3M 6" 3-tab, R = F4M 8"
    // 4-tab, S = F5M 10" 5-tab (page 83). A row whose letter contradicts its
    // series is a transcription error, and it is how the phantom 40E rows
    // announced themselves: IB40ET04800RCA2000 carries 'C' on a 40E beam.
    //
    // ONE row is exempted, and named rather than filtered by a rule: the
    // manufacturer's own chart prints IB65QT16200RRA4000 for 65QR at 162".
    // Its sibling 65Q at the same span reads ...RSA2000, and every other 65QR
    // row reads ...RSA4000, so 'R' here is a published typo. It is transcribed
    // verbatim and listed in the manifest's source_anomalies, because the
    // catalog must stay reconcilable against the document it came from. The
    // exemption is a literal string: a new wrong letter anywhere still fails.
    const PUBLISHED_TYPO = 'IB65QT16200RRA4000';
    const LETTER: Readonly<Record<string, string>> = { F3M: 'C', F4M: 'R', F5M: 'S' };
    const rows = loadCatalog();
    const wrong = rows
      .filter((r) => r.code18 !== PUBLISHED_TYPO && r.code18[12] !== LETTER[r.series])
      .map((r) => `${r.code18} has '${r.code18[12]}', series ${r.series} expects '${LETTER[r.series]}'`);
    expect(wrong).toEqual([]);
  });

  it('the known short codes are exactly the five the manifest already records', () => {
    // Five 65QR codes are 17 characters where the format specifies 18. They are
    // the manufacturer's, not ours. Pinning the exact set means a SIXTH short
    // code - which would be our own transcription slipping - fails the build,
    // while the five published ones do not create permanent noise.
    const KNOWN_SHORT = [
      'IB65QT05400RSA400',
      'IB65QT06600RSA400',
      'IB65QT07800RSA400',
      'IB65QT12600RSA400',
      'IB65QT15000RSA400',
    ];
    const rows = loadCatalog();
    const short = rows.filter((r) => r.code18.length !== 18).map((r) => r.code18);
    expect(short.sort()).toEqual([...KNOWN_SHORT].sort());
  });

  it('the catalog covers all sixteen families, which is why PSG governs', () => {
    // The Material Catalog was disregarded because it carries no capacity for
    // twelve of these. If a future release drops families, that reasoning
    // needs revisiting rather than silently no longer applying.
    const rows = loadCatalog();
    const families = new Set(rows.map((r) => r.family));
    expect([...families].sort()).toEqual([
      '27E', '27ER', '36E', '36ER', '40E', '40ER', '45E', '45ER',
      '50E', '50ER', '59E', '59ER', '65E', '65ER', '65Q', '65QR',
    ]);
  });
});
