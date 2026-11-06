import {
  applyConfirmedIntakeRows,
  isIntakeCurrent,
  isPreviewCurrent,
  parseAndValidateCommandBarOutput,
  previewCommandSequence,
  stageIntakeConfirmationTable,
  toggleIntakeRowAcceptance,
  type CommandPreviewCard,
  type IntakeConfirmationRow,
  type IntakeDocumentKind,
  type IntakeExtractionPayload,
} from '@rms/studio-model';
import { useEffect, useState } from 'react';

import { ChecksDrawer } from '../checks/checks-drawer.js';
import { ParamsPanel } from '../plan/params-panel.js';
import { PlanCanvas } from '../plan/plan-canvas.js';
import { useStudioSession } from '../session-context.js';

const SAMPLE_FORKLIFT_EXTRACTION = {
  documentKind: 'FORKLIFT_SPEC_SHEET' as const,
  truckType: { value: 'Stand-up reach', sourcePage: 2, confidence: 0.98 },
  truckRasIn: { value: 108, unit: 'in' as const, sourcePage: 2, confidence: 0.96 },
  clearHeightIn: { value: 384, unit: 'in' as const, sourcePage: 1, confidence: 0.95 },
};

/**
 * The plan view.
 *
 * **The document is the continuity fixture, migrated v1 → v2 at load.** That is
 * a scaffold and it is labelled as one on screen: S6 replaces it with the
 * revision API and OPFS autosave. Using the real fixture rather than a
 * hand-written sample is deliberate — it is the same document the migration and
 * command suites run against, so what is drawn here is what those tests assert,
 * not a second sample that could drift from them.
 */
export default function PlanView(): React.JSX.Element {
  const { session, plan, findingCounts, runCommand, runCommands, onUndo } = useStudioSession();
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeRows, setIntakeRows] = useState<readonly IntakeConfirmationRow[]>(
    [],
  );
  const [intakeStatus, setIntakeStatus] = useState<string | null>(null);
  const [intakeDocKind, setIntakeDocKind] = useState<IntakeDocumentKind>('FORKLIFT_SPEC_SHEET');
  const [intakeFileName, setIntakeFileName] = useState('Raymond-7500-SpecSheet.pdf');
  const [intakeBase64, setIntakeBase64] = useState('JVBERi0=');

  const [cmdBarOpen, setCmdBarOpen] = useState(false);
  const [cmdBarInput, setCmdBarInput] = useState(
    'Split Run 1 at Bay 4 and widen aisle after Run 1 to 138 inches',
  );
  const [cmdPreview, setCmdPreview] = useState<CommandPreviewCard | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdBarOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openSpecSheetIntake = (): void => {
    const staged = stageIntakeConfirmationTable(
      session.document,
      intakeFileName,
      SAMPLE_FORKLIFT_EXTRACTION,
    );
    setIntakeRows(staged);
    setIntakeStatus(null);
    setIntakeOpen(true);
  };

  const extractViaIntakeEndpoint = async (): Promise<void> => {
    try {
      const res = await fetch('/api/client/v1/intake', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          document_kind: intakeDocKind,
          file_name: intakeFileName,
          mime_type: 'application/pdf',
          data_base64: intakeBase64,
        }),
      });
      const json = (await res.json()) as {
        readonly file_name?: string;
        readonly extraction?: IntakeExtractionPayload;
        readonly error?: { readonly message?: string };
      };
      if (!res.ok || json.extraction === undefined) {
        setIntakeStatus(
          `Intake API refused (${res.status}): ${json.error?.message ?? 'extraction unavailable'}`,
        );
        return;
      }
      const staged = stageIntakeConfirmationTable(
        session.document,
        json.file_name ?? intakeFileName,
        json.extraction,
      );
      setIntakeRows(staged);
      setIntakeStatus(
        `Staged ${staged.length} extracted field(s) from ${json.file_name ?? intakeFileName}.`,
      );
    } catch {
      setIntakeStatus('Spec-sheet extraction request failed.');
    }
  };

  const applyCheckedIntakeRows = (): void => {
    const accepted = intakeRows.filter((r) => r.accepted);
    if (accepted.length === 0) {
      setIntakeStatus('No rows checked. Nothing applied.');
      return;
    }
    if (!isIntakeCurrent(intakeRows, session)) {
      setIntakeStatus(
        'The document changed since intake staging. Intake rows are stale.',
      );
      return;
    }
    const confirmed = applyConfirmedIntakeRows(session, intakeRows);
    if (confirmed.refused) {
      setIntakeStatus(`Refused, nothing applied: ${confirmed.refused}`);
      return;
    }
    const res = runCommands(accepted.map((r) => r.command));
    if (!res.ok) {
      setIntakeStatus(`Refused, nothing applied: ${res.msg}`);
      return;
    }
    // Applied rows leave the table so a second click cannot apply them twice.
    setIntakeRows((prev) => prev.filter((r) => !r.accepted));
    setIntakeStatus(
      `Applied ${accepted.length} confirmed row(s) with source provenance.`,
    );
  };

  const [cmdStatus, setCmdStatus] = useState<string | null>(null);

  const buildCommandPreview = (): void => {
    // DEMO: the Gemini backend is not wired yet, so this canned translation is used
    // regardless of the typed instruction. Replace with runCommandBarInstruction via
    // a server proxy when the backend lands.
    const parsed = parseAndValidateCommandBarOutput(
      JSON.stringify({
        commands: [
          { action: 'splitRun', runIndex: 0, bayIndex: 3 },
          { action: 'setAisleAfter', runIndex: 0, inches: 138 },
        ],
      }),
      session.document,
    );
    if (parsed.ok) {
      setCmdStatus(null);
      setCmdPreview(
        previewCommandSequence(
          session,
          cmdBarInput,
          parsed.commands,
          parsed.descriptions,
        ),
      );
    } else {
      setCmdPreview(null);
      setCmdStatus(`Could not translate: ${parsed.reason}`);
    }
  };

  const executePreviewedCommands = (): void => {
    if (cmdPreview === null) return;
    if (!isPreviewCurrent(cmdPreview, session)) {
      setCmdPreview(null);
      setCmdStatus('The layout changed since this preview. Preview again before executing.');
      return;
    }
    if (cmdPreview.refused.length > 0) {
      setCmdStatus('Preview contains refused commands. Nothing executed.');
      return;
    }
    const res = runCommands(cmdPreview.commands);
    setCmdStatus(
      res.ok
        ? `Executed ${cmdPreview.commands.length} command(s).`
        : `Refused, nothing executed: ${res.msg}`,
    );
    setCmdPreview(null);
  };

  return (
    <section className="plan-view" aria-labelledby="view-heading-plan">
      <h1 id="view-heading-plan" className="visually-hidden">
        Plan
      </h1>
      <p className="scaffold-note">
        <b>Sample layout.</b> This is the rack-studio-v1 sample job, loaded for this session. Every
        change can be undone, but nothing here is saved yet.
      </p>

      <div className="ai-toolbar" role="toolbar" aria-label="AI intake and command tools">
        <button
          id="open-intake-btn"
          type="button"
          className="pf-btn"
          onClick={openSpecSheetIntake}
        >
          Read a spec sheet
        </button>
        <button
          id="open-cmdbar-btn"
          type="button"
          className="pf-btn"
          onClick={() => setCmdBarOpen((prev) => !prev)}
        >
          Commands <kbd>Ctrl+K</kbd>
        </button>
      </div>

      {intakeOpen && (
        <section
          id="intake-panel"
          className="intake-panel"
          aria-label="Spec-Sheet Human Confirmation Table"
        >
          <h2>Confirm what was read from the spec sheet</h2>
          <p>
            Extracted values are <b>never</b> auto-filled. Check the rows you confirm to commit
            them as reversible commands with source page provenance.
          </p>
          <div className="pf-row">
            <label htmlFor="intake-doc-kind" className="pf-label">
              Document Kind
            </label>
            <select
              id="intake-doc-kind"
              className="pf-input"
              value={intakeDocKind}
              onChange={(e) => setIntakeDocKind(e.target.value as IntakeDocumentKind)}
            >
              <option value="FORKLIFT_SPEC_SHEET">Forklift Spec Sheet</option>
              <option value="SITE_SURVEY_CHECKLIST">Site Survey Checklist</option>
              <option value="RACK_SUBMITTAL">Rack Submittal</option>
            </select>
            <label htmlFor="intake-file-name" className="pf-label">
              Source File
            </label>
            <input
              id="intake-file-name"
              type="text"
              className="pf-input"
              value={intakeFileName}
              onChange={(e) => setIntakeFileName(e.target.value)}
            />
            <input
              id="intake-base64"
              type="hidden"
              value={intakeBase64}
              onChange={(e) => setIntakeBase64(e.target.value)}
            />
            <button
              id="extract-intake-api-btn"
              type="button"
              className="pf-btn"
              onClick={() => void extractViaIntakeEndpoint()}
            >
              Extract Dimensions
            </button>
          </div>
          <table id="intake-confirm-table" aria-label="Intake confirmation rows">
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Current Value</th>
                <th scope="col">Extracted Value</th>
                <th scope="col">Source Page / Confidence</th>
                <th scope="col">Accept</th>
              </tr>
            </thead>
            <tbody>
              {intakeRows.map((row) => (
                <tr key={row.id} className={row.lowConfidence ? 'intake-low-confidence' : undefined}>
                  <td>{row.label}</td>
                  <td>{row.currentDisplayValue}</td>
                  <td>{row.extractedDisplayValue}</td>
                  <td>
                    {row.sourceCitation}
                    {row.lowConfidence && <b> (low confidence, verify against source)</b>}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      data-intake-row={row.id}
                      aria-label={`Accept ${row.label}`}
                      checked={row.accepted}
                      onChange={() =>
                        setIntakeRows((prev) =>
                          toggleIntakeRowAcceptance(prev, row.id),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="intake-actions">
            <button
              id="apply-intake-btn"
              type="button"
              className="pf-btn"
              onClick={applyCheckedIntakeRows}
            >
              Apply Checked Rows
            </button>
            <button
              id="close-intake-btn"
              type="button"
              className="pf-btn"
              onClick={() => setIntakeOpen(false)}
            >
              Close Intake
            </button>
          </div>
          {intakeStatus !== null && (
            <p id="intake-status" role="status">
              {intakeStatus}
            </p>
          )}
        </section>
      )}

      {cmdBarOpen && (
        <section
          id="cmdbar-panel"
          className="cmdbar-panel"
          aria-label="Deterministic Command Bar"
        >
          <h2>Commands</h2>
          <div className="pf-row">
            <label htmlFor="cmdbar-input" className="pf-label">
              Instruction
            </label>
            <input
              id="cmdbar-input"
              type="text"
              className="pf-input"
              value={cmdBarInput}
              onChange={(e) => setCmdBarInput(e.target.value)}
            />
            <button
              id="cmdbar-preview-btn"
              type="button"
              className="pf-btn"
              onClick={buildCommandPreview}
            >
              Preview Commands
            </button>
          </div>
          {cmdPreview !== null && (
            <div id="cmdbar-preview-card" className="cmdbar-preview-card">
              <h3>Command Preview Card</h3>
              <ul>
                {cmdPreview.descriptions.map((desc, idx) => (
                  <li key={idx}>{desc}</li>
                ))}
              </ul>
              <p>
                Positions: {cmdPreview.beforePositions} → {cmdPreview.afterPositions} (Δ{' '}
                {cmdPreview.deltaPositions}) · Bays: {cmdPreview.beforeBays} →{' '}
                {cmdPreview.afterBays} · Narrowest Clear Aisle:{' '}
                {cmdPreview.beforeNarrowestAisleIn ?? '—'}&quot; →{' '}
                {cmdPreview.afterNarrowestAisleIn ?? '—'}&quot;
              </p>
              {cmdPreview.refused.length > 0 && (
                <ul id="cmdbar-refused" aria-label="Refused commands">
                  {cmdPreview.refused.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              )}
              <button
                id="cmdbar-execute-btn"
                type="button"
                className="pf-btn"
                disabled={cmdPreview.refused.length > 0}
                onClick={executePreviewedCommands}
              >
                Execute
              </button>
            </div>
          )}
          {cmdStatus !== null && (
            <p id="cmdbar-status" role="status">
              {cmdStatus}
            </p>
          )}
        </section>
      )}

      <div className="plan-layout">
        <ParamsPanel document={session.document} plan={plan} onCommand={runCommand} />
        <PlanCanvas
          document={session.document}
          plan={plan}
          findingCounts={findingCounts}
          onCommand={runCommand}
          onUndo={onUndo}
        />
      </div>

      <ChecksDrawer />
    </section>
  );
}
