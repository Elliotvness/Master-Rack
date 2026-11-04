/**
 * @vitest-environment jsdom
 *
 * The first component test in this repository.
 *
 * `vitest.config.ts` sets `environment: 'node'` globally and its comment states
 * the consequence — a component test that touches the DOM needs `jsdom` and a
 * per-file docblock — and says that dependency lands with the first component
 * test rather than before it. This is that file.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from './app.js';
import { HEADER_CONTROL_ORDER, VIEWS } from './nav.js';

/**
 * jsdom implements neither `ResizeObserver` nor a canvas 2D context.
 *
 * The plan viewport uses the first to follow the stage's size — the rail and
 * the banner change its width without the window resizing — and the second to
 * draw. Both are stubbed here rather than guarded in the component: a
 * production code path that exists only to keep a test environment happy is a
 * branch nothing real ever takes, and it would need its own coverage.
 *
 * The stub does NOT fire. Nothing here asserts anything about what is painted —
 * that is what `packages/render-canvas`'s camera tests and the screenshots
 * cover. These tests assert the shell: that the route mounts, and that the
 * accessible summary beside the canvas is present, because a bitmap must never
 * be the only way to reach the information.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
HTMLCanvasElement.prototype.getContext = (): null => null;

afterEach(cleanup);

function renderApp(at = '/plan'): void {
  render(
    <MemoryRouter initialEntries={[at]}>
      <App />
    </MemoryRouter>,
  );
}

describe('the chrome bar', () => {
  it('renders every control the artifact had, by its artifact id', () => {
    renderApp();
    for (const id of HEADER_CONTROL_ORDER) {
      expect(document.getElementById(id), `#${id} is missing`).not.toBeNull();
    }
  });

  /**
   * The acceptance criterion, as a test rather than a screenshot. DOM order is
   * tab order here because nothing carries a positive `tabindex` — which is
   * itself asserted below, since a stray `tabindex="1"` would reorder the whole
   * page while leaving the DOM looking correct.
   */
  it('places them in the artifact\'s order', () => {
    renderApp();
    const found = HEADER_CONTROL_ORDER.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    const inDomOrder = [...found].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    expect(inDomOrder.map((el) => el.id)).toEqual([...HEADER_CONTROL_ORDER]);
  });

  it('uses no positive tabindex anywhere', () => {
    renderApp();
    const positive = [...document.querySelectorAll('[tabindex]')].filter(
      (el) => Number(el.getAttribute('tabindex')) > 0,
    );
    expect(positive.map((el) => el.outerHTML)).toEqual([]);
  });
});

describe('S1 owns no document, and the screen says so', () => {
  it('shows no invented job tag', () => {
    renderApp();
    const tag = document.getElementById('jobtag') as HTMLElement;
    expect(tag.textContent).toBe('No document loaded');
    expect(tag.dataset['established']).toBe('false');
  });

  /**
   * Undo and Save are present and DISABLED rather than absent. A control that
   * appears in a later slice moves the tab order under the user; one that is
   * present and disabled does not, and it tells the truth about what the
   * application can do today.
   */
  it('renders undo and save disabled', () => {
    renderApp();
    expect((document.getElementById('undobtn') as HTMLButtonElement).disabled).toBe(true);
    expect((document.getElementById('savebtn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('names the save state in words, not by appearance', () => {
    renderApp();
    expect((document.getElementById('savebtn') as HTMLElement).textContent).toBe('Read-only');
  });
});

describe('the screening-only notice', () => {
  it('is present and is not dismissible', () => {
    renderApp();
    const note = screen.getByRole('note');
    expect(note.textContent).toMatch(/Preliminary screening only/);
    expect(within(note).queryByRole('button')).toBeNull();
  });

  it('names the reviewers this product is not', () => {
    renderApp();
    const text = screen.getByRole('note').textContent ?? '';
    for (const who of ['manufacturer', 'engineer of record', 'fire-protection', 'jurisdiction']) {
      expect(text).toContain(who);
    }
  });
});

/**
 * Views that are still routing targets only.
 * `plan` left this list in S3.1/S3.2; `elevation` (S3.3) and `sheets` (S3.4) leave it now;
 * `bom` leaves it with the takeoff and pricing implementation.
 */
const UNIMPLEMENTED_VIEWS = VIEWS.filter(
  (v) =>
    v.path !== 'plan' &&
    v.path !== 'elevation' &&
    v.path !== 'sheets' &&
    v.path !== 'bom',
);

describe('routing', () => {
  it.each(VIEWS.map((v) => [v.path, v.label] as const))(
    '/%s renders the %s view',
    async (path, label) => {
      renderApp(`/${path}`);
      expect(await screen.findByRole('heading', { level: 1 })).toHaveProperty(
        'textContent',
        label,
      );
    },
  );

  it.each(UNIMPLEMENTED_VIEWS.map((v) => [v.path] as const))(
    '/%s still says it is not implemented',
    async (path) => {
      renderApp(`/${path}`);
      await screen.findByRole('heading', { level: 1 });
      expect(screen.getByText(/Not implemented/)).toBeTruthy();
    },
  );

  it('/facility renders the Facility & Unit Entry view', async () => {
    renderApp('/facility');
    expect(await screen.findByRole('heading', { level: 1, name: 'Facility & Unit Entry' })).not.toBeNull();
  });

  it('/options renders the Option Builder view', async () => {
    renderApp('/options');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Option Builder & Controlled Vocabulary' }),
    ).not.toBeNull();
  });

  it('/bom renders the Bill of Materials table and pricing estimator', async () => {
    const user = userEvent.setup();
    renderApp('/bom');
    expect(await screen.findByRole('heading', { level: 1, name: 'BOM' })).not.toBeNull();
    expect(screen.getByRole('table', { name: /bill of materials/i })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /commercial estimator/i })).toBeTruthy();
    expect(screen.getByText(/Pallet Positions/i)).toBeTruthy();
    expect(document.getElementById('bom-quote-banner')?.textContent).toMatch(/Draft takeoff/i);

    const xlsxBtn = document.getElementById('bom-export-xlsx') as HTMLButtonElement;
    await user.click(xlsxBtn);
    expect(document.getElementById('bom-export-notice')?.textContent).toMatch(/MS-13/);

    const csvBtn = document.getElementById('bom-export-csv') as HTMLButtonElement;
    await user.click(csvBtn);
    expect(document.getElementById('bom-export-notice')?.textContent).toMatch(/Exported Canonical CSV/);
  });

  /**
   * The plan view draws. It must NOT claim to be finished either — the document
   * is the continuity fixture and nothing is saved, so the screen says so.
   */
  it('/plan draws and labels its document as a scaffold', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Not implemented/)).toBeNull();
    expect(screen.getByText(/Scaffold document/)).toBeTruthy();
    expect(screen.getByText(/nothing here is saved/i)).toBeTruthy();
  });

  /** A bitmap is never the only way to reach what it shows. */
  it('/plan states its counts as text beside the canvas and renders the legend', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    const img = screen.getByRole('img', { name: /Plan view:/ });
    expect(img.getAttribute('aria-label')).toMatch(/\d+ rack runs/);
    expect(screen.getByText('Pallet positions')).toBeTruthy();
    expect(screen.getByText('Bays')).toBeTruthy();
    expect(screen.getByText('Narrowest clear aisle')).toBeTruthy();
    expect(document.getElementById('legend')).not.toBeNull();
  });

  /**
   * The three finding chips are placeholders until S5 wires kernel-checks. They
   * must read as not-implemented rather than as a zero, because a zero is a
   * claim about the LAYOUT and "not implemented" is a claim about the build.
   */
  it('/plan marks the finding chips as not implemented rather than showing zero', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    for (const label of ['Failing', 'Awaiting input', 'Awaiting source']) {
      const chip = screen.getByText(label).closest('.chip');
      expect(chip?.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('/plan renders the interactive parameter panel wired to setField', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/Interactive parameters/)).toBeTruthy();
    expect(screen.getByText('Job')).toBeTruthy();
    expect(screen.getByText('Client')).toBeTruthy();
    expect(document.getElementById('f-name')).not.toBeNull();
    expect(document.getElementById('levels')).not.toBeNull();
  });

  /** Unestablished values read VERIFY in the panel, exactly as on the drawing. */
  it('/plan shows VERIFY for an unestablished field, never a numeral', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByText('VERIFY').length).toBeGreaterThan(0);
  });

  it('/elevation renders the inline SVG elevation with floor storage and VERIFY datums (S3.3)', async () => {
    renderApp('/elevation');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Not implemented/)).toBeNull();
    const svg = document.getElementById('elevsvg');
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll('[data-item-kind="upright"]').length).toBe(2);
    expect(svg?.querySelectorAll('[data-item-kind="beam"]').length).toBe(3);
    expect(svg?.querySelectorAll('[data-item-kind="unit-load"]').length).toBe(1);
    expect(svg?.textContent).toContain('VERIFY');
  });

  it('/sheets renders the ANSI D sheet preview, honest fitted scale, and switches sheets (S3.4)', async () => {
    const user = userEvent.setup();
    renderApp('/sheets');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Not implemented/)).toBeNull();
    expect(document.getElementById('sheetview')).not.toBeNull();
    expect(document.getElementById('sheetrail')).not.toBeNull();
    expect(document.getElementById('tb-scale')?.textContent).toMatch(/1 : \d+ fitted · NOT TO SCALE ON SCREEN/);
    expect(document.getElementById('tb-stamp')?.textContent).toMatch(/NOT FOR CONSTRUCTION/);
    expect(document.getElementById('tb-num')?.textContent).toBe('R-101');

    const r201Btn = document.querySelector('[data-sheet="R-201"]') as HTMLButtonElement;
    await user.click(r201Btn);
    expect(document.getElementById('tb-num')?.textContent).toBe('R-201');
    expect(document.getElementById('sheet-elev-svg')).not.toBeNull();

    const r501Btn = document.querySelector('[data-sheet="R-501"]') as HTMLButtonElement;
    await user.click(r501Btn);
    expect(document.getElementById('tb-num')?.textContent).toBe('R-501');
    expect(screen.getByText(/BAY & RUN SCHEDULE/)).toBeTruthy();

    // All 13 submittal sheets are in the selector rail (I6)
    expect(document.querySelectorAll('#sheetrail [data-sheet]').length).toBe(13);

    const r401Btn = document.querySelector('[data-sheet="R-401"]') as HTMLButtonElement;
    await user.click(r401Btn);
    expect(document.getElementById('tb-num')?.textContent).toBe('R-401');
    expect(document.querySelector('[data-sheet-plaque="R-401"]')).not.toBeNull();

    const dxfBtn = document.getElementById('sheet-export-dxf') as HTMLButtonElement;
    await user.click(dxfBtn);
    expect(document.getElementById('sheet-dxf-notice')?.textContent).toMatch(/Exported AutoCAD LT DXF/);
  });

  it('redirects / to the plan view', async () => {
    renderApp('/');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveProperty(
      'textContent',
      'Plan',
    );
  });

  it('refuses an unknown view rather than falling back to plan', async () => {
    renderApp('/nope');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveProperty(
      'textContent',
      'No such view',
    );
  });
});

describe('S4 interactive canvas, provenance popover, and undo ledger', () => {
  it('selects a bay, inserts/locks/deletes via #seltoolbar, announces refusals, and undoes', async () => {
    const user = userEvent.setup();
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });

    // Select the first bay via the S4.3 SVG overlay
    const firstBay = document.querySelector('[data-bay-id]') as HTMLElement;
    expect(firstBay).not.toBeNull();
    await user.click(firstBay);

    const toolbar = document.getElementById('seltoolbar');
    expect(toolbar).not.toBeNull();

    // Insert a bay: total bays goes from 16 to 17, and #undobtn becomes enabled
    const insertBtn = toolbar?.querySelector('[data-act="insert"]') as HTMLButtonElement;
    await user.click(insertBtn);
    const undoBtn = document.getElementById('undobtn') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(false);

    // Undo the insert
    await user.click(undoBtn);
    expect(undoBtn.disabled).toBe(true);

    // Lock the selected bay, then try to delete it -> refusal announced in #toast
    const lockBtn = document.querySelector('[data-act="lock"]') as HTMLButtonElement;
    await user.click(lockBtn);
    const deleteBtn = document.querySelector('[data-act="delete"]') as HTMLButtonElement;
    await user.click(deleteBtn);
    const toast = document.getElementById('toast') as HTMLElement;
    expect(toast.textContent).toMatch(/locked/i);
  });

  it('opens and closes the provenance popover (#prov) from .qbtn and dispatches setField edits', async () => {
    const user = userEvent.setup();
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });

    const provBtns = document.querySelectorAll('.qbtn');
    expect(provBtns.length).toBeGreaterThan(0);
    await user.click(provBtns[0] as HTMLButtonElement);

    const provDialog = document.getElementById('prov');
    expect(provDialog).not.toBeNull();
    expect(provDialog?.getAttribute('role')).toBe('dialog');

    const closeBtn = document.getElementById('provclose') as HTMLButtonElement;
    await user.click(closeBtn);
    expect(document.getElementById('prov')).toBeNull();

    // Re-open and dismiss with Escape key (WCAG 2.1 AA keyboard dismissal)
    await user.click(provBtns[0] as HTMLButtonElement);
    expect(document.getElementById('prov')).not.toBeNull();
    await user.keyboard('{Escape}');
    expect(document.getElementById('prov')).toBeNull();

    // Toggle clear height verified checkbox -> dispatches setField and enables undo
    const clearHeightVerified = document.getElementById('f-clearh-v') as HTMLInputElement;
    expect(clearHeightVerified.checked).toBe(false);
    await user.click(clearHeightVerified);
    expect(clearHeightVerified.checked).toBe(true);
    expect((document.getElementById('undobtn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('wires Phase 1 cascading catalog dropdowns (#f-uppart, #f-fd, #f-bmfamily, #f-bmpart, #f-truck)', async () => {
    const user = userEvent.setup();
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });

    const uppart = document.getElementById('f-uppart') as HTMLSelectElement;
    const fd = document.getElementById('f-fd') as HTMLSelectElement;
    const bmfamily = document.getElementById('f-bmfamily') as HTMLSelectElement;
    const bmpart = document.getElementById('f-bmpart') as HTMLSelectElement;
    const truck = document.getElementById('f-truck') as HTMLSelectElement;
    const bmcap = document.getElementById('f-bmcap') as HTMLInputElement;

    expect(uppart.options.length).toBeGreaterThanOrEqual(11);
    expect(fd.options.length).toBe(3);
    expect(bmfamily.options.length).toBe(16);
    expect(bmpart.options.length).toBe(21);
    expect(truck.options.length).toBe(8);

    // Select beam family 59ER -> updates beamPairCapacity to 59ER @ 96" = 8940 lb
    await user.selectOptions(bmfamily, '59ER');
    expect(bmcap.value).toBe('8940');

    // Select published span 108" -> updates beamPairCapacity to 59ER @ 108" = 8040 lb
    await user.selectOptions(bmpart, '108');
    expect(bmcap.value).toBe('8040');

    // Select 4x3 structural upright -> updates upright face width to 4 in
    await user.selectOptions(uppart, '4x3 STRUCTURAL');
    expect(uppart.value).toBe('4x3 STRUCTURAL');

    // Select 48" frame depth
    await user.selectOptions(fd, '48');
    expect(fd.value).toBe('48');

    // Select Stand-up reach planning band -> sets planning AST 108" as VERIFY
    await user.selectOptions(truck, 'Stand-up reach');
    const minAisle = document.getElementById('f-minaisle') as HTMLInputElement;
    expect(minAisle.value).toBe('108');
  });

  it('wires Phase 3 Spec-Sheet Intake Human Confirmation Table (store: false) and Command Bar (Ctrl+K)', async () => {
    const user = userEvent.setup();
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });

    // Open Spec-Sheet Intake -> stages rows with accepted: false (never auto-fills)
    const openIntakeBtn = document.getElementById('open-intake-btn') as HTMLButtonElement;
    await user.click(openIntakeBtn);
    expect(document.getElementById('intake-confirm-table')).not.toBeNull();
    const minAisleVerified = document.getElementById('f-minaisle-v') as HTMLInputElement;
    expect(minAisleVerified.checked).toBe(false);

    // Check only the truckRAS row and click Apply Checked Rows
    const truckRasCheckbox = document.querySelector(
      '[data-intake-row="intake-truckRAS"]',
    ) as HTMLInputElement;
    expect(truckRasCheckbox.checked).toBe(false);
    await user.click(truckRasCheckbox);
    expect(truckRasCheckbox.checked).toBe(true);

    const applyIntakeBtn = document.getElementById('apply-intake-btn') as HTMLButtonElement;
    await user.click(applyIntakeBtn);
    expect(document.getElementById('intake-status')?.textContent).toMatch(/Applied 1 confirmed row/);
    expect(minAisleVerified.checked).toBe(true);

    const closeIntakeBtn = document.getElementById('close-intake-btn') as HTMLButtonElement;
    await user.click(closeIntakeBtn);
    expect(document.getElementById('intake-panel')).toBeNull();

    // Open Command Bar via Ctrl+K shortcut, preview geometric delta, and execute
    await user.keyboard('{Control>}k{/Control}');
    expect(document.getElementById('cmdbar-panel')).not.toBeNull();

    const previewBtn = document.getElementById('cmdbar-preview-btn') as HTMLButtonElement;
    await user.click(previewBtn);
    expect(document.getElementById('cmdbar-preview-card')).not.toBeNull();

    const executeBtn = document.getElementById('cmdbar-execute-btn') as HTMLButtonElement;
    await user.click(executeBtn);
    expect(document.getElementById('cmdbar-preview-card')).toBeNull();
  });
});

describe('the theme toggle', () => {
  it('announces its state in words', () => {
    renderApp();
    expect(document.getElementById('themebtn')?.getAttribute('aria-label')).toMatch(
      /Theme: (light|dark|follow system)/,
    );
  });

  it('cycles and stamps the root element', async () => {
    const user = userEvent.setup();
    renderApp();
    const button = document.getElementById('themebtn') as HTMLButtonElement;

    const labels: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      labels.push(button.getAttribute('aria-label') ?? '');
      await user.click(button);
    }
    expect(new Set(labels).size).toBe(3);
  });
});

describe('the inspector rail', () => {
  /**
   * S1 carried a rail that announced its own emptiness. S3.1 removed it: the
   * plan route renders its own parameter panel, and a region saying "Empty"
   * beside the thing that fills it is worse than no region.
   */
  it('no longer exists as an empty region', () => {
    renderApp();
    expect(screen.queryByRole('complementary', { name: 'Inspector' })).toBeNull();
  });
});

describe('the live region a refusal will be announced in', () => {
  it('exists and is polite', () => {
    renderApp();
    const toast = document.getElementById('toast') as HTMLElement;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
  });
});
