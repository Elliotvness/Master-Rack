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
    '/%s renders the %s view and says it is not implemented',
    async (path, label) => {
      renderApp(`/${path}`);
      expect(await screen.findByRole('heading', { level: 1 })).toHaveProperty(
        'textContent',
        label,
      );
      expect(screen.getByText(/Not implemented/)).toBeTruthy();
    },
  );

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
