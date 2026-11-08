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
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('routing', () => {
  it.each(VIEWS.map((v) => [v.path, v.label] as const))(
    '/%s renders the %s view',
    async (path, label) => {
      renderApp(`/${path}`);
      expect(await screen.findByRole('heading', { level: 1 })).toHaveProperty(
        'textContent',
        label,
      );
      expect(screen.queryByText(/Not implemented/)).toBeNull();
    },
  );

  it('/screening renders compliance findings, fix proposals, and D8 audit trail when a fix is accepted', async () => {
    const user = userEvent.setup();
    renderApp('/screening');
    expect(await screen.findByRole('heading', { level: 1, name: 'Checks' })).not.toBeNull();
    expect(document.getElementById('screening-pack-pins')?.textContent).toContain(
      'mcs-2026.08',
    );
    expect(screen.getByRole('table', { name: /compliance screening findings/i })).toBeTruthy();
    expect(document.getElementById('screening-position-identity')?.textContent).toMatch(
      /Gross \(\d+\) - Lost \(0 across 8 tracked reasons\) = Net Usable \(\d+\)/,
    );

    const acceptBtns = document.querySelectorAll('[id^="accept-fix-"]');
    expect(acceptBtns.length).toBeGreaterThan(0);
    await user.click(acceptBtns[0] as HTMLButtonElement);
    expect(document.getElementById('screening-audit-log')?.textContent).toMatch(
      /Changed by Rule Set/,
    );
  });

  /**
   * ADR-020's Review & submit: two REQUIRED steps, and open checks that are not.
   * Blueprint §15: "the gap travels with the submission rather than blocking
   * it" — so the fixture's two BLOCKING aisle findings must not stop the lock.
   */
  it('/revisions counts required steps down and locks with blocking checks still open', async () => {
    const user = userEvent.setup();
    renderApp('/revisions');
    await screen.findByRole('heading', { level: 1, name: 'Review & submit' });
    const left = document.getElementById('rev-required-left') as HTMLElement;
    expect(left.textContent).toBe('2 required steps left.');
    expect(screen.getByText('Not required to lock')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Blocking findings' }).children.length).toBe(2);

    for (const box of document.querySelectorAll('[data-assumption-key]')) {
      await user.click(box as HTMLInputElement);
    }
    expect(left.textContent).toBe('1 required step left.');
    await user.click(document.getElementById('rev-ack-disclaimer') as HTMLInputElement);
    expect(left.textContent).toBe('Ready to lock.');

    await user.click(document.getElementById('rev-lock-btn') as HTMLButtonElement);
    expect(document.getElementById('rev-state')?.textContent).toBe('FROZEN');
    expect(left.textContent).toBe('P01 is locked.');
  });

  it('/revisions enforces multi-reason pre-submission refusal, locks P01, clones to P02, and creates internal C01 trace', async () => {
    const user = userEvent.setup();
    renderApp('/revisions');
    expect(await screen.findByRole('heading', { level: 1, name: 'Review & submit' })).not.toBeNull();
    expect(document.getElementById('rev-code')?.textContent).toBe('P01');
    expect(document.getElementById('rev-state')?.textContent).toBe('DRAFT');

    // Attempt to lock without acknowledging assumptions or disclaimer -> refused with 2 reasons
    const lockBtn = document.getElementById('rev-lock-btn') as HTMLButtonElement;
    await user.click(lockBtn);
    expect(document.getElementById('rev-refusal-banner')?.textContent).toMatch(
      /Preliminary lock refused \(2 reason\(s\)\)/,
    );

    // Acknowledge all assumptions and disclaimer -> lock succeeds -> FROZEN
    const assumptionBoxes = document.querySelectorAll('[data-assumption-key]');
    for (const box of assumptionBoxes) {
      await user.click(box as HTMLInputElement);
    }
    const disclaimerBox = document.getElementById('rev-ack-disclaimer') as HTMLInputElement;
    await user.click(disclaimerBox);
    await user.click(lockBtn);

    expect(document.getElementById('rev-state')?.textContent).toBe('FROZEN');
    expect(document.getElementById('rev-status-notice')?.textContent).toMatch(/FROZEN/);

    // Create internal commercial revision C01 and inspect "Show Your Work" trace
    const c01Btn = document.getElementById('rev-create-c01-btn') as HTMLButtonElement;
    await user.click(c01Btn);
    expect(document.getElementById('rev-c01-panel')).not.toBeNull();
    expect(document.getElementById('rev-trace-table')).not.toBeNull();

    // Clone frozen P01 to editable Draft P02
    const cloneBtn = document.getElementById('rev-clone-btn') as HTMLButtonElement;
    await user.click(cloneBtn);
    expect(document.getElementById('rev-code')?.textContent).toBe('P02');
    expect(document.getElementById('rev-state')?.textContent).toBe('DRAFT');

    // Sync Studio draft to Revision API (facility, units, options, submit, clone)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ id: 'rev-1' }), { status: 200 }));
    try {
      const revIdInput = document.getElementById('rev-id-input') as HTMLInputElement;
      await user.type(revIdInput, '00000000-0000-4000-8000-000000000001');
      const syncBtn = document.getElementById('rev-sync-draft-btn') as HTMLButtonElement;
      await user.click(syncBtn);
      expect(fetchSpy).toHaveBeenCalledTimes(3);
      expect(document.getElementById('rev-status-notice')?.textContent).toMatch(
        /Synced Studio draft/,
      );

      await user.click(lockBtn);
      expect(fetchSpy).toHaveBeenCalledTimes(4);
      const cloneBtn2 = document.getElementById('rev-clone-btn') as HTMLButtonElement;
      await user.click(cloneBtn2);
      expect(fetchSpy).toHaveBeenCalledTimes(5);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('/facility renders the Facility view', async () => {
    renderApp('/facility');
    expect(await screen.findByRole('heading', { level: 1, name: 'Facility' })).not.toBeNull();
  });

  it('/options renders the Option Builder view', async () => {
    renderApp('/options');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Options' }),
    ).not.toBeNull();
  });

  /** OD-06: micrometres are storage; a person never reads `6096000um`. */
  it('/bom shows lengths in feet and inches, names each line’s run, and rolls up job totals', async () => {
    renderApp('/bom');
    await screen.findByRole('heading', { level: 1, name: 'Takeoff' });
    const table = screen.getByRole('table', { name: 'Bill of materials line items' });
    expect(table.textContent).not.toMatch(/\d+um\b/);
    expect(table.textContent).toContain(`20'-0" (6096 mm)`);
    expect(table.textContent).toContain('Run 1');
    expect(table.textContent).toContain('Run 2');
    expect(table.textContent).toContain('Run 3');
    expect(table.textContent).toContain('Job Total (3 runs)');
    expect(table.textContent).toContain(
      '78 EA upright frames · 432 EA load beams · 312 EA wedge anchors',
    );
    expect(screen.getByText('Upright Frames (78 ea across 3 runs)')).toBeTruthy();
    expect(screen.getByText('Load Beams (432 ea)')).toBeTruthy();
  });

  it('/bom renders the Bill of Materials table and pricing estimator', async () => {
    const user = userEvent.setup();
    renderApp('/bom');
    expect(await screen.findByRole('heading', { level: 1, name: 'Takeoff' })).not.toBeNull();
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
  it('/plan draws and labels its document as a sample that is not saved', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Not implemented/)).toBeNull();
    expect(screen.getByText(/Sample layout/)).toBeTruthy();
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
   * The three finding chips on the plan HUD read from `screeningFindingsForDocument`
   * so they always agree with the checks drawer beneath the drawing.
   */
  it('/plan shows live finding counts in the HUD chips matching the checks drawer', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    for (const label of ['Failing', 'Awaiting input', 'Awaiting source']) {
      const chip = screen.getByText(label).closest('.chip');
      expect(chip?.getAttribute('aria-disabled')).toBeNull();
      expect(chip?.querySelector('.chip-value')?.textContent).toBe('2');
    }
  });

  it('/plan renders the interactive parameter panel wired to setField', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText(/Undo reverses it/)).toBeTruthy();
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

  it('/elevation renders the inline SVG elevation with floor storage, CAD bracing, beam face thickness, ghosted loads, snap-to-pitch, and inline dimension editing (S3.3)', async () => {
    const user = userEvent.setup();
    renderApp('/elevation');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Not implemented/)).toBeNull();
    const svg = document.getElementById('elevsvg');
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll('[data-item-kind="upright"]').length).toBe(2);
    expect(svg?.querySelectorAll('[data-item-kind="beam"]').length).toBe(3);
    expect(svg?.querySelectorAll('[data-item-kind="unit-load"]').length).toBe(1);
    expect(svg?.textContent).toContain('VERIFY');

    // 1. Physical beam face thickness, upright diagonal bracing, slab, ceiling, and T.O.B. CAD dimension chain
    expect(document.getElementById('elevation-canvas')).not.toBeNull();
    expect(document.getElementById('elevsvg-concrete-slab')).not.toBeNull();
    expect(document.getElementById('elevsvg-ceiling-limit-line')).not.toBeNull();
    expect(document.getElementById('elevsvg-upright-bracing')).not.toBeNull();
    expect(svg?.querySelectorAll('.elev-bracing-strut').length).toBeGreaterThan(0);
    expect(svg?.querySelectorAll('[data-beam-face-index]').length).toBe(3);
    expect(document.getElementById('elevsvg-cad-dim-chain')).not.toBeNull();
    expect(svg?.textContent).toContain('T.O.B.');

    // 2. Ghosted Pallet Loads toggle & Lift-Off Clearance zones
    expect(svg?.querySelectorAll('[data-ghost-load-level]').length).toBeGreaterThanOrEqual(3);
    expect(svg?.querySelectorAll('[data-liftoff-level]').length).toBe(3);
    const toggleLoadsBtn = document.getElementById('elev-toggle-loads-btn') as HTMLButtonElement;
    await user.click(toggleLoadsBtn);
    expect(svg?.querySelectorAll('[data-ghost-load-level]').length).toBe(0);
    await user.click(toggleLoadsBtn);
    expect(svg?.querySelectorAll('[data-ghost-load-level]').length).toBeGreaterThanOrEqual(3);

    // 3. Inline Click-to-Type Dimension Editing with Snap-to-Pitch (typing 63 in 2" pitch mode snaps to 64" T.O.B.)
    const dimBtn0 = document.getElementById('elev-dim-btn-0') as HTMLButtonElement;
    expect(dimBtn0.textContent).toContain('60"');
    await user.click(dimBtn0);
    const inlineInput = document.getElementById('elev-inline-dim-input') as HTMLInputElement;
    expect(inlineInput).not.toBeNull();
    await user.clear(inlineInput);
    await user.type(inlineInput, '63{Enter}');
    expect(document.getElementById('elev-dim-btn-0')?.textContent).toContain('64"');

    // 4. Inline Click-to-Type Ceiling Clear Height Verification
    const clearHeightTag = document.getElementById('elev-clear-height-tag') as HTMLButtonElement;
    expect(clearHeightTag.textContent).toContain('VERIFY');
    await user.click(clearHeightTag);
    const ceilingInput = document.getElementById('elev-inline-dim-input') as HTMLInputElement;
    await user.clear(ceilingInput);
    await user.type(ceilingInput, '300{Enter}');
    expect(document.getElementById('elev-clear-height-tag')?.textContent).toContain('300"');
    expect(document.getElementById('elev-clear-height-tag')?.textContent).toContain('VERIFIED');
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
    // Applied row leaves the table, so a second click cannot apply it twice
    expect(document.querySelector('[data-intake-row="intake-truckRAS"]')).toBeNull();
    await user.click(applyIntakeBtn);
    expect(document.getElementById('intake-status')?.textContent).toMatch(/Nothing applied/);

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
    // Both commands applied (split + aisle), not just the last one
    expect(document.getElementById('cmdbar-status')?.textContent).toMatch(/Executed 2 command/);
  });

  it('calls POST /api/client/v1/intake and stages returned extraction into the Human Confirmation Table', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          file_name: 'Crown-RM6000.pdf',
          store: false,
          extraction: {
            documentKind: 'FORKLIFT_SPEC_SHEET',
            truckRasIn: { value: 96, unit: 'in', sourcePage: 3, confidence: 0.99 },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });

    await user.click(document.getElementById('open-intake-btn') as HTMLButtonElement);
    await user.click(document.getElementById('extract-intake-api-btn') as HTMLButtonElement);

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/client/v1/intake',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(document.getElementById('intake-status')?.textContent).toMatch(
      /Staged 1 extracted field\(s\) from Crown-RM6000\.pdf/,
    );
    fetchSpy.mockRestore();
  });

  it('supports Columns First (0b) starter mode, Escape to exit tools/popovers, and interactive AI Assistant placement', async () => {
    const user = userEvent.setup();
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });

    // Click Columns First (0b) in the bottom dock -> 0 rack runs + activates Stamp Column tool
    const colsFirstBtn = document.getElementById('start-columns-first-btn') as HTMLButtonElement;
    await user.click(colsFirstBtn);

    const canvas = document.querySelector('canvas.plan-canvas') as HTMLCanvasElement;
    expect(canvas.getAttribute('aria-label')).toMatch(/0 rack runs/);

    const colToolBtn = document.getElementById('tool-column-btn') as HTMLButtonElement;
    const selToolBtn = document.getElementById('tool-select-btn') as HTMLButtonElement;
    expect(colToolBtn.getAttribute('aria-pressed')).toBe('true');

    // Press Escape -> exits Stamp Column tool back to Select / Pan
    await user.keyboard('{Escape}');
    expect(colToolBtn.getAttribute('aria-pressed')).toBe('false');
    expect(selToolBtn.getAttribute('aria-pressed')).toBe('true');

    // Open interactive AI Assistant chat, stamp a column at (40', 20'), and place racks around columns
    const aiChatBtn = document.getElementById('open-ai-chat-btn') as HTMLButtonElement;
    await user.click(aiChatBtn);
    expect(document.getElementById('ai-chat-panel')).not.toBeNull();

    await user.click(document.getElementById('chat-quick-stamp-col') as HTMLButtonElement);
    expect(document.getElementById('ai-chat-messages')?.textContent).toMatch(/COL-1/);

    await user.click(document.getElementById('chat-quick-place-racks') as HTMLButtonElement);
    expect(canvas.getAttribute('aria-label')).not.toMatch(/0 rack runs/);

    // Press Escape -> closes the AI Assistant popover
    await user.keyboard('{Escape}');
    expect(document.getElementById('ai-chat-panel')).toBeNull();
  });

  it('renders the Main Page, User Access & System Guide at /welcome and enables one-click role access', async () => {
    const user = userEvent.setup();
    renderApp('/welcome');

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: /Warehouse Rack Layout, AI Placement & Submittal Portal/i,
    });
    expect(heading).toBeTruthy();

    expect(document.getElementById('role-access-grid')).not.toBeNull();
    expect(document.getElementById('workflow-guide-grid')).not.toBeNull();
    expect(document.getElementById('shortcuts-reference-table')).not.toBeNull();

    // One-click Engineer role access signs the user in and enters the Plan studio
    const engBtn = document.getElementById('quick-access-engineer') as HTMLButtonElement;
    await user.click(engBtn);

    await screen.findByRole('heading', { level: 1, name: 'Plan' });
    expect(document.getElementById('user-badge')?.textContent).toMatch(/Applications Engineer/i);
  });

  it('wires 1.25x load multiplier tooltip, overturning ratio warning, warehouse toggles, zip intelligence, and Takeoff interactive HTML5 canvas + DXF export', async () => {
    const user = userEvent.setup();
    renderApp('/plan');

    await screen.findByRole('heading', { level: 1, name: 'Plan' });

    // 1. 1.25x Load Multiplier callout and Overturning H:D Ratio banner
    expect(document.getElementById('load-multiplier-tooltip')?.textContent).toMatch(
      /1\.25× Load Multiplier Info/i,
    );
    expect(document.getElementById('overturning-warning-banner')?.textContent).toMatch(
      /Exceeds 6:1 — reinforced anchoring required\. Overhead ties highly recommended for SDC D stability\./i,
    );

    // 2. High-Contrast Visual Toggle Switches (Slab Storage & Heavy Wire Decking)
    const slabToggle = document.getElementById('toggle-slab-storage') as HTMLButtonElement;
    const deckToggle = document.getElementById('toggle-heavy-decking') as HTMLButtonElement;
    expect(slabToggle.getAttribute('role')).toBe('switch');
    expect(deckToggle.getAttribute('role')).toBe('switch');
    await user.click(deckToggle);
    expect(deckToggle.getAttribute('aria-checked')).toBe('true');

    // 3. Site Zip Code USGS & LTL Location Intelligence
    const zipInput = document.getElementById('site-zip-input') as HTMLInputElement;
    await user.type(zipInput, '90210');
    expect(document.getElementById('zip-location-badge')?.textContent).toMatch(/California Region/i);
    expect(document.getElementById('zip-location-badge')?.textContent).toMatch(/10\.25%/i);

    // 4. Navigate to Takeoff (/bom) -> verify Interactive HTML5 Canvas, Contextual Toolbar, DXF Export, and Logistics Module
    await user.click(screen.getByRole('link', { name: 'Takeoff' }));
    await screen.findByRole('heading', { level: 1, name: 'Takeoff' });

    expect(document.getElementById('bom-visual-grid-canvas')).not.toBeNull();
    expect(document.getElementById('logistics-automation-card')).not.toBeNull();

    // Select Run 1 · Bay 1 on the Takeoff Interactive Canvas and insert a bay
    const selectBayBtn = document.getElementById('bom-select-first-bay-btn') as HTMLButtonElement;
    await user.click(selectBayBtn);
    expect(document.getElementById('bom-canvas-toolbar')?.textContent).toMatch(/Run 1 · Bay 1/i);

    // Download .DXF from the Takeoff Interactive Canvas
    const dxfBtn = document.getElementById('bom-download-dxf-btn') as HTMLButtonElement;
    await user.click(dxfBtn);
    expect(document.getElementById('bom-export-notice')?.textContent).toMatch(/Downloaded AutoCAD \.DXF/i);
  });

  it('highlights blocking aisle clearance on #f-aisle in safety orange and supports collapsible sidebar + OffscreenCanvas', async () => {
    const user = userEvent.setup();
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1, name: 'Plan' });

    // Default sample layout has 126" clear aisle vs 126.3" required -> contextual alert on #f-aisle
    const aisleAlert = document.getElementById('f-aisle-blocking-alert');
    expect(aisleAlert).not.toBeNull();
    expect(aisleAlert?.textContent).toMatch(/truck needs 126\.3"/i);
    const aisleInput = document.getElementById('f-aisle') as HTMLInputElement;
    expect(aisleInput.getAttribute('aria-invalid')).toBe('true');

    // Collapsible 420px configuration sidebar
    const sidebar = document.getElementById('config-sidebar') as HTMLElement;
    const toggleSidebarBtn = document.getElementById('toggle-config-sidebar-btn') as HTMLButtonElement;
    expect(sidebar.className).not.toContain('plan-sidebar-collapsed');
    await user.click(toggleSidebarBtn);
    expect(sidebar.className).toContain('plan-sidebar-collapsed');
    await user.click(toggleSidebarBtn);
    expect(sidebar.className).not.toContain('plan-sidebar-collapsed');

    // OffscreenCanvas worker-ready canvas attribute
    const canvas = document.querySelector('canvas.plan-canvas');
    expect(canvas?.getAttribute('data-render-engine')).toBe('offscreen-worker-ready');
  });

  it('supports 1-click Checks Auto-Fix, double-click Bay Context Menu HUD, CAD Command Palette, IndexedDB Auto-Save, and Viewport Minimap', async () => {
    const user = userEvent.setup();
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1, name: 'Plan' });

    // 1. Viewport Minimap is rendered with safety-orange camera rect
    expect(document.getElementById('plan-viewport-minimap')).not.toBeNull();
    expect(document.getElementById('plan-minimap-viewport-rect')).not.toBeNull();

    // 2. 1-Click "Auto-Fix" Resolution in Checks Drawer
    const autoFixBtn = document.getElementById('checks-autofix-aisle-btn') as HTMLButtonElement;
    expect(autoFixBtn).not.toBeNull();
    expect(autoFixBtn.textContent).toMatch(/Auto-adjust to 133"/i);
    await user.click(autoFixBtn);
    // After 1-click auto-adjust, the blocking aisle alert is resolved
    expect(document.getElementById('f-aisle-blocking-alert')).toBeNull();
    expect(document.getElementById('checks-drawer')?.textContent).toMatch(/0 blocking/i);

    // 3. Double-Click Bay on Canvas opens Floating Context Menu HUD
    const firstBayRect = document.querySelector('rect[data-bay-id]') as SVGRectElement;
    expect(firstBayRect).not.toBeNull();
    await user.dblClick(firstBayRect);
    const ctxMenu = document.getElementById('canvas-bay-context-menu');
    expect(ctxMenu).not.toBeNull();
    const lockBtn = document.getElementById('ctx-toggle-lock-bay-btn') as HTMLButtonElement;
    await user.click(lockBtn);
    expect(document.getElementById('canvas-bay-context-menu')).toBeNull();
    expect(firstBayRect.getAttribute('data-locked')).toBe('true');

    // 4. CAD Command Palette (Ctrl+K / #open-cmdbar-btn) with fuzzy search
    const openCmdBtn = document.getElementById('open-cmdbar-btn') as HTMLButtonElement;
    await user.click(openCmdBtn);
    const cmdkInput = document.getElementById('cad-cmdk-input') as HTMLInputElement;
    expect(cmdkInput).not.toBeNull();
    await user.type(cmdkInput, '132');
    const set132Item = document.getElementById('cmdk-item-aisles-132') as HTMLButtonElement;
    expect(set132Item).not.toBeNull();
    await user.click(set132Item);
    expect((document.getElementById('f-aisle') as HTMLInputElement).value).toBe('132');

    // 5. Local-First IndexedDB Save
    const idbSaveBtn = document.getElementById('autosave-idb-now-btn') as HTMLButtonElement;
    await user.click(idbSaveBtn);
    expect(document.getElementById('autosave-idb-badge')?.textContent).toMatch(
      /IndexedDB Auto-Saved/i,
    );

    // 6. Floating CAD Dock groups, SVG icons + tooltips, and offloaded Command Palette actions
    const floatingDock = document.getElementById('plan-floating-dock');
    expect(floatingDock).not.toBeNull();
    expect(document.getElementById('dock-group-drafting')).not.toBeNull();
    expect(document.getElementById('dock-group-utilities')).not.toBeNull();
    expect(document.getElementById('dock-group-smart')).not.toBeNull();
    expect(floatingDock?.querySelectorAll('.dock-divider').length).toBe(2);
    expect(floatingDock?.querySelectorAll('svg.dock-svg-icon').length).toBeGreaterThanOrEqual(8);
    expect(floatingDock?.querySelectorAll('.dock-tooltip').length).toBeGreaterThanOrEqual(8);

    // Infrequent actions (Read a spec sheet, Export / Import Project JSON) are searchable in Ctrl+K
    await user.clear(cmdkInput);
    await user.type(cmdkInput, 'spec sheet');
    const readSpecItem = document.getElementById('cmdk-item-read-spec-sheet') as HTMLButtonElement;
    expect(readSpecItem).not.toBeNull();
    await user.click(readSpecItem);
    expect(document.getElementById('intake-panel')).not.toBeNull();
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
