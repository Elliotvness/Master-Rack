/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { StatusBadge } from './badge.js';
import { Banner } from './banner.js';
import { Button } from './button.js';
import { Header } from './header.js';
import { ProvenancePopover, type ProvenanceInfo } from './provenance-popover.js';
import { ToastRegion, type ToastMessage } from './toast.js';

describe('Header component', () => {
  it('renders jobTag when provided, and placeholder when not', () => {
    const { unmount } = render(
      <MemoryRouter>
        <Header jobTag="JOB-2026-001" />
      </MemoryRouter>,
    );
    expect(screen.getByText('JOB-2026-001')).toBeDefined();
    unmount();

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );
    expect(screen.getByText('No document loaded')).toBeDefined();
  });

  it('renders the job steps, the active step\'s views and the action controls', () => {
    render(
      <MemoryRouter initialEntries={['/plan']}>
        <Header canUndo={true} saveState="unsaved" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation', { name: 'Job steps' })).toBeDefined();
    expect(screen.getByRole('navigation', { name: 'Layout views' })).toBeDefined();
    expect(document.getElementById('step-layout')?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Save layout' })).not.toBeNull();
  });
});

describe('Banner component', () => {
  it('renders the screening-only disclaimer with role="note"', () => {
    render(<Banner />);
    const banner = screen.getByRole('note');
    expect(banner).toBeDefined();
    expect(banner.textContent).toContain('Preliminary screening only');
  });
});

describe('ToastRegion component', () => {
  it('renders aria-live polite status region with messages', () => {
    const messages: readonly ToastMessage[] = [
      { id: 1, text: 'Changes saved', tone: 'info' },
      { id: 2, text: 'Overhang exceeds allowable limit', tone: 'refusal' },
    ];
    render(<ToastRegion messages={messages} />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Changes saved')).toBeDefined();
    expect(screen.getByText('Overhang exceeds allowable limit')).toBeDefined();
  });
});

describe('ProvenancePopover component (WCAG AA accessibility)', () => {
  const sampleInfo: ProvenanceInfo = {
    id: 'bay-width',
    label: 'Bay Width',
    established: 'CATALOG',
    displayValue: '96 in',
    rawMicrometres: 2_438_400,
    formula: 'Catalog frame specification',
    source: 'Interlake Mecalux catalog PSG 2025 p.88',
  };

  it('renders dialog with accessible title and field citations', () => {
    render(<ProvenancePopover info={sampleInfo} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeDefined();
    expect(dialog.getAttribute('aria-labelledby')).toBe('prov-title');
    expect(screen.getByText('Bay Width')).toBeDefined();
    expect(screen.getByText('CATALOG')).toBeDefined();
    expect(screen.getByText('96 in')).toBeDefined();
    expect(screen.getByText('2,438,400 µm')).toBeDefined();
    expect(screen.getByText('Catalog frame specification')).toBeDefined();
  });

  it('renders VERIFY when established is UNKNOWN', () => {
    const unknownInfo: ProvenanceInfo = {
      id: 'clear-height',
      label: 'Clear Height',
      established: 'UNKNOWN',
      displayValue: '',
      source: 'Not established by user or catalog',
    };
    render(<ProvenancePopover info={unknownInfo} onClose={vi.fn()} />);
    expect(screen.getByText('VERIFY (not established)')).toBeDefined();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    render(<ProvenancePopover info={sampleInfo} onClose={handleClose} />);
    const closeBtn = screen.getByRole('button', { name: 'Close provenance dialog' });
    await user.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed (no keyboard trap)', async () => {
    const user = userEvent.setup();
    const handleClose = vi.fn();
    render(<ProvenancePopover info={sampleInfo} onClose={handleClose} />);
    await user.keyboard('{Escape}');
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});

describe('StatusBadge component (ADR-019 rule 5: never colour alone)', () => {
  it('renders tone glyph and text label for PASS', () => {
    render(<StatusBadge tone="pass">Compliant</StatusBadge>);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toBe('PASS: Compliant');
    expect(badge.textContent).toContain('✓');
    expect(badge.textContent).toContain('Compliant');
  });

  it('renders tone glyph and text label for WARN', () => {
    render(<StatusBadge tone="warn">Clearance Warning</StatusBadge>);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toBe('WARN: Clearance Warning');
    expect(badge.textContent).toContain('⚠');
    expect(badge.textContent).toContain('Clearance Warning');
  });

  it('renders tone glyph and text label for BLOCK', () => {
    render(<StatusBadge tone="block">Capacity Exceeded</StatusBadge>);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toBe('BLOCK: Capacity Exceeded');
    expect(badge.textContent).toContain('✕');
    expect(badge.textContent).toContain('Capacity Exceeded');
  });

  it('renders tone glyph and text label for VERIFY', () => {
    render(<StatusBadge tone="verify">Unverified Input</StatusBadge>);
    const badge = screen.getByRole('status');
    expect(badge.getAttribute('aria-label')).toBe('VERIFY: Unverified Input');
    expect(badge.textContent).toContain('?');
    expect(badge.textContent).toContain('Unverified Input');
  });
});

describe('Button primitive component', () => {
  it('defaults to type="button" and renders children', () => {
    render(<Button>Submit</Button>);
    const btn = screen.getByRole('button', { name: 'Submit' });
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.hasAttribute('disabled')).toBe(false);
  });

  it('renders loading state with aria-busy and disables interaction', () => {
    render(<Button isLoading loadingText="Saving…">Save</Button>);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.textContent).toBe('Saving…');
  });

  it('renders variant classes correctly', () => {
    const { unmount } = render(<Button variant="primary">Primary</Button>);
    expect(screen.getByRole('button').className).toContain('btn-primary');
    unmount();

    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button').className).toContain('btn-danger');
  });
});
