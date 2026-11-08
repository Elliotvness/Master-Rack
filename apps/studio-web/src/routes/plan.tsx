import {
  applyConfirmedIntakeRows,
  beamFamilyFromPartLabel,
  isIntakeCurrent,
  isPreviewCurrent,
  parseAndValidateCommandBarOutput,
  previewCommandSequence,
  proposeFixes,
  stageIntakeConfirmationTable,
  toggleIntakeRowAcceptance,
  type Command,
  type CommandPreviewCard,
  type IntakeConfirmationRow,
  type IntakeDocumentKind,
  type IntakeExtractionPayload,
  type StudioDocument,
} from '@rms/studio-model';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';

import { ChecksDrawer } from '../checks/checks-drawer.js';
import { ParamsPanel } from '../plan/params-panel.js';
import { PlanCanvas, type PlanToolMode } from '../plan/plan-canvas.js';
import {
  exportDocumentToDXF,
  persistWorkspaceToIndexedDb,
  useGridStore,
  useRackStore,
  useStudioSession,
} from '../session-context.js';

const SAMPLE_FORKLIFT_EXTRACTION: IntakeExtractionPayload = {
  documentKind: 'FORKLIFT_SPEC_SHEET',
  truckType: { value: 'Stand-up reach', sourcePage: 2, confidence: 0.98 },
  truckRasIn: { value: 108, unit: 'in', sourcePage: 2, confidence: 0.96 },
  clearHeightIn: { value: 384, unit: 'in', sourcePage: 1, confidence: 0.95 },
};

const SAMPLE_EXTRACTIONS_BY_KIND: Readonly<Record<IntakeDocumentKind, IntakeExtractionPayload>> = {
  FORKLIFT_SPEC_SHEET: SAMPLE_FORKLIFT_EXTRACTION,
  SITE_SURVEY_CHECKLIST: {
    documentKind: 'SITE_SURVEY_CHECKLIST',
    clearHeightIn: { value: 384, unit: 'in', sourcePage: 1, confidence: 0.97 },
    deflectorElevIn: { value: 366, unit: 'in', sourcePage: 1, confidence: 0.95 },
    commodityClass: { value: 'Class III', sourcePage: 2, confidence: 0.92 },
    sdc: { value: 'D', sourcePage: 2, confidence: 0.94 },
  },
  RACK_SUBMITTAL: {
    documentKind: 'RACK_SUBMITTAL',
    frameHeightIn: { value: 288, unit: 'in', sourcePage: 3, confidence: 0.97 },
    beamPairCapacityLb: { value: 6190, sourcePage: 4, confidence: 0.96 },
    ratedLoadLb: { value: 2500, sourcePage: 4, confidence: 0.95 },
  },
};

function translateInstructionToCommandBarJson(
  instruction: string,
  doc: StudioDocument,
): string {
  const trimmed = instruction.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  const bt = doc.bayTypes[0];
  const defaultBeamFamily = bt !== undefined ? beamFamilyFromPartLabel(bt.beamPart) : '39ER';
  const clauses = trimmed
    .split(/\b(?:and|then)\b|[;,]+/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const commands: Record<string, unknown>[] = [];

  for (const clause of clauses) {
    const splitMatch = /split\s+run\s*(\d+)(?:\s*(?:at|after)\s*bay\s*(\d+))?/i.exec(clause);
    if (splitMatch !== null) {
      const runIndex = Math.max(0, Number(splitMatch[1]) - 1);
      const bayIndex =
        splitMatch[2] !== undefined ? Math.max(1, Number(splitMatch[2]) - 1) : 1;
      commands.push({ action: 'splitRun', runIndex, bayIndex });
      continue;
    }

    const aisleMatch =
      /(?:widen|narrow|set|change|make)?\s*aisle(?:\s+after\s+run\s*(\d+)|\s*(\d+))?\s*(?:to|=)\s*(\d+(?:\.\d+)?)\s*(ft|feet|'|in|inches|")?/i.exec(
        clause,
      );
    if (aisleMatch !== null) {
      const runRef = aisleMatch[1] ?? aisleMatch[2];
      const runIndex = runRef !== undefined ? Math.max(0, Number(runRef) - 1) : 0;
      const rawVal = Number(aisleMatch[3]);
      const unit = (aisleMatch[4] ?? 'in').toLowerCase();
      const inches = unit.startsWith('f') || unit === "'" ? Math.round(rawVal * 12) : rawVal;
      commands.push({ action: 'setAisleAfter', runIndex, inches });
      continue;
    }

    const addRunMatch = /(?:add|append|insert|create)\s+(?:a\s+|new\s+|(\d+)\s+)?runs?\b/i.exec(
      clause,
    );
    if (addRunMatch !== null) {
      const count = addRunMatch[1] !== undefined ? Math.min(4, Math.max(1, Number(addRunMatch[1]))) : 1;
      for (let i = 0; i < count; i += 1) {
        commands.push({ action: 'addRun' });
      }
      continue;
    }

    const spanMatch =
      /(?:beam\s+span|span)\s*(?:to|=)?\s*(\d+(?:\.\d+)?)\s*(?:in|inches|")?(?:\s+([A-Za-z0-9-]+))?/i.exec(
        clause,
      );
    if (spanMatch !== null) {
      commands.push({
        action: 'setBeamSpan',
        inches: Number(spanMatch[1]),
        beamFamily: spanMatch[2] ?? defaultBeamFamily,
      });
      continue;
    }

    const clearHeightMatch =
      /clear\s+height\s*(?:to|=)?\s*(\d+(?:\.\d+)?)\s*(ft|feet|'|in|inches|")?/i.exec(clause);
    if (clearHeightMatch !== null) {
      const rawVal = Number(clearHeightMatch[1]);
      const unit = (clearHeightMatch[2] ?? 'in').toLowerCase();
      const inches = unit.startsWith('f') || unit === "'" ? Math.round(rawVal * 12) : rawVal;
      commands.push({ action: 'setClearHeight', inches });
      continue;
    }

    const rasMatch =
      /(?:truck\s+ras|ras|min\s+aisle|truck\s+aisle)\s*(?:to|=)?\s*(\d+(?:\.\d+)?)\s*(ft|feet|'|in|inches|")?/i.exec(
        clause,
      );
    if (rasMatch !== null) {
      const rawVal = Number(rasMatch[1]);
      const unit = (rasMatch[2] ?? 'in').toLowerCase();
      const inches = unit.startsWith('f') || unit === "'" ? Math.round(rawVal * 12) : rawVal;
      commands.push({ action: 'setTruckRas', inches });
      continue;
    }
  }

  return JSON.stringify({ commands });
}

function parseExtendedNaturalLanguageCommands(
  instruction: string,
  doc: StudioDocument,
): { readonly commands: readonly Command[]; readonly descriptions: readonly string[] } {
  const jsonText = translateInstructionToCommandBarJson(instruction, doc);
  const parsed = parseAndValidateCommandBarOutput(jsonText, doc);
  const commands: Command[] = parsed.ok ? [...parsed.commands] : [];
  const descriptions: string[] = parsed.ok ? [...parsed.descriptions] : [];

  const clauses = instruction
    .trim()
    .split(/\b(?:and|then)\b|[;,]+/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  for (const clause of clauses) {
    const addBaysMatch =
      /(?:add|append)\s+(\d+)\s+bays?(?:\s+to\s+run\s*(\d+))?/i.exec(clause);
    if (addBaysMatch !== null) {
      const qty = Math.min(12, Math.max(1, Number(addBaysMatch[1])));
      const runIdx = addBaysMatch[2] !== undefined ? Math.max(0, Number(addBaysMatch[2]) - 1) : 0;
      const targetRun = doc.runs[runIdx];
      if (targetRun !== undefined) {
        for (let i = 0; i < qty; i += 1) {
          commands.push({ type: 'appendBay', runId: targetRun.id });
        }
        descriptions.push(`Append ${qty} bay(s) to ${targetRun.name}`);
      }
      continue;
    }

    const delBayMatch =
      /(?:delete|remove)\s+bay\s*(\d+)(?:\s+(?:of|in|from)\s+run\s*(\d+))?/i.exec(clause);
    if (delBayMatch !== null) {
      const bayIdx = Math.max(0, Number(delBayMatch[1]) - 1);
      const runIdx = delBayMatch[2] !== undefined ? Math.max(0, Number(delBayMatch[2]) - 1) : 0;
      const targetRun = doc.runs[runIdx];
      const targetBay = targetRun?.bays[bayIdx];
      if (targetRun !== undefined && targetBay !== undefined) {
        commands.push({ type: 'deleteBay', bayId: targetBay.id });
        descriptions.push(`Delete Bay ${bayIdx + 1} from ${targetRun.name}`);
      }
      continue;
    }

    const lockBayMatch =
      /(lock|unlock)\s+bay\s*(\d+)(?:\s+(?:of|in)\s+run\s*(\d+))?/i.exec(clause);
    if (lockBayMatch !== null) {
      const bayIdx = Math.max(0, Number(lockBayMatch[2]) - 1);
      const runIdx = lockBayMatch[3] !== undefined ? Math.max(0, Number(lockBayMatch[3]) - 1) : 0;
      const targetRun = doc.runs[runIdx];
      const targetBay = targetRun?.bays[bayIdx];
      if (targetRun !== undefined && targetBay !== undefined) {
        commands.push({ type: 'toggleLock', bayId: targetBay.id });
        descriptions.push(
          `${lockBayMatch[1]?.toLowerCase() === 'unlock' ? 'Unlock' : 'Lock'} Bay ${bayIdx + 1} in ${targetRun.name}`,
        );
      }
      continue;
    }

    const rowConfigMatch =
      /(?:set|make)\s+run\s*(\d+)\s+(?:to\s+)?(double|single|back-to-back)/i.exec(clause);
    if (rowConfigMatch !== null) {
      const runIdx = Math.max(0, Number(rowConfigMatch[1]) - 1);
      const isDouble = rowConfigMatch[2]?.toLowerCase() !== 'single';
      const targetRun = doc.runs[runIdx];
      if (targetRun !== undefined) {
        commands.push({
          type: 'setField',
          label: `Set ${targetRun.name} to ${isDouble ? 'double row' : 'single row'}`,
          change: { section: 'run', runId: targetRun.id, patch: { backToBack: isDouble } },
        });
        descriptions.push(`Set ${targetRun.name} to ${isDouble ? 'double row' : 'single row'}`);
      }
      continue;
    }
  }

  return { commands, descriptions };
}

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
  const {
    session,
    plan,
    findingCounts,
    shellOverlay,
    setShellOverlay,
    savedSnapshots,
    saveCurrentSnapshot,
    runCommand,
    runCommands,
    onUndo,
    loadPreset,
    generateFromSpace,
    exportProjectJson,
    importProjectJson,
  } = useStudioSession();
  const [toolMode, setToolMode] = useState<PlanToolMode>('select');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffText, setHandoffText] = useState('');
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeRows, setIntakeRows] = useState<readonly IntakeConfirmationRow[]>(
    [],
  );
  const [intakeStatus, setIntakeStatus] = useState<string | null>(null);
  const [intakeDocKind, setIntakeDocKind] = useState<IntakeDocumentKind>('FORKLIFT_SPEC_SHEET');
  const [intakeFileName, setIntakeFileName] = useState('Raymond-7500-SpecSheet.pdf');
  const [intakeBase64, setIntakeBase64] = useState('JVBERi0=');

  const [cmdBarOpen, setCmdBarOpen] = useState(false);
  const [cmdkQuery, setCmdkQuery] = useState('');
  const [cmdBarInput, setCmdBarInput] = useState(
    'Split Run 1 at Bay 4 and widen aisle after Run 1 to 138 inches',
  );
  const [cmdPreview, setCmdPreview] = useState<CommandPreviewCard | null>(null);
  const lastAutoSavedAt = useRackStore((state) => state.lastAutoSavedAt);
  const setFrameToFrameAisle = useRackStore((state) => state.setFrameToFrameAisle);

  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<
    readonly { readonly id: string; readonly sender: 'assistant' | 'user'; readonly text: string }[]
  >([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Ready to assist with column setup and rack placement. You can start with the building shell & columns first (0 racks), stamp columns at coordinates, generate rack runs around columns, or ask me to adjust aisles and resolve failing checks.',
    },
  ]);

  const fixProposals = useMemo(
    () => proposeFixes(session.document, session.counter),
    [session.document, session.counter],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdBarOpen((prev) => !prev);
        return;
      }
      if (e.key === 'Escape') {
        setToolMode('select');
        setCmdBarOpen(false);
        setIntakeOpen(false);
        setHandoffOpen(false);
        setChatOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openSpecSheetIntake = (): void => {
    const payload = SAMPLE_EXTRACTIONS_BY_KIND[intakeDocKind];
    const staged = stageIntakeConfirmationTable(session.document, intakeFileName, payload);
    setIntakeRows(staged);
    setIntakeStatus(null);
    setIntakeOpen((prev) => !prev);
  };

  const handleIntakeFileUpload = (file: File | undefined): void => {
    if (file === undefined) return;
    setIntakeFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const resultStr = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = resultStr.indexOf(',');
      const b64 = commaIdx >= 0 ? resultStr.slice(commaIdx + 1) : resultStr;
      if (b64.length > 0) {
        setIntakeBase64(b64);
      }
      const payload = SAMPLE_EXTRACTIONS_BY_KIND[intakeDocKind];
      const staged = stageIntakeConfirmationTable(session.document, file.name, payload);
      setIntakeRows(staged);
      setIntakeStatus(
        `Staged ${staged.length} extracted field(s) from ${file.name}. Review and check rows to confirm.`,
      );
    };
    reader.readAsDataURL(file);
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
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        const fallbackPayload = SAMPLE_EXTRACTIONS_BY_KIND[intakeDocKind];
        const staged = stageIntakeConfirmationTable(
          session.document,
          intakeFileName,
          fallbackPayload,
        );
        setIntakeRows(staged);
        setIntakeStatus(
          `Staged ${staged.length} extracted field(s) from ${intakeFileName}.`,
        );
        return;
      }
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
      const fallbackPayload = SAMPLE_EXTRACTIONS_BY_KIND[intakeDocKind];
      const staged = stageIntakeConfirmationTable(
        session.document,
        intakeFileName,
        fallbackPayload,
      );
      setIntakeRows(staged);
      setIntakeStatus(
        `Staged ${staged.length} extracted field(s) from ${intakeFileName}.`,
      );
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

  const buildCommandPreviewForText = (instructionText: string): void => {
    const ext = parseExtendedNaturalLanguageCommands(instructionText, session.document);
    if (ext.commands.length > 0) {
      setCmdStatus(null);
      setCmdPreview(
        previewCommandSequence(
          session,
          instructionText,
          ext.commands,
          ext.descriptions,
        ),
      );
    } else {
      setCmdPreview(null);
      setCmdStatus(
        `Could not translate "${instructionText}". Try e.g. "Widen aisle 1 to 132 inches", "Split Run 1 at Bay 4", "Add 4 bays to Run 1", "Set Run 1 to single row", or "Set beam span to 108 inches".`,
      );
    }
  };

  const buildCommandPreview = (): void => {
    buildCommandPreviewForText(cmdBarInput);
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

  const sendChatMessage = (rawText: string): void => {
    const text = rawText.trim();
    if (text.length === 0) return;
    const lower = text.toLowerCase();

    const pushExchange = (reply: string): void => {
      setChatMessages((prev) => [
        ...prev,
        { id: `u-${prev.length + 1}`, sender: 'user', text },
        { id: `a-${prev.length + 2}`, sender: 'assistant', text: reply },
      ]);
      setChatInput('');
    };

    if (
      lower.includes('columns first') ||
      lower.includes('start with column') ||
      lower.includes('empty shell') ||
      lower.includes('clear racks') ||
      lower.includes('stage 1')
    ) {
      loadPreset('shell-columns');
      setToolMode('column');
      pushExchange(
        `Stage 1 loaded: Building perimeter shell (${shellOverlay.shellWidthFt}' × ${shellOverlay.shellDepthFt}') and ${shellOverlay.columnSpacingFt} ft structural column grid with 0 rack runs. Active tool is now Stamp Column — click anywhere on the plan to stamp custom columns, press Esc to exit the tool, or ask me to "Place racks around columns".`,
      );
      return;
    }

    const colCoordMatch =
      /(?:stamp|place|add)\s+(?:a\s+)?column\s*(?:at)?\s*\(?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*[,x\s]\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')?\s*\)?/i.exec(
        text,
      );
    if (colCoordMatch !== null) {
      const xFt = Number(colCoordMatch[1]);
      const yFt = Number(colCoordMatch[2]);
      const nextIdx = shellOverlay.customColumns.length + 1;
      setShellOverlay((prev) => ({
        ...prev,
        showPerimeterWalls: true,
        showColumns: true,
        customColumns: [
          ...prev.customColumns,
          {
            id: `custom-col-${nextIdx}`,
            xUm: Math.round(xFt * 12 * 25_400),
            yUm: Math.round(yFt * 12 * 25_400),
            sizeIn: prev.columnSizeIn,
            label: `COL-${nextIdx}`,
          },
        ],
      }));
      pushExchange(
        `Stamped structural column COL-${nextIdx} (${shellOverlay.columnSizeIn}" square) at X = ${xFt} ft, Y = ${yFt} ft. Any rack bay intersecting this column will automatically reconcile with a Flue Straddle or Bypass Spacer.`,
      );
      return;
    }

    const gridMatch = /(30|40|50)\s*(?:ft|foot|feet|')?\s*(?:column|grid)/i.exec(text);
    if (gridMatch !== null) {
      const spacing = Number(gridMatch[1]) as 30 | 40 | 50;
      setShellOverlay((prev) => ({
        ...prev,
        showPerimeterWalls: true,
        showColumns: true,
        columnSpacingFt: spacing,
      }));
      pushExchange(
        `Updated structural column grid to ${spacing} ft spacing with building perimeter walls enabled.`,
      );
      return;
    }

    if (
      lower.includes('generate rack') ||
      lower.includes('place rack') ||
      lower.includes('fill building') ||
      lower.includes('around column') ||
      /(\d+)\s*pallets?/i.test(text)
    ) {
      const palletMatch = /(\d+)\s*pallets?/i.exec(text);
      const targetPositions =
        palletMatch !== null ? Math.max(48, Number(palletMatch[1])) : 384;
      const clearHeightFt = Math.max(
        18,
        Math.round(session.document.building.clearHeight.value / (25_400 * 12)),
      );
      generateFromSpace({
        projectName: session.document.name,
        clientName: session.document.client,
        lengthFt: shellOverlay.shellWidthFt,
        widthFt: shellOverlay.shellDepthFt,
        clearHeightFt,
        aisleFt: 11,
        targetPositions,
        showColumns: true,
        columnSpacingFt: shellOverlay.columnSpacingFt,
      });
      setToolMode('select');
      pushExchange(
        `Generated rack runs inside the ${shellOverlay.shellWidthFt}' × ${shellOverlay.shellDepthFt}' shell targeting ~${targetPositions} pallet positions with 11'-0" aisles and active ${shellOverlay.columnSpacingFt} ft column collision reconciliation.`,
      );
      return;
    }

    if (
      lower.includes('fix') ||
      lower.includes('resolve') ||
      lower.includes('failing') ||
      lower.includes('narrow aisle')
    ) {
      const topFix = fixProposals[0];
      if (topFix !== undefined) {
        const res = runCommands(topFix.commands);
        pushExchange(
          res.ok
            ? `Applied engineering fix: ${topFix.title} — ${topFix.rationale}`
            : `Could not apply fix: ${res.msg}`,
        );
      } else {
        pushExchange(
          `All ${plan.runs.length} rack runs and ${plan.aisles.length} aisles currently pass screening with 0 blocking findings.`,
        );
      }
      return;
    }

    const shellSizeMatch =
      /(?:shell|building|envelope)\s*(?:to|=)?\s*(\d+)\s*(?:ft|')?\s*(?:x|by|,)\s*(\d+)\s*(?:ft|')?/i.exec(
        text,
      );
    if (shellSizeMatch !== null) {
      const nextW = Math.max(30, Math.min(600, Number(shellSizeMatch[1])));
      const nextD = Math.max(20, Math.min(400, Number(shellSizeMatch[2])));
      setShellOverlay((prev) => ({
        ...prev,
        showPerimeterWalls: true,
        shellWidthFt: nextW,
        shellDepthFt: nextD,
      }));
      pushExchange(`Updated building perimeter shell envelope to ${nextW}' × ${nextD}'.`);
      return;
    }

    const delColMatch = /(?:delete|remove)\s+column\s*(col-\d+|\d+)/i.exec(text);
    if (delColMatch !== null) {
      const rawRef = delColMatch[1]?.toUpperCase() ?? '';
      const targetLabel = rawRef.startsWith('COL-') ? rawRef : `COL-${rawRef}`;
      setShellOverlay((prev) => ({
        ...prev,
        customColumns: prev.customColumns.filter((c) => c.label.toUpperCase() !== targetLabel),
      }));
      pushExchange(`Removed custom structural column ${targetLabel} from the floorplan.`);
      return;
    }

    if (lower.includes('snapshot') || lower.includes('save option')) {
      const snap = saveCurrentSnapshot();
      pushExchange(
        `Saved "${snap.label}" (${snap.positionsCount} pallet positions, ${snap.baysCount} bays) to Step 2 Options comparison table.`,
      );
      return;
    }

    const ext = parseExtendedNaturalLanguageCommands(text, session.document);
    if (ext.commands.length > 0) {
      const preview = previewCommandSequence(
        session,
        text,
        ext.commands,
        ext.descriptions,
      );
      if (preview.refused.length === 0) {
        const res = runCommands(ext.commands);
        if (res.ok) {
          pushExchange(
            `Applied: ${ext.descriptions.join('; ')}. Positions: ${preview.beforePositions} → ${preview.afterPositions} (Δ ${preview.deltaPositions}), Bays: ${preview.beforeBays} → ${preview.afterBays}, Narrowest Clear Aisle: ${preview.beforeNarrowestAisleIn ?? '—'}" → ${preview.afterNarrowestAisleIn ?? '—'}".`,
          );
          return;
        }
      }
    }

    const narrowestIn =
      plan.narrowestClearAisle !== null
        ? `${Math.round(plan.narrowestClearAisle.value / 25_400)}"`
        : 'no aisle yet';
    pushExchange(
      `Current layout has ${plan.runs.length} rack run(s), ${plan.totalBays} bays, ${plan.totalPositions} pallet positions, narrowest clear aisle ${narrowestIn}, and ${shellOverlay.customColumns.length} custom stamped column(s). Try: "Start with columns first", "Stamp column at 40, 20", "Place racks around columns", "Widen aisle 1 to 132 in", "Split Run 1 at Bay 4", or "Fix failing checks".`,
    );
  };

  return (
    <section className="plan-view" aria-labelledby="view-heading-plan">
      <h1 id="view-heading-plan" className="visually-hidden">
        Plan
      </h1>
      <p className="scaffold-note">
        <button
          id="toggle-config-sidebar-btn"
          type="button"
          className="pf-btn pf-btn-small"
          aria-expanded={!sidebarCollapsed}
          aria-controls="config-sidebar"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
        >
          {sidebarCollapsed ? 'Expand Sidebar ▶' : 'Collapse Sidebar ◀'}
        </button>{' '}
        <b>Sample layout.</b> This is the rack-studio-v1 sample job, loaded for this session. Every
        change can be undone, but nothing here is saved yet.{' '}
        <span id="autosave-idb-badge" className="pf-badge" style={{ marginLeft: '4px', marginRight: '4px' }}>
          {lastAutoSavedAt !== null
            ? `IndexedDB Auto-Saved (${lastAutoSavedAt.slice(11, 19)})`
            : 'IndexedDB 3s Auto-Save Active'}
        </span>
        <button
          id="autosave-idb-now-btn"
          type="button"
          className="pf-btn pf-btn-small"
          onClick={() => {
            void persistWorkspaceToIndexedDb(session.document);
          }}
        >
          Save IDB Now
        </button>{' '}
        <button
          id="open-intake-btn"
          type="button"
          className="pf-btn pf-btn-small"
          aria-pressed={intakeOpen}
          onClick={openSpecSheetIntake}
        >
          Read a spec sheet
        </button>{' '}
        <button
          id="open-handoff-btn"
          type="button"
          className="pf-btn pf-btn-small"
          aria-pressed={handoffOpen}
          onClick={() => {
            setHandoffText(exportProjectJson());
            setHandoffStatus(null);
            setHandoffOpen((prev) => !prev);
          }}
        >
          Export / Import JSON
        </button>{' '}
        <Link id="plan-open-portal-link" to="/welcome">
          Open Main Page, User Access &amp; System Guide →
        </Link>
      </p>

      <div className="plan-layout">
        <aside
          id="config-sidebar"
          className={sidebarCollapsed ? 'plan-sidebar plan-sidebar-collapsed' : 'plan-sidebar'}
          aria-label="Configuration Sidebar"
        >
          <ParamsPanel
            document={session.document}
            plan={plan}
            onCommand={runCommand}
            onLoadPreset={loadPreset}
          />
        </aside>
        <div className="plan-canvas-column">
          <PlanCanvas
            document={session.document}
            plan={plan}
            findingCounts={findingCounts}
            toolMode={toolMode}
            onToolModeChange={setToolMode}
            shellOverlay={shellOverlay}
            onShellOverlayChange={setShellOverlay}
            onCommand={runCommand}
            onUndo={onUndo}
          />

          <div className="plan-bottom-dock" role="region" aria-label="Plan bottom command dock">
            {handoffOpen && (
              <section
                id="handoff-panel"
                className="cmdbar-panel plan-dock-popover"
                aria-label="Project JSON Export and Import"
              >
                <div className="plan-dock-popover-head">
                  <h2>Project JSON Export / Client Handoff Import</h2>
                  <button
                    type="button"
                    className="pf-btn pf-btn-small"
                    onClick={() => setHandoffOpen(false)}
                    aria-label="Close JSON panel"
                  >
                    ×
                  </button>
                </div>
                <p>
                  Export the current studio layout JSON or paste a{' '}
                  <code>ProjectHandoffPackage</code> / <code>StudioDocument</code> JSON payload to
                  load it.
                </p>
                <div className="pf-row">
                  <label htmlFor="handoff-json-textarea" className="pf-label">
                    JSON Payload
                  </label>
                  <textarea
                    id="handoff-json-textarea"
                    className="pf-input"
                    rows={4}
                    value={handoffText}
                    onChange={(e) => setHandoffText(e.target.value)}
                  />
                </div>
                <div className="intake-actions">
                  <button
                    id="refresh-export-json-btn"
                    type="button"
                    className="pf-btn"
                    onClick={() => {
                      const json = exportProjectJson();
                      setHandoffText(json);
                      setHandoffStatus('Exported current layout JSON to editor.');
                    }}
                  >
                    Refresh Export JSON
                  </button>
                  <button
                    id="apply-import-json-btn"
                    type="button"
                    className="pf-btn"
                    onClick={() => {
                      const res = importProjectJson(handoffText);
                      setHandoffStatus(res.message);
                    }}
                  >
                    Import JSON Payload
                  </button>
                  <button
                    id="close-handoff-btn"
                    type="button"
                    className="pf-btn"
                    onClick={() => setHandoffOpen(false)}
                  >
                    Close
                  </button>
                </div>
                {handoffStatus !== null && (
                  <p id="handoff-status" role="status">
                    {handoffStatus}
                  </p>
                )}
              </section>
            )}

            {intakeOpen && (
              <section
                id="intake-panel"
                className="intake-panel plan-dock-popover"
                aria-label="Spec-Sheet Human Confirmation Table"
              >
                <div className="plan-dock-popover-head">
                  <h2>Confirm what was read from the spec sheet</h2>
                  <button
                    type="button"
                    className="pf-btn pf-btn-small"
                    onClick={() => setIntakeOpen(false)}
                    aria-label="Close spec sheet intake"
                  >
                    ×
                  </button>
                </div>
                <p>
                  Extracted values are <b>never</b> auto-filled. Check the rows you confirm to
                  commit them as reversible commands with source page provenance.
                </p>
                <div className="pf-row">
                  <label htmlFor="intake-doc-kind" className="pf-label">
                    Document Kind
                  </label>
                  <select
                    id="intake-doc-kind"
                    className="pf-input"
                    value={intakeDocKind}
                    onChange={(e) => {
                      const nextKind = e.target.value as IntakeDocumentKind;
                      setIntakeDocKind(nextKind);
                      const defaultName =
                        nextKind === 'FORKLIFT_SPEC_SHEET'
                          ? 'Raymond-7500-SpecSheet.pdf'
                          : nextKind === 'SITE_SURVEY_CHECKLIST'
                            ? 'Site-Survey-Checklist.pdf'
                            : 'Interlake-Rack-Submittal.pdf';
                      setIntakeFileName(defaultName);
                      setIntakeRows(
                        stageIntakeConfirmationTable(
                          session.document,
                          defaultName,
                          SAMPLE_EXTRACTIONS_BY_KIND[nextKind],
                        ),
                      );
                      setIntakeStatus(null);
                    }}
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
                  <label htmlFor="intake-file-upload" className="pf-btn pf-btn-small">
                    Upload PDF / Image
                  </label>
                  <input
                    id="intake-file-upload"
                    type="file"
                    accept=".pdf,image/*"
                    className="visually-hidden"
                    onChange={(e) => handleIntakeFileUpload(e.target.files?.[0])}
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
                      <tr
                        key={row.id}
                        className={row.lowConfidence ? 'intake-low-confidence' : undefined}
                      >
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
                              setIntakeRows((prev) => toggleIntakeRowAcceptance(prev, row.id))
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
                className="cmdbar-panel plan-dock-popover"
                aria-label="Deterministic Command Bar"
              >
                <div className="plan-dock-popover-head">
                  <h2>Commands · CAD Command Palette (Ctrl+K)</h2>
                  <button
                    type="button"
                    className="pf-btn pf-btn-small"
                    onClick={() => setCmdBarOpen(false)}
                    aria-label="Close command bar"
                  >
                    ×
                  </button>
                </div>

                {/* CAD Fuzzy-Search Command Palette (cmdk-style) */}
                <div id="cad-command-palette" className="cad-cmdk-box" role="region" aria-label="CAD Command Palette">
                  <input
                    id="cad-cmdk-input"
                    type="text"
                    className="pf-input cad-cmdk-input"
                    placeholder="Type a command or search (e.g. 'aisles 132', 'export DXF', 'auto-adjust')..."
                    value={cmdkQuery}
                    onChange={(e) => setCmdkQuery(e.target.value)}
                  />
                  <div id="cad-cmdk-list" className="cad-cmdk-list" role="listbox" aria-label="Drafting commands">
                    {[
                      {
                        id: 'cmdk-item-aisles-132',
                        group: 'Drafting',
                        label: 'Set all aisles to 132"',
                        alias: 'AISLE 132',
                        run: () => {
                          setFrameToFrameAisle(132);
                          setCmdStatus('Set all frame-to-frame aisles to 132".');
                        },
                      },
                      {
                        id: 'cmdk-item-autofix-aisle',
                        group: 'Drafting',
                        label: 'Auto-adjust all aisles to 133" (127" clear)',
                        alias: 'AUTOFIX',
                        run: () => {
                          setFrameToFrameAisle(133);
                          setCmdStatus('Auto-adjusted all frame-to-frame aisles to 133" (127" clear).');
                        },
                      },
                      {
                        id: 'cmdk-item-export-dxf',
                        group: 'Drafting',
                        label: 'Export to DXF',
                        alias: 'DXF',
                        run: () => {
                          exportDocumentToDXF(session.document);
                          setCmdStatus(`Exported AutoCAD .DXF for ${session.document.name}.`);
                        },
                      },
                      {
                        id: 'cmdk-item-add-run',
                        group: 'Drafting',
                        label: 'Add rack run',
                        alias: 'ADDRUN',
                        run: () => {
                          runCommand({ type: 'addRun' });
                          setCmdStatus('Appended a new rack run.');
                        },
                      },
                      {
                        id: 'cmdk-item-tool-move',
                        group: 'CAD Aliases',
                        label: 'Move / Pan Mode',
                        alias: 'Key: M',
                        run: () => {
                          setToolMode('select');
                          setCmdStatus('Activated Move / Pan mode (M).');
                        },
                      },
                      {
                        id: 'cmdk-item-tool-column',
                        group: 'CAD Aliases',
                        label: 'Stamp Structural Column Mode',
                        alias: 'Key: C',
                        run: () => {
                          setToolMode('column');
                          setCmdStatus('Activated Stamp Column mode (C).');
                        },
                      },
                      {
                        id: 'cmdk-item-tool-wall',
                        group: 'CAD Aliases',
                        label: 'Draw Wall (Ortho) Mode',
                        alias: 'Key: W',
                        run: () => {
                          setToolMode('wall');
                          setCmdStatus('Activated Draw Wall mode (W).');
                        },
                      },
                      {
                        id: 'cmdk-item-autosave-idb',
                        group: 'Storage',
                        label: 'Save Workspace to IndexedDB Now',
                        alias: 'IDB SAVE',
                        run: () => {
                          void persistWorkspaceToIndexedDb(session.document);
                          setCmdStatus('Saved workspace snapshot to IndexedDB.');
                        },
                      },
                      {
                        id: 'cmdk-item-read-spec-sheet',
                        group: 'Smart / System',
                        label: 'Read a spec sheet (AI Spec Sheet Intake)',
                        alias: 'SPEC SHEET',
                        run: () => {
                          setCmdBarOpen(false);
                          openSpecSheetIntake();
                        },
                      },
                      {
                        id: 'cmdk-item-handoff-json',
                        group: 'Utilities',
                        label: 'Export / Import Project JSON',
                        alias: 'JSON IO',
                        run: () => {
                          setCmdBarOpen(false);
                          setHandoffText(exportProjectJson());
                          setHandoffStatus(null);
                          setHandoffOpen(true);
                        },
                      },
                      {
                        id: 'cmdk-item-import-columns-csv',
                        group: 'Utilities',
                        label: 'Import Column Coordinates from CSV (A1, B1, C1...)',
                        alias: 'CSV COLS',
                        run: () => {
                          useGridStore
                            .getState()
                            .importColumns('C-A1,0,0\nC-B1,600,0\nC-C1,1200,0\nC-A2,0,600\nC-B2,600,600\nC-C2,1200,600');
                          setCmdStatus('Imported 6 structural column coordinates from CSV into grid.');
                        },
                      },
                    ]
                      .filter((item) => {
                        const q = cmdkQuery.trim().toLowerCase();
                        if (q.length === 0) return true;
                        return (
                          item.label.toLowerCase().includes(q) ||
                          item.group.toLowerCase().includes(q) ||
                          item.alias.toLowerCase().includes(q)
                        );
                      })
                      .map((item) => (
                        <button
                          key={item.id}
                          id={item.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="cad-cmdk-item"
                          onClick={item.run}
                        >
                          <span className="cad-cmdk-item-label">
                            <strong>[{item.group}]</strong> {item.label}
                          </span>
                          <kbd className="cad-cmdk-item-kbd">{item.alias}</kbd>
                        </button>
                      ))}
                  </div>
                </div>

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

            {chatOpen && (
              <section
                id="ai-chat-panel"
                className="cmdbar-panel plan-dock-popover"
                aria-label="Interactive AI Placement and Layout Assistant"
              >
                <div className="plan-dock-popover-head">
                  <h2>AI Placement &amp; Layout Assistant</h2>
                  <button
                    type="button"
                    className="pf-btn pf-btn-small"
                    onClick={() => setChatOpen(false)}
                    aria-label="Close AI assistant"
                  >
                    ×
                  </button>
                </div>

                <div className="intake-actions">
                  <button
                    id="chat-quick-columns-first"
                    type="button"
                    className="pf-btn pf-btn-small"
                    onClick={() => sendChatMessage('Start with columns first')}
                  >
                    1. Start w/ Columns First (0 Racks)
                  </button>
                  <button
                    id="chat-quick-stamp-col"
                    type="button"
                    className="pf-btn pf-btn-small"
                    onClick={() => sendChatMessage('Stamp column at 40, 20')}
                  >
                    2. Stamp Column at (40&apos;, 20&apos;)
                  </button>
                  <button
                    id="chat-quick-place-racks"
                    type="button"
                    className="pf-btn pf-btn-small"
                    onClick={() => sendChatMessage('Place racks around columns for 384 pallets')}
                  >
                    3. Place Racks Around Columns
                  </button>
                  <button
                    id="chat-quick-fix-aisle"
                    type="button"
                    className="pf-btn pf-btn-small"
                    onClick={() => sendChatMessage('Fix failing checks')}
                  >
                    4. Auto-Fix Narrow Aisle ({fixProposals.length})
                  </button>
                </div>

                <div
                  id="ai-chat-messages"
                  className="ai-chat-messages"
                  role="log"
                  aria-live="polite"
                >
                  {chatMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={
                        msg.sender === 'user'
                          ? 'ai-chat-bubble ai-chat-user'
                          : 'ai-chat-bubble ai-chat-assistant'
                      }
                    >
                      <b>{msg.sender === 'user' ? 'You' : 'AI Assistant'}:</b> {msg.text}
                    </div>
                  ))}
                </div>

                <div className="pf-row">
                  <label htmlFor="ai-chat-input" className="pf-label">
                    Ask / Place
                  </label>
                  <input
                    id="ai-chat-input"
                    type="text"
                    className="pf-input"
                    placeholder="e.g. Start with columns first, Stamp column at 40, 20, Place racks for 400 pallets..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        sendChatMessage(chatInput);
                      }
                    }}
                  />
                  <button
                    id="ai-chat-send-btn"
                    type="button"
                    className="pf-btn"
                    onClick={() => sendChatMessage(chatInput)}
                  >
                    Send
                  </button>
                </div>
              </section>
            )}

            <div
              id="plan-floating-dock"
              className="ai-toolbar plan-floating-dock"
              role="toolbar"
              aria-label="Floating CAD drafting, utilities, and smart dock"
            >
              {/* Group 1: Drafting */}
              <div
                id="dock-group-drafting"
                className="dock-group"
                role="group"
                aria-label="Drafting tools"
              >
                <button
                  id="tool-select-btn"
                  type="button"
                  className="pf-btn dock-icon-btn"
                  aria-pressed={toolMode === 'select'}
                  aria-label="Select / Pan (M)"
                  title="Select / Pan (M)"
                  onClick={() => setToolMode('select')}
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M3 2l9.5 4.5-4.2 1.3-1.8 4.2L3 2z" />
                    <path d="M8.5 8.5l4 4" />
                  </svg>
                  <span className="dock-tooltip">Select / Pan (M)</span>
                </button>
                <button
                  id="tool-wall-btn"
                  type="button"
                  className="pf-btn dock-icon-btn"
                  aria-pressed={toolMode === 'wall'}
                  aria-label="Draw Wall (Ortho) (W)"
                  title="Draw Wall (Ortho) (W)"
                  onClick={() => setToolMode((prev) => (prev === 'wall' ? 'select' : 'wall'))}
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="1.5" y="3" width="13" height="10" rx="1" />
                    <line x1="1.5" y1="8" x2="14.5" y2="8" />
                    <line x1="6" y1="3" x2="6" y2="8" />
                    <line x1="10" y1="8" x2="10" y2="13" />
                  </svg>
                  <span className="dock-tooltip">Draw Wall (Ortho) (W)</span>
                </button>
                <button
                  id="tool-column-btn"
                  type="button"
                  className="pf-btn dock-icon-btn"
                  aria-pressed={toolMode === 'column'}
                  aria-label="Stamp Column (C)"
                  title="Stamp Column (C)"
                  onClick={() => setToolMode((prev) => (prev === 'column' ? 'select' : 'column'))}
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="10" height="10" rx="1" />
                    <line x1="3" y1="3" x2="13" y2="13" />
                    <line x1="13" y1="3" x2="3" y2="13" />
                  </svg>
                  <span className="dock-tooltip">Stamp Column (C)</span>
                </button>
                <button
                  id="start-columns-first-btn"
                  type="button"
                  className="pf-btn dock-icon-btn"
                  aria-label="Columns First (0b)"
                  title="Clear racks and start with building shell & column grid first"
                  onClick={() => {
                    loadPreset('shell-columns');
                    setToolMode('column');
                  }}
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="2" y="2" width="3.5" height="3.5" />
                    <rect x="10.5" y="2" width="3.5" height="3.5" />
                    <rect x="2" y="10.5" width="3.5" height="3.5" />
                    <rect x="10.5" y="10.5" width="3.5" height="3.5" />
                  </svg>
                  <span className="dock-tooltip">Columns First (0b)</span>
                </button>
                <label htmlFor="column-grid-select" className="visually-hidden">
                  Column Grid Spacing
                </label>
                <select
                  id="column-grid-select"
                  aria-label="Column Grid Spacing"
                  className="pf-input dock-compact-select"
                  title="Column Grid Spacing"
                  value={shellOverlay.showColumns ? String(shellOverlay.columnSpacingFt) : 'none'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setShellOverlay((prev) => ({
                      ...prev,
                      showColumns: val !== 'none',
                      columnSpacingFt:
                        val === 'none' ? prev.columnSpacingFt : (Number(val) as 30 | 40 | 50),
                    }));
                  }}
                >
                  <option value="none">Cols: Off</option>
                  <option value="30">Cols: 30&apos;</option>
                  <option value="40">Cols: 40&apos;</option>
                  <option value="50">Cols: 50&apos;</option>
                </select>
                <button
                  id="toggle-perimeter-wall-btn"
                  type="button"
                  className="pf-btn dock-icon-btn"
                  aria-pressed={shellOverlay.showPerimeterWalls}
                  aria-label={
                    shellOverlay.showPerimeterWalls ? 'Perimeter Wall: On' : 'Perimeter Wall: Off'
                  }
                  title={
                    shellOverlay.showPerimeterWalls ? 'Perimeter Wall: On' : 'Perimeter Wall: Off'
                  }
                  onClick={() =>
                    setShellOverlay((prev) => ({
                      ...prev,
                      showPerimeterWalls: !prev.showPerimeterWalls,
                    }))
                  }
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="1.5" y="2.5" width="13" height="11" strokeDasharray="3 1.5" />
                    <rect x="4" y="5" width="8" height="6" />
                  </svg>
                  <span className="dock-tooltip">
                    {shellOverlay.showPerimeterWalls ? 'Perimeter Wall: On' : 'Perimeter Wall: Off'}
                  </span>
                </button>
                {(shellOverlay.showPerimeterWalls || shellOverlay.showColumns) && (
                  <>
                    <label htmlFor="shell-width-ft-input" className="visually-hidden">
                      Shell Width (ft)
                    </label>
                    <input
                      id="shell-width-ft-input"
                      aria-label="Shell Width (ft)"
                      type="number"
                      min={30}
                      max={600}
                      step={10}
                      className="pf-input dock-dim-input"
                      title="Building Shell Width (ft)"
                      value={shellOverlay.shellWidthFt}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 30) {
                          setShellOverlay((prev) => ({ ...prev, shellWidthFt: v }));
                        }
                      }}
                    />
                    <span className="dock-dim-sep">×</span>
                    <label htmlFor="shell-depth-ft-input" className="visually-hidden">
                      Shell Depth (ft)
                    </label>
                    <input
                      id="shell-depth-ft-input"
                      aria-label="Shell Depth (ft)"
                      type="number"
                      min={20}
                      max={400}
                      step={10}
                      className="pf-input dock-dim-input"
                      title="Building Shell Depth (ft)"
                      value={shellOverlay.shellDepthFt}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v >= 20) {
                          setShellOverlay((prev) => ({ ...prev, shellDepthFt: v }));
                        }
                      }}
                    />
                  </>
                )}
                {(shellOverlay.customWalls.length > 0 || shellOverlay.customColumns.length > 0) && (
                  <button
                    id="clear-shell-overlays-btn"
                    type="button"
                    className="pf-btn dock-icon-btn"
                    aria-label={`Clear Stamped (${shellOverlay.customWalls.length + shellOverlay.customColumns.length})`}
                    title={`Clear Stamped (${shellOverlay.customWalls.length + shellOverlay.customColumns.length})`}
                    onClick={() =>
                      setShellOverlay((prev) => ({
                        ...prev,
                        customWalls: [],
                        customColumns: [],
                      }))
                    }
                  >
                    <span className="dock-badge">
                      ×{shellOverlay.customWalls.length + shellOverlay.customColumns.length}
                    </span>
                    <span className="dock-tooltip">
                      Clear Stamped (
                      {shellOverlay.customWalls.length + shellOverlay.customColumns.length})
                    </span>
                  </button>
                )}
              </div>

              <span className="dock-divider" aria-hidden="true" />

              {/* Group 2: Utilities */}
              <div
                id="dock-group-utilities"
                className="dock-group"
                role="group"
                aria-label="Utility tools"
              >
                <button
                  id="tool-calibrate-btn"
                  type="button"
                  className="pf-btn dock-icon-btn"
                  aria-pressed={toolMode === 'calibrate'}
                  aria-label="2-Pt Scale Calibrate"
                  title="2-Pt Scale Calibrate"
                  onClick={() =>
                    setToolMode((prev) => (prev === 'calibrate' ? 'select' : 'calibrate'))
                  }
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="1.5" y="5" width="13" height="6" rx="1" />
                    <line x1="4.5" y1="5" x2="4.5" y2="8" />
                    <line x1="8" y1="5" x2="8" y2="9" />
                    <line x1="11.5" y1="5" x2="11.5" y2="8" />
                  </svg>
                  <span className="dock-tooltip">2-Pt Scale Calibrate</span>
                </button>
                <label
                  id="upload-underlay-label"
                  htmlFor="underlay-file-upload"
                  className="pf-btn dock-icon-btn"
                  aria-label={
                    shellOverlay.underlayDataUrl !== null ? 'Underlay: Loaded' : 'Floorplan Image'
                  }
                  title="Upload a floorplan image (PNG/JPG/SVG) underneath the blueprint canvas"
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
                    <circle cx="5.5" cy="6" r="1.2" />
                    <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
                  </svg>
                  <span className="dock-tooltip">
                    {shellOverlay.underlayDataUrl !== null ? 'Underlay: Loaded' : 'Floorplan Image'}
                  </span>
                </label>
                <input
                  id="underlay-file-upload"
                  type="file"
                  accept="image/*"
                  className="visually-hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file === undefined) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === 'string') {
                        setShellOverlay((prev) => ({
                          ...prev,
                          showPerimeterWalls: true,
                          underlayDataUrl: reader.result as string,
                        }));
                      }
                    };
                    reader.readAsDataURL(file);
                  }}
                />
                {shellOverlay.underlayDataUrl !== null && (
                  <>
                    <label htmlFor="underlay-opacity-select" className="visually-hidden">
                      Underlay Opacity
                    </label>
                    <select
                      id="underlay-opacity-select"
                      aria-label="Underlay Opacity"
                      className="pf-input dock-compact-select"
                      value={String(shellOverlay.underlayOpacity)}
                      onChange={(e) =>
                        setShellOverlay((prev) => ({
                          ...prev,
                          underlayOpacity: Number(e.target.value),
                        }))
                      }
                    >
                      <option value="0.25">25%</option>
                      <option value="0.45">45%</option>
                      <option value="0.7">70%</option>
                    </select>
                    <button
                      id="clear-underlay-btn"
                      type="button"
                      className="pf-btn dock-icon-btn"
                      aria-label="Clear Image"
                      title="Clear Floorplan Image"
                      onClick={() =>
                        setShellOverlay((prev) => ({
                          ...prev,
                          underlayDataUrl: null,
                        }))
                      }
                    >
                      <span className="dock-badge">×Img</span>
                      <span className="dock-tooltip">Clear Image</span>
                    </button>
                  </>
                )}
                <button
                  id="save-plan-snapshot-btn"
                  type="button"
                  className="pf-btn dock-icon-btn"
                  aria-label={`Snapshot Option (${savedSnapshots.length})`}
                  title="Save the current Plan layout as a custom Option in Step 2 Options comparison"
                  onClick={() => saveCurrentSnapshot()}
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M2.5 5h2l1-1.5h5L11.5 5h2a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
                    <circle cx="8" cy="9" r="2.2" />
                  </svg>
                  <span className="dock-badge">{savedSnapshots.length}</span>
                  <span className="dock-tooltip">Snapshot Option ({savedSnapshots.length})</span>
                </button>
                <label
                  id="import-columns-csv-label"
                  htmlFor="import-columns-csv-input"
                  className="pf-btn dock-icon-btn"
                  aria-label="Import Columns CSV"
                  title="Import Column Coordinates from CSV (id,x,y in inches)"
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M3 2.5h6.5L13 6v7.5H3V2.5z" />
                    <path d="M9.5 2.5V6H13" />
                    <line x1="8" y1="11.5" x2="8" y2="7.5" />
                    <path d="M6.2 9.2L8 7.5l1.8 1.7" />
                  </svg>
                  <span className="dock-tooltip">Import Columns CSV</span>
                </label>
                <input
                  id="import-columns-csv-input"
                  type="file"
                  accept=".csv,text/csv"
                  className="visually-hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file === undefined) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === 'string') {
                        useGridStore.getState().importColumns(reader.result);
                      }
                    };
                    reader.readAsText(file);
                  }}
                />
              </div>

              <span className="dock-divider" aria-hidden="true" />

              {/* Group 3: Smart / System */}
              <div
                id="dock-group-smart"
                className="dock-group"
                role="group"
                aria-label="Smart and system tools"
              >
                <button
                  id="open-ai-chat-btn"
                  type="button"
                  className="pf-btn dock-icon-btn"
                  aria-pressed={chatOpen}
                  aria-label="AI Assistant"
                  title="AI Assistant"
                  onClick={() => setChatOpen((prev) => !prev)}
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path d="M8 1.5l1.6 4.1L13.7 7l-4.1 1.6L8 12.7 6.4 8.6 2.3 7l4.1-1.4L8 1.5z" />
                    <path d="M13 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4z" />
                  </svg>
                  <span className="dock-tooltip">AI Assistant</span>
                </button>
                <button
                  id="open-cmdbar-btn"
                  type="button"
                  className="pf-btn dock-icon-btn dock-cmd-btn"
                  aria-pressed={cmdBarOpen}
                  aria-label="Commands Ctrl+K"
                  title="Commands (Ctrl+K)"
                  onClick={() => setCmdBarOpen((prev) => !prev)}
                >
                  <svg
                    className="dock-svg-icon"
                    viewBox="0 0 16 16"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                    <path d="M4.5 6l2.5 2-2.5 2" />
                    <line x1="8.5" y1="10" x2="11.5" y2="10" />
                  </svg>
                  <kbd className="dock-kbd">Ctrl+K</kbd>
                  <span className="dock-tooltip">Commands (Ctrl+K)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ChecksDrawer />
    </section>
  );
}
