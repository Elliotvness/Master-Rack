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

/** Views that are still routing targets only. `plan` left this list in S3. */
const UNIMPLEMENTED_VIEWS = VIEWS.filter((v) => v.path !== 'plan');

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
  it('/plan states its counts as text beside the canvas', async () => {
    renderApp('/plan');
    await screen.findByRole('heading', { level: 1 });
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/\d+ rack runs/);
    expect(screen.getByText('runs')).toBeTruthy();
    expect(screen.getByText('bays')).toBeTruthy();
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
  it('explains its emptiness rather than being blank', () => {
    renderApp();
    const rail = screen.getByRole('complementary', { name: 'Inspector' });
    expect(rail.textContent).toMatch(/Empty/);
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
