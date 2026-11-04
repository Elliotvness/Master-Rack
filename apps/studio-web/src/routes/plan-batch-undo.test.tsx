/**
 * @vitest-environment jsdom
 *
 * plan-batch-undo.test.tsx
 *
 * Dedicated UI integration tests for:
 * - R1: Single-step undo and single-step redo for multi-command Execute and intake Apply
 * - R1: All-or-nothing batch execution refusal leaving document untouched with 0 ledger entries
 * - R2: Stale intake detection refusing Apply with visible status announcement
 */

import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudioSessionProvider, useStudioSession } from '../session-context.js';
import { type EntityId } from '@rms/studio-model';
import PlanView from './plan.js';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
HTMLCanvasElement.prototype.getContext = (): null => null;

afterEach(cleanup);

function PlanTestWrapper(): React.JSX.Element {
  const { canUndo, canRedo, onUndo, onRedo, runCommands, session } = useStudioSession();

  return (
    <div>
      <header className="test-header">
        <button
          id="undobtn"
          type="button"
          disabled={!canUndo}
          onClick={onUndo}
          aria-label="Undo"
        >
          Undo
        </button>
        <button
          id="redobtn"
          type="button"
          disabled={!canRedo}
          onClick={onRedo}
          aria-label="Redo"
        >
          Redo
        </button>
        <span id="test-ledger-depth">{session.ledger.depth}</span>
        <span id="test-run-count">{session.document.runs.length}</span>
        <button
          id="test-refusing-batch-btn"
          type="button"
          onClick={() => {
            runCommands([
              {
                type: 'setField',
                label: 'Valid clear height',
                change: {
                  section: 'building',
                  patch: {
                    clearHeight: {
                      value: 400 * 25_400,
                      established: 'INPUT',
                      source: 'Test',
                    },
                  },
                },
              },
              {
                type: 'splitRun',
                bayId: 'invalid-bay-id-does-not-exist' as EntityId,
              },
            ]);
          }}
        >
          Run Refusing Batch
        </button>
      </header>
      <PlanView />
    </div>
  );
}

function renderPlan(onRefusal?: (msg: string) => void) {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <StudioSessionProvider onRefusal={onRefusal}>
        <PlanTestWrapper />
      </StudioSessionProvider>
    </MemoryRouter>,
  );
}

describe('R1: Single-step Undo and Redo for Multi-Command Execution', () => {
  it('Test 1: Single-step undo and single-step redo for multi-command Execute in the Command Bar', async () => {
    const user = userEvent.setup();
    renderPlan();

    const undoBtn = document.getElementById('undobtn') as HTMLButtonElement;
    const redoBtn = document.getElementById('redobtn') as HTMLButtonElement;
    const depthSpan = document.getElementById('test-ledger-depth') as HTMLElement;
    const runCountSpan = document.getElementById('test-run-count') as HTMLElement;

    // Initial state: 0 ledger entries, 3 runs in fixture
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
    expect(depthSpan.textContent).toBe('0');
    expect(runCountSpan.textContent).toBe('3');

    // Open Command Bar via button
    const openCmdBarBtn = document.getElementById('open-cmdbar-btn') as HTMLButtonElement;
    await user.click(openCmdBarBtn);
    expect(document.getElementById('cmdbar-panel')).not.toBeNull();

    // Preview commands (translates canned splitRun + setAisleAfter = 2 commands)
    const previewBtn = document.getElementById('cmdbar-preview-btn') as HTMLButtonElement;
    await user.click(previewBtn);
    expect(document.getElementById('cmdbar-preview-card')).not.toBeNull();

    // Execute the previewed multi-command sequence
    const executeBtn = document.getElementById('cmdbar-execute-btn') as HTMLButtonElement;
    await user.click(executeBtn);

    // Assert both commands applied: 4 runs now exist, status announces 2 commands executed
    expect(document.getElementById('cmdbar-status')?.textContent).toMatch(/Executed 2 command/);
    expect(runCountSpan.textContent).toBe('4');

    // CRITICAL R1 ASSERTION: Exactly ONE ledger entry was added for the multi-command execution
    expect(depthSpan.textContent).toBe('1');
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);

    // Single-step Undo: Clicking Undo ONCE reverts all commands in the batch
    await user.click(undoBtn);

    // Both commands are reverted: run count back to 3, ledger depth back to 0, undo disabled
    expect(runCountSpan.textContent).toBe('3');
    expect(depthSpan.textContent).toBe('0');
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(false);

    // Single-step Redo: Clicking Redo ONCE re-applies all commands in the batch
    await user.click(redoBtn);

    // Both commands re-applied in one step: run count back to 4, ledger depth back to 1
    expect(runCountSpan.textContent).toBe('4');
    expect(depthSpan.textContent).toBe('1');
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);
  });

  it('Test 2: Single-step undo and single-step redo for intake table Apply', async () => {
    const user = userEvent.setup();
    renderPlan();

    const undoBtn = document.getElementById('undobtn') as HTMLButtonElement;
    const redoBtn = document.getElementById('redobtn') as HTMLButtonElement;
    const depthSpan = document.getElementById('test-ledger-depth') as HTMLElement;

    // Initial state
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
    expect(depthSpan.textContent).toBe('0');

    const minAisleVerified = document.getElementById('f-minaisle-v') as HTMLInputElement;
    const clearHeightVerified = document.getElementById('f-clearh-v') as HTMLInputElement;
    const clearHeightInput = document.getElementById('f-clearh') as HTMLInputElement;

    expect(minAisleVerified.checked).toBe(false);
    expect(clearHeightVerified.checked).toBe(false);
    expect(clearHeightInput.value).toBe('336');

    // Open Spec-Sheet Intake
    const openIntakeBtn = document.getElementById('open-intake-btn') as HTMLButtonElement;
    await user.click(openIntakeBtn);
    expect(document.getElementById('intake-confirm-table')).not.toBeNull();

    // Check multiple rows: truckRAS and clearHeight
    const truckRasCheckbox = document.querySelector(
      '[data-intake-row="intake-truckRAS"]',
    ) as HTMLInputElement;
    const clearHeightCheckbox = document.querySelector(
      '[data-intake-row="intake-clearHeight"]',
    ) as HTMLInputElement;

    expect(truckRasCheckbox).not.toBeNull();
    expect(clearHeightCheckbox).not.toBeNull();

    await user.click(truckRasCheckbox);
    await user.click(clearHeightCheckbox);
    expect(truckRasCheckbox.checked).toBe(true);
    expect(clearHeightCheckbox.checked).toBe(true);

    // Apply Checked Rows
    const applyIntakeBtn = document.getElementById('apply-intake-btn') as HTMLButtonElement;
    await user.click(applyIntakeBtn);

    // Assert both rows applied: status message and DOM field updates
    expect(document.getElementById('intake-status')?.textContent).toMatch(
      /Applied 2 confirmed row\(s\)/,
    );
    expect(minAisleVerified.checked).toBe(true);
    expect(clearHeightVerified.checked).toBe(true);
    expect(clearHeightInput.value).toBe('384');

    // CRITICAL R1 ASSERTION: Exactly ONE ledger entry was added for applying multiple rows
    expect(depthSpan.textContent).toBe('1');
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);

    // Single-step Undo: Clicking Undo ONCE reverts all changes from the applied rows
    await user.click(undoBtn);

    expect(minAisleVerified.checked).toBe(false);
    expect(clearHeightVerified.checked).toBe(false);
    expect(clearHeightInput.value).toBe('336');
    expect(depthSpan.textContent).toBe('0');
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(false);

    // Single-step Redo: Clicking Redo ONCE restores all changes from the applied rows
    await user.click(redoBtn);

    expect(minAisleVerified.checked).toBe(true);
    expect(clearHeightVerified.checked).toBe(true);
    expect(clearHeightInput.value).toBe('384');
    expect(depthSpan.textContent).toBe('1');
    expect(undoBtn.disabled).toBe(false);
    expect(redoBtn.disabled).toBe(true);
  });

  it('Test 3: Batch execution with one refusing command leaves document untouched and records 0 ledger entries', async () => {
    const user = userEvent.setup();
    const onRefusal = vi.fn();
    renderPlan(onRefusal);

    const undoBtn = document.getElementById('undobtn') as HTMLButtonElement;
    const depthSpan = document.getElementById('test-ledger-depth') as HTMLElement;
    const clearHeightInput = document.getElementById('f-clearh') as HTMLInputElement;

    // Initial state
    expect(undoBtn.disabled).toBe(true);
    expect(depthSpan.textContent).toBe('0');
    expect(clearHeightInput.value).toBe('336');

    // Execute batch containing a valid setField and an invalid splitRun
    const refusingBatchBtn = document.getElementById('test-refusing-batch-btn') as HTMLButtonElement;
    await user.click(refusingBatchBtn);

    // Refusal callback was invoked
    expect(onRefusal).toHaveBeenCalledTimes(1);

    // All-or-nothing: document is completely untouched (clearHeight remains 336)
    expect(clearHeightInput.value).toBe('336');

    // 0 ledger entries recorded, Undo remains disabled
    expect(depthSpan.textContent).toBe('0');
    expect(undoBtn.disabled).toBe(true);
  });
});

describe('R2: Stale Intake Detection', () => {
  it('Test 4: Stale intake rows. Stage intake rows, mutate document, then click Apply. Confirm Apply refuses with visible message and leaves document untouched', async () => {
    const user = userEvent.setup();
    renderPlan();

    const minAisleVerified = document.getElementById('f-minaisle-v') as HTMLInputElement;
    const minAisleInput = document.getElementById('f-minaisle') as HTMLInputElement;
    const initialMinAisleValue = minAisleInput.value;
    expect(minAisleVerified.checked).toBe(false);

    // 1. Stage intake rows
    const openIntakeBtn = document.getElementById('open-intake-btn') as HTMLButtonElement;
    await user.click(openIntakeBtn);
    expect(document.getElementById('intake-confirm-table')).not.toBeNull();

    // Check a row (truckRAS = 108")
    const truckRasCheckbox = document.querySelector(
      '[data-intake-row="intake-truckRAS"]',
    ) as HTMLInputElement;
    expect(truckRasCheckbox).not.toBeNull();
    await user.click(truckRasCheckbox);
    expect(truckRasCheckbox.checked).toBe(true);

    // 2. Mutate document after intake staging by toggling clear height verified checkbox
    const clearHeightVerified = document.getElementById('f-clearh-v') as HTMLInputElement;
    expect(clearHeightVerified.checked).toBe(false);
    await user.click(clearHeightVerified);
    expect(clearHeightVerified.checked).toBe(true);

    // 3. Attempt to apply staged intake rows on the now-mutated document
    const applyIntakeBtn = document.getElementById('apply-intake-btn') as HTMLButtonElement;
    await user.click(applyIntakeBtn);

    // 4. Verify Apply refuses with a visible message in #intake-status
    const intakeStatus = document.getElementById('intake-status');
    expect(intakeStatus).not.toBeNull();
    expect(intakeStatus?.textContent).toContain(
      'The document changed since intake staging. Intake rows are stale.',
    );

    // 5. Verify the staged intake row was NOT applied to the document
    expect(minAisleVerified.checked).toBe(false);
    expect(minAisleInput.value).toBe(initialMinAisleValue);

    // The intake row remains unapplied in the table
    expect(document.querySelector('[data-intake-row="intake-truckRAS"]')).not.toBeNull();
  });
});
