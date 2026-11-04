import { describe, expect, it } from 'vitest';
import {
  FORKLIFT_PLANNING_OPTIONS,
  IN,
  PUBLISHED_BEAM_FAMILIES,
  PUBLISHED_BEAM_SPANS_IN,
  PUBLISHED_CATALOG_RELEASES,
  PUBLISHED_FRAME_DEPTHS_IN,
  PUBLISHED_FRAME_DEPTH_OPTIONS,
  PUBLISHED_FRAME_OPTIONS,
  beamFamilyFromPartLabel,
  canUseCatalogRelease,
  lookupForkliftPlanningOption,
  lookupFrameOption,
  lookupPublishedBeamSpan,
} from './index.js';

describe('Phase 1 Item 1 — Cascading Catalog Dropdowns & Zero-Interpolation Span Lookup', () => {
  it('allows approved release interlake-2026-09 and refuses DRAFT / unknown releases unless overridden', () => {
    expect(PUBLISHED_CATALOG_RELEASES.map((r) => r.id)).toEqual([
      'interlake-2026-09',
      'interlake-2026-08',
    ]);
    expect(canUseCatalogRelease('interlake-2026-09')).toEqual({
      allowed: true,
      reason: null,
    });
    expect(canUseCatalogRelease('interlake-2026-08')).toEqual({
      allowed: false,
      reason:
        "Catalog release 'interlake-2026-08' has status DRAFT and cannot be pinned without an explicit override.",
    });
    expect(canUseCatalogRelease('interlake-2026-08', true)).toEqual({
      allowed: true,
      reason: null,
    });
    expect(canUseCatalogRelease('nonexistent-release')).toEqual({
      allowed: false,
      reason: "Catalog release 'nonexistent-release' is not in the authority registry.",
    });
  });

  it('exposes published frame options across bolted, reinforced bolted, and welded tables with exact µm face widths', () => {
    expect(PUBLISHED_FRAME_OPTIONS.length).toBeGreaterThanOrEqual(11);
    expect(lookupFrameOption('3x3 ROLL-FORMED')?.uprightWidthUm).toBe(IN(3));
    expect(lookupFrameOption('FR.2.95F')?.uprightWidthUm).toBe(IN(4));
    expect(lookupFrameOption('UNKNOWN_FRAME')).toBeUndefined();
    expect(PUBLISHED_FRAME_DEPTHS_IN).toEqual([36, 42, 48]);
    expect(PUBLISHED_FRAME_DEPTH_OPTIONS.map((d) => d.depthUm)).toEqual([
      IN(36),
      IN(42),
      IN(48),
    ]);
  });

  it('exposes all 16 beam families, 21 published spans, and enforces zero interpolation on off-grid spans', () => {
    expect(PUBLISHED_BEAM_FAMILIES).toHaveLength(16);
    expect(PUBLISHED_BEAM_SPANS_IN).toHaveLength(21);

    const onGrid = lookupPublishedBeamSpan('45E', 96);
    expect(onGrid).toEqual({
      status: 'ON_GRID',
      family: '45E',
      series: 'F4M',
      spanIn: 96,
      spanUm: IN(96),
      capacityLb: 5960,
      faceHeightIn: 4.5,
      beamPartLabel: '96" 45E (F4M) STEP BEAM',
    });

    const slottedOnGrid = lookupPublishedBeamSpan('59ER', 120);
    expect(slottedOnGrid).toEqual({
      status: 'ON_GRID',
      family: '59ER',
      series: 'F5M',
      spanIn: 120,
      spanUm: IN(120),
      capacityLb: 7330,
      faceHeightIn: 5.9375,
      beamPartLabel: '120" 59ER (F5M) STEP BEAM',
    });

    // Zero interpolation: 110" is refused with 108" and 114" brackets and capacityLb: null
    const offGridMid = lookupPublishedBeamSpan('45E', 110);
    expect(offGridMid).toEqual({
      status: 'OFF_GRID',
      family: '45E',
      series: 'F4M',
      requestedSpanIn: 110,
      lowerSpanIn: 108,
      upperSpanIn: 114,
      capacityLb: null,
    });

    const offGridBelow = lookupPublishedBeamSpan('27E', 36);
    expect(offGridBelow).toEqual({
      status: 'OFF_GRID',
      family: '27E',
      series: 'F3M',
      requestedSpanIn: 36,
      lowerSpanIn: null,
      upperSpanIn: 48,
      capacityLb: null,
    });

    const offGridAbove = lookupPublishedBeamSpan('65Q', 180);
    expect(offGridAbove).toEqual({
      status: 'OFF_GRID',
      family: '65Q',
      series: 'F5M',
      requestedSpanIn: 180,
      lowerSpanIn: 168,
      upperSpanIn: null,
      capacityLb: null,
    });

    const notFound = lookupPublishedBeamSpan('99Z', 96);
    expect(notFound).toEqual({
      status: 'NOT_FOUND',
      reason: "Beam family '99Z' is not published in interlake-2026-09.",
    });
  });

  it('parses beam families from both canonical and legacy part labels', () => {
    expect(beamFamilyFromPartLabel('96" 45E (F4M) STEP BEAM')).toBe('45E');
    expect(beamFamilyFromPartLabel('108" 59ER (F5M) STEP BEAM')).toBe('59ER');
    expect(beamFamilyFromPartLabel('96" STEP BEAM')).toBe('45E');
  });

  it('exposes the 8 forklift planning bands with isPlanningValue: true and MS-6 / MS-14', () => {
    expect(FORKLIFT_PLANNING_OPTIONS).toHaveLength(8);
    for (const opt of FORKLIFT_PLANNING_OPTIONS) {
      expect(opt.isPlanningValue).toBe(true);
      expect(opt.missingSources).toEqual(['MS-6', 'MS-14']);
      expect(opt.planningAstUm).toBe(IN(opt.planningAstIn));
    }
    expect(lookupForkliftPlanningOption('Stand-up reach')?.planningAstIn).toBe(108);
    expect(lookupForkliftPlanningOption('turret-vna')?.planningAstIn).toBe(66);
    expect(lookupForkliftPlanningOption('Hovercraft')).toBeUndefined();
  });
});
