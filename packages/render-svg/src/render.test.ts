import {
  dimension,
  displayList,
  line,
  point,
  rect,
  text,
  type DisplayList,
} from '@rms/display-list';
import { describe, expect, it } from 'vitest';

import {
  computeViewBox,
  escapeXml,
  label,
  renderSvg,
  renderSvgFragment,
} from './render.js';

describe('@rms/render-svg', () => {
  describe('label and escapeXml', () => {
    it('returns text when established and VERIFY when unestablished (AC-07)', () => {
      expect(label({ text: '144"', established: true })).toBe('144"');
      expect(label({ text: '144"', established: false })).toBe('VERIFY');
      expect(label({ text: 'anything', established: 'UNKNOWN' as unknown as boolean })).toBe('VERIFY');
    });

    it('escapes XML special characters', () => {
      expect(escapeXml('A & B < C > D "quote" \'apostrophe\'')).toBe(
        'A &amp; B &lt; C &gt; D &quot;quote&quot; &apos;apostrophe&apos;',
      );
    });
  });

  describe('computeViewBox', () => {
    it('uses default padding when none provided', () => {
      const vb = computeViewBox({ width: 1_000_000, height: 2_000_000 });
      expect(vb.x).toBe(-1_200_000);
      expect(vb.y).toBe(-1_200_000);
      expect(vb.width).toBe(1_000_000 + 1_200_000 + 2_600_000);
      expect(vb.height).toBe(2_000_000 + 1_200_000 + 600_000);
    });

    it('uses custom padding when provided', () => {
      const vb = computeViewBox(
        { width: 500, height: 1000 },
        { left: 10, right: 20, top: 30, bottom: 40 },
      );
      expect(vb.x).toBe(-10);
      expect(vb.y).toBe(-30);
      expect(vb.width).toBe(530);
      expect(vb.height).toBe(1070);
    });
  });

  describe('renderSvg and renderSvgFragment', () => {
    it('renders an empty display list with default attributes and slab line for elevation', () => {
      const dl = displayList({
        view: 'elevation',
        extent: { width: 1_000_000, height: 2_000_000 },
        revisionHash: 'test-rev',
        items: [],
      });

      const svg = renderSvg(dl);
      expect(svg).toContain('<svg');
      expect(svg).toContain('class="elevation-svg"');
      expect(svg).toContain('aria-label="elevation drawing"');
      expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(svg).toContain('role="img"');
      expect(svg).toContain('<line class="elev-slab"');
      expect(svg).toContain('</svg>');
    });

    it('honors custom id, className, ariaLabel, and suppresses slab datum when requested', () => {
      const dl = displayList({
        view: 'plan',
        extent: { width: 1000, height: 500 },
        revisionHash: 'test-rev',
        items: [],
      });

      const svg = renderSvg(dl, {
        id: 'custom-id',
        className: 'custom-class',
        ariaLabel: 'Custom Plan Drawing',
        slabDatum: false,
      });

      expect(svg).toContain('id="custom-id"');
      expect(svg).toContain('class="custom-class"');
      expect(svg).toContain('aria-label="Custom Plan Drawing"');
      expect(svg).not.toContain('class="elev-slab"');
    });

    it('renders line items with proper stroke width, dasharray and selection', () => {
      const dl: DisplayList = {
        view: 'elevation',
        extent: { width: 1000, height: 1000 },
        revisionHash: 'rev-1',
        items: [
          line({
            item: 'upright',
            id: 'line-upright',
            from: point(0, 0),
            to: point(0, 500),
          }),
          line({
            item: 'reference',
            id: 'line-ref',
            from: point(0, 800),
            to: point(1000, 800),
          }),
          line({
            item: 'aisle',
            id: 'line-aisle',
            from: point(100, 100),
            to: point(200, 100),
          }),
        ],
      };

      const selected = new Set(['line-upright']);
      const svg = renderSvg(dl, { selectedIds: selected, strokeWidth: 10 });

      // Upright gets 2x stroke width (20) and selected class
      expect(svg).toContain('data-item-id="line-upright"');
      expect(svg).toContain('class="elev-line elev-line-upright selected"');
      expect(svg).toContain('stroke-width="20"');

      // Reference gets dasharray
      expect(svg).toContain('data-item-id="line-ref"');
      expect(svg).toContain('class="elev-line elev-line-reference"');
      expect(svg).toContain('stroke-dasharray="40 20"');

      // Regular line gets stroke width 10
      expect(svg).toContain('data-item-id="line-aisle"');
      expect(svg).toContain('stroke-width="10"');
    });

    it('renders rect items with labels, dashed unit-loads, and unestablished VERIFY', () => {
      const dl: DisplayList = {
        view: 'elevation',
        extent: { width: 1000, height: 1000 },
        revisionHash: 'rev-2',
        items: [
          rect({
            item: 'unit-load',
            id: 'rect-load',
            origin: point(50, 100),
            width: 200,
            height: 150,
            label: { text: '2,500 lbs', established: true },
          }),
          rect({
            item: 'beam',
            id: 'rect-beam',
            origin: point(50, 250),
            width: 200,
            height: 30,
            label: { text: 'Unknown Load', established: false },
          }),
          rect({
            item: 'upright',
            id: 'rect-no-label',
            origin: point(0, 0),
            width: 50,
            height: 500,
            label: null,
          }),
        ],
      };

      const svg = renderSvg(dl, { flipY: true, fontSize: 14 });

      // Unit-load has dashed stroke
      expect(svg).toContain('class="elev-rect elev-rect-unit-load"');
      expect(svg).toContain('stroke-dasharray="66000 44000"');
      expect(svg).toContain('2,500 lbs');
      expect(svg).toContain('class="elev-text"');

      // Unestablished label prints VERIFY with unestablished class
      expect(svg).toContain('VERIFY');
      expect(svg).toContain('class="elev-text elev-text-unestablished"');

      // No-label rect does not emit <text>
      expect(svg).toContain('data-item-id="rect-no-label"');

      // Test rect with flipY: false
      const svgNoFlip = renderSvg(dl, { flipY: false });
      expect(svgNoFlip).toContain('y="100"');

      // Test slab line with custom padding
      const svgWithPad = renderSvg(dl, {
        padding: { left: 50_000, right: 60_000 },
        slabDatum: true,
      });
      expect(svgWithPad).toContain('x1="-25000"');
      expect(svgWithPad).toContain('x2="31000"');
    });

    it('renders dimensions with witness line and text (VERIFY when unestablished)', () => {
      const dl: DisplayList = {
        view: 'elevation',
        extent: { width: 1000, height: 1000 },
        revisionHash: 'rev-3',
        items: [
          dimension({
            id: 'dim-established',
            from: point(100, 200),
            to: point(100, 400),
            text: { text: '48"', established: true },
          }),
          dimension({
            id: 'dim-unestablished',
            from: point(200, 200),
            to: point(200, 400),
            text: { text: 'unspecified', established: false },
          }),
        ],
      };

      const selected = new Set(['dim-established']);
      const svg = renderSvg(dl, { selectedIds: selected });

      expect(svg).toContain('data-item-id="dim-established"');
      expect(svg).toContain('class="elev-dim selected"');
      expect(svg).toContain('48&quot;');
      expect(svg).toContain('class="elev-text"');

      expect(svg).toContain('data-item-id="dim-unestablished"');
      expect(svg).toContain('VERIFY');
      expect(svg).toContain('class="elev-text elev-text-unestablished"');
    });

    it('renders text items with established and unestablished states', () => {
      const dl: DisplayList = {
        view: 'elevation',
        extent: { width: 1000, height: 1000 },
        revisionHash: 'rev-4',
        items: [
          text({
            id: 'text-normal',
            at: point(100, 100),
            text: { text: 'Clearance OK', established: true },
          }),
          text({
            id: 'text-warn',
            at: point(100, 200),
            text: { text: 'Needs check', established: false },
          }),
        ],
      };

      const svg = renderSvg(dl, { flipY: false });
      expect(svg).toContain('Clearance OK');
      expect(svg).toContain('class="elev-text"');

      expect(svg).toContain('VERIFY');
      expect(svg).toContain('class="elev-text elev-text-unestablished"');
    });

    it('renderSvgFragment returns only the inner elements without outer svg tag', () => {
      const dl: DisplayList = {
        view: 'plan',
        extent: { width: 500, height: 500 },
        revisionHash: 'rev-5',
        items: [
          line({
            item: 'beam',
            id: 'frag-line',
            from: point(0, 0),
            to: point(100, 100),
          }),
        ],
      };

      const fragment = renderSvgFragment(dl);
      expect(fragment).not.toContain('<svg');
      expect(fragment).not.toContain('</svg>');
      expect(fragment).toContain('<line data-item-id="frag-line"');
    });
  });
});
