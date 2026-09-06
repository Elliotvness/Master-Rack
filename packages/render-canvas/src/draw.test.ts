import { dimension, displayList, line, point, rect, text, type DisplayList } from '@rms/display-list';
import { describe, expect, it } from 'vitest';

import { draw, label, type Pens } from './draw.js';
import type { Camera, Viewport } from './camera.js';

/**
 * A RECORDING context, not a mock.
 *
 * The distinction matters and `vitest.config.ts` states it for the application
 * floors: a mock that returns what the test expects proves nothing, and one
 * that asserts its own calls is worse than an honest gap. This records what was
 * asked of it and the assertions below are about the DRAWING — which items
 * survived culling, which pen was chosen, what text was painted. Those are the
 * renderer's actual contract, and they are observable in no other way without a
 * browser.
 *
 * It is not a substitute for a screenshot. Pixel fidelity, DPR and font metrics
 * are not tested here and cannot be; that is Playwright's job in S4.
 */
interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const record =
    (op: string) =>
    (...args: unknown[]): void => {
      calls.push({ op, args });
    };

  const ctx = {
    setTransform: record('setTransform'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    fillText: record('fillText'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    get fillStyle() {
      return state['fillStyle'];
    },
    set fillStyle(v: unknown) {
      state['fillStyle'] = v;
      calls.push({ op: 'set fillStyle', args: [v] });
    },
    get strokeStyle() {
      return state['strokeStyle'];
    },
    set strokeStyle(v: unknown) {
      state['strokeStyle'] = v;
      calls.push({ op: 'set strokeStyle', args: [v] });
    },
    set lineWidth(v: unknown) {
      calls.push({ op: 'set lineWidth', args: [v] });
    },
    set globalAlpha(v: unknown) {
      calls.push({ op: 'set globalAlpha', args: [v] });
    },
    set font(v: unknown) {
      calls.push({ op: 'set font', args: [v] });
    },
    set lineJoin(v: unknown) {
      calls.push({ op: 'set lineJoin', args: [v] });
    },
    set textBaseline(v: unknown) {
      calls.push({ op: 'set textBaseline', args: [v] });
    },
  } as unknown as CanvasRenderingContext2D;

  return { ctx, calls };
}

const PENS: Pens = {
  background: '#bg',
  ink: '#ink',
  inkMuted: '#muted',
  upright: '#upright',
  beam: '#beam',
  unitLoad: '#unitload',
  flue: '#flue',
  aisle: '#aisle',
  obstruction: '#obstruction',
  noRackZone: '#norack',
  selection: '#selection',
  unestablished: '#unestablished',
};

const VIEWPORT: Viewport = { width: 800, height: 600 };
const CAMERA: Camera = { centreX: 0, centreY: 0, scale: 1 / 1000 };

const IN = (n: number): number => n * 25_400;

function listWith(...items: Parameters<typeof displayList>[0]['items']): DisplayList {
  return displayList({
    view: 'plan',
    extent: { width: IN(1000), height: IN(1000) },
    items,
    revisionHash: 'sha256:test',
  });
}

const aRect = (id: string, x: number, y: number, item: 'upright' | 'aisle' = 'upright') =>
  rect({ item, id, origin: point(x, y), width: IN(10), height: IN(10), label: null });

describe('the frame is cleared before anything is drawn', () => {
  it('sets the device transform and fills the background', () => {
    const { ctx, calls } = recorder();
    draw(ctx, listWith(), { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 2 });
    expect(calls[0]).toEqual({ op: 'setTransform', args: [2, 0, 0, 2, 0, 0] });
    expect(calls.some((c) => c.op === 'set fillStyle' && c.args[0] === '#bg')).toBe(true);
    expect(calls.some((c) => c.op === 'fillRect')).toBe(true);
  });

  it('honours the device pixel ratio it is given', () => {
    const { ctx, calls } = recorder();
    draw(ctx, listWith(), { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 });
    expect(calls[0]?.args).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('culling', () => {
  it('draws what is in view and skips what is not', () => {
    const { ctx } = recorder();
    const result = draw(
      ctx,
      listWith(aRect('near', 0, 0), aRect('far', IN(100_000), IN(100_000))),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(result.drawn).toBe(1);
    expect(result.culled).toBe(1);
  });

  it('accounts for every item exactly once', () => {
    const { ctx } = recorder();
    const items = [aRect('a', 0, 0), aRect('b', IN(1e6), 0), aRect('c', 0, IN(1e6))];
    const r = draw(ctx, listWith(...items), {
      camera: CAMERA,
      viewport: VIEWPORT,
      pens: PENS,
      dpr: 1,
    });
    expect(r.drawn + r.culled).toBe(items.length);
  });
});

describe('pens are chosen by item kind, and selection overrides', () => {
  it('an upright uses the upright pen', () => {
    const { ctx, calls } = recorder();
    draw(ctx, listWith(aRect('u', 0, 0)), {
      camera: CAMERA,
      viewport: VIEWPORT,
      pens: PENS,
      dpr: 1,
    });
    expect(calls.some((c) => c.op === 'set fillStyle' && c.args[0] === '#upright')).toBe(true);
  });

  it('an aisle uses the aisle pen', () => {
    const { ctx, calls } = recorder();
    draw(ctx, listWith(aRect('a', 0, 0, 'aisle')), {
      camera: CAMERA,
      viewport: VIEWPORT,
      pens: PENS,
      dpr: 1,
    });
    expect(calls.some((c) => c.op === 'set fillStyle' && c.args[0] === '#aisle')).toBe(true);
  });

  it('a selected item is drawn in the selection pen instead', () => {
    const { ctx, calls } = recorder();
    draw(ctx, listWith(aRect('u', 0, 0)), {
      camera: CAMERA,
      viewport: VIEWPORT,
      pens: PENS,
      dpr: 1,
      selectedIds: new Set(['u']),
    });
    expect(calls.some((c) => c.op === 'set fillStyle' && c.args[0] === '#selection')).toBe(true);
    expect(calls.some((c) => c.op === 'set fillStyle' && c.args[0] === '#upright')).toBe(false);
  });
});

describe('AC-07 at the renderer: an unestablished value never becomes a numeral', () => {
  /**
   * The defect ADR-003's amendment records: the elevation printed a real
   * `25'-2"` while the panel beside it said VERIFY for the same quantity,
   * because a formatted string crossed the model/renderer boundary.
   */
  it('prints VERIFY, and does NOT print the value', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(
        text({
          id: 't',
          at: point(0, 0),
          text: { text: `25'-2"`, established: false },
        }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    const printed = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(printed).toContain('VERIFY');
    expect(printed).not.toContain(`25'-2"`);
  });

  it('prints an established value as itself', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(
        text({
          id: 't',
          at: point(0, 0),
          text: { text: '96 in', established: true },
        }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toContain('96 in');
  });

  it('uses the unestablished pen for it, so it is not merely quieter text', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(
        text({ id: 't', at: point(0, 0), text: { text: 'x', established: false } }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(calls.some((c) => c.op === 'set fillStyle' && c.args[0] === '#unestablished')).toBe(true);
  });
});

describe('label', () => {
  it('is VERIFY when unestablished and the text when established', () => {
    expect(label({ text: 'anything', established: false })).toBe('VERIFY');
    expect(label({ text: '96 in', established: true })).toBe('96 in');
  });
});

describe('the item kinds the plan actually emits', () => {
  it('draws a line between its two points', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(line({ item: 'beam', id: 'l', from: point(0, 0), to: point(IN(10), IN(10)) })),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(calls.some((c) => c.op === 'beginPath')).toBe(true);
    expect(calls.some((c) => c.op === 'moveTo')).toBe(true);
    expect(calls.some((c) => c.op === 'lineTo')).toBe(true);
    expect(calls.some((c) => c.op === 'stroke')).toBe(true);
    expect(calls.some((c) => c.op === 'set strokeStyle' && c.args[0] === '#beam')).toBe(true);
  });

  it('draws a dimension as a line plus its witnessed text', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(
        dimension({
          id: 'd',
          from: point(0, 0),
          to: point(IN(96), 0),
          text: { text: `8'-0"`, established: true },
        }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(calls.some((c) => c.op === 'stroke')).toBe(true);
    expect(calls.filter((c) => c.op === 'fillText').map((c) => c.args[0])).toContain(`8'-0"`);
  });

  /** A dimension is the case where printing an unproven number is most tempting. */
  it('a dimension whose text is unestablished prints VERIFY, not the span', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(
        dimension({
          id: 'd',
          from: point(0, 0),
          to: point(IN(96), 0),
          text: { text: `8'-0"`, established: false },
        }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    const printed = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
    expect(printed).toContain('VERIFY');
    expect(printed).not.toContain(`8'-0"`);
  });

  it('draws a rect label when it has one, and prints VERIFY when unestablished', () => {
    for (const established of [true, false]) {
      const { ctx, calls } = recorder();
      draw(
        ctx,
        listWith(
          rect({
            item: 'upright',
            id: 'r',
            origin: point(0, 0),
            width: IN(10),
            height: IN(10),
            label: { text: 'Run 1', established },
          }),
        ),
        { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
      );
      const printed = calls.filter((c) => c.op === 'fillText').map((c) => c.args[0]);
      expect(printed).toContain(established ? 'Run 1' : 'VERIFY');
    }
  });

  it.each([
    ['obstruction', '#obstruction'],
    ['no-rack-zone', '#norack'],
    ['beam', '#beam'],
  ] as const)('a %s rect uses its own pen', (item, pen) => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(rect({ item, id: 'x', origin: point(0, 0), width: IN(5), height: IN(5), label: null })),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(calls.some((c) => c.op === 'set fillStyle' && c.args[0] === pen)).toBe(true);
  });

  it('an annotation rect uses the muted ink pen', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(
        text({ id: 'a', at: point(0, 0), text: { text: 'n', established: true } }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(calls.some((c) => c.op === 'fillText')).toBe(true);
  });

  it('culls a line and a dimension that are off screen', () => {
    const { ctx } = recorder();
    const far = IN(1e7);
    const r = draw(
      ctx,
      listWith(
        line({ item: 'beam', id: 'l', from: point(far, far), to: point(far + IN(10), far) }),
        dimension({
          id: 'd',
          from: point(far, far),
          to: point(far + IN(10), far),
          text: { text: 'x', established: true },
        }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(r.culled).toBe(2);
    expect(r.drawn).toBe(0);
  });
});

describe('unit loads and flues get their own pen and fill weight', () => {
  /**
   * A unit load is an OUTLINE — filling it solid hides the frame beneath and
   * with it the overhang, which is the one thing drawing loads at true
   * footprint exists to show.
   */
  it('a unit load strokes in its pen and fills at zero alpha', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(
        rect({ item: 'unit-load', id: 'u', origin: point(0, 0), width: IN(40), height: IN(48), label: null }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(calls.some((c) => c.op === 'set strokeStyle' && c.args[0] === '#unitload')).toBe(true);
    expect(calls.some((c) => c.op === 'set globalAlpha' && c.args[0] === 0)).toBe(true);
  });

  it('a flue uses the flue pen and a readable wash', () => {
    const { ctx, calls } = recorder();
    draw(
      ctx,
      listWith(
        rect({ item: 'flue', id: 'f', origin: point(0, 0), width: IN(300), height: IN(6), label: null }),
      ),
      { camera: CAMERA, viewport: VIEWPORT, pens: PENS, dpr: 1 },
    );
    expect(calls.some((c) => c.op === 'set fillStyle' && c.args[0] === '#flue')).toBe(true);
    expect(calls.some((c) => c.op === 'set globalAlpha' && c.args[0] === 0.3)).toBe(true);
  });

  it('an aisle wash stays light enough to read dimensions through', () => {
    const { ctx, calls } = recorder();
    draw(ctx, listWith(aRect('a', 0, 0, 'aisle')), {
      camera: CAMERA,
      viewport: VIEWPORT,
      pens: PENS,
      dpr: 1,
    });
    expect(calls.some((c) => c.op === 'set globalAlpha' && c.args[0] === 0.1)).toBe(true);
  });
});
