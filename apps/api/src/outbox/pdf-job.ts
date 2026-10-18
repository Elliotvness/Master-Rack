/**
 * Outbox PDF generation job renderer & budget metric gate (task **P-03**).
 *
 * Blueprint §5.4 budget 5: Preliminary PDF generation has a `6,000 ms` `p95`
 * budget and is explicitly asynchronous. It runs in the outbox job queue
 * (`topic = 'pdf.generate'`), never in the HTTP request path, and the budget
 * is asserted over the recorded job metric set once `>= 20` jobs exist (below
 * 20 jobs the assertion is skipped **loudly** rather than silently passing).
 *
 * A 300-bay preliminary summary (`fixtures/perf/unit-300-bay.json`, 12 runs ×
 * 25 bays) is not a one-page toy: `renderPreliminaryPdf` emits a cover/plan
 * overview page plus paginated bay-schedule pages (`BAYS_PER_SCHEDULE_PAGE = 40`,
 * yielding 9 pages for a 300-bay unit), watermarked `PRELIMINARY — NOT FOR
 * CONSTRUCTION` on every page, and refuses to render if any key in the input
 * matches `FORBIDDEN_CLIENT_FIELDS` (AC-02).
 */

import { createHash } from 'node:crypto';
import { findForbiddenFields } from '@rms/contracts';

export const BAYS_PER_SCHEDULE_PAGE = 40;
export const PDF_BUDGET_MIN_JOBS = 20;
export const PDF_BUDGET_P95_MS = 6_000;

export function preliminaryPdfKey(submissionId: string, manifestHash: string): string {
  return `documents/${submissionId}/${manifestHash}.pdf`;
}

export interface PreliminaryPdfBayRow {
  readonly bayIndex: number;
  readonly runId: string;
  readonly bayId: string;
  readonly xUm: number;
  readonly yUm: number;
  readonly lengthUm: number;
  readonly levels: number;
}

export interface PreliminaryPdfInput {
  readonly submissionId: string;
  readonly manifestHash: string;
  readonly submissionHash: string;
  readonly submittedAt: string;
  readonly projectNumber: string;
  readonly projectName: string;
  readonly revisionCode: string;
  readonly contentHash: string;
  readonly optionLabel: string;
  readonly aisleWidthUm: number;
  readonly facilityWidthUm: number;
  readonly facilityDepthUm: number;
  readonly clearHeightUm: number;
  readonly bays: readonly PreliminaryPdfBayRow[];
  readonly findings: readonly {
    readonly code: string;
    readonly severity: string;
    readonly closed_by: string;
  }[];
  readonly assumptions: readonly {
    readonly code: string;
    readonly statement: string;
    readonly acknowledged: boolean;
  }[];
}

export interface RenderedPreliminaryPdf {
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly pageCount: number;
  readonly bayCount: number;
}

function escapePdfText(text: string): string {
  return text.replace(/[\\()]/g, (ch) => `\\${ch}`);
}

function buildPageStream(
  pageNumber: number,
  totalPages: number,
  docNumber: string,
  manifestShort: string,
  bodyLines: readonly string[],
  vectorOps: readonly string[],
): string {
  const ops: string[] = [
    // Diagonal watermark across every page (FR-DC-03)
    'q',
    '0.82 0.82 0.82 rg',
    'BT',
    '/F1 26 Tf',
    '0.7071 0.7071 -0.7071 0.7071 110 210 Tm',
    '(PRELIMINARY - NOT FOR CONSTRUCTION) Tj',
    'ET',
    'Q',
    ...vectorOps,
    'BT',
    '/F1 11 Tf',
    '48 748 Td',
    `(${escapePdfText(`RACK MASTER STUDIO — PRELIMINARY SUMMARY (${docNumber})`)}) Tj`,
    '/F1 8.5 Tf',
    '0 -16 Td',
  ];

  for (const line of bodyLines) {
    ops.push(`(${escapePdfText(line)}) Tj`);
    ops.push('0 -12 Td');
  }

  ops.push('ET');
  ops.push('BT');
  ops.push('/F1 8 Tf');
  ops.push('48 32 Td');
  ops.push(
    `(${escapePdfText(`PRELIMINARY — Page ${String(pageNumber)} of ${String(totalPages)} — Doc ${docNumber} — Manifest ${manifestShort}`)}) Tj`,
  );
  ops.push('ET');

  return ops.join('\n');
}

/**
 * Render a deterministic, multi-page PDF-1.4 preliminary summary for a frozen
 * client submission.
 */
export function renderPreliminaryPdf(input: PreliminaryPdfInput): RenderedPreliminaryPdf {
  const forbidden = findForbiddenFields(input);
  if (forbidden.length > 0) {
    throw new Error(
      `refusing to render preliminary PDF: forbidden client field(s) present: ${forbidden.join(', ')}`,
    );
  }

  const docNumber = `${input.projectNumber}-${input.revisionCode}-PRELIM`;
  const manifestShort = input.manifestHash.slice(0, 16);

  const scheduleChunks: PreliminaryPdfBayRow[][] = [];
  if (input.bays.length === 0) {
    scheduleChunks.push([]);
  } else {
    for (let i = 0; i < input.bays.length; i += BAYS_PER_SCHEDULE_PAGE) {
      scheduleChunks.push(input.bays.slice(i, i + BAYS_PER_SCHEDULE_PAGE));
    }
  }

  const totalPages = 1 + scheduleChunks.length;
  const pageStreams: string[] = [];

  // Page 1: Cover, Project/Revision Metadata, Plan-View Vector Footprint, Findings & Assumptions
  const coverLines: string[] = [
    `Project: ${input.projectNumber} — ${input.projectName}`,
    `Revision: ${input.revisionCode} (Frozen Content Hash: ${input.contentHash.slice(0, 24)}...)`,
    `Submission ID: ${input.submissionId} | Submitted At: ${input.submittedAt}`,
    `Submission Hash: ${input.submissionHash}`,
    `Manifest SHA-256: ${input.manifestHash}`,
    `Active Option: ${input.optionLabel} | Aisle Width: ${String(input.aisleWidthUm)} um`,
    `Facility Envelope: ${String(input.facilityWidthUm)} x ${String(input.facilityDepthUm)} x ${String(input.clearHeightUm)} um`,
    `Total Configured Bays: ${String(input.bays.length)} across ${String(scheduleChunks.length)} schedule page(s)`,
    '--------------------------------------------------------------------------------',
    `Client Findings (${String(input.findings.length)}):`,
    ...input.findings.map((f) => `  [${f.severity}] ${f.code} — ${f.closed_by}`),
    '--------------------------------------------------------------------------------',
    `Client Assumptions (${String(input.assumptions.length)}):`,
    ...input.assumptions.map(
      (a) => `  [${a.acknowledged ? 'ACK' : 'UNACK'}] ${a.code}: ${a.statement}`,
    ),
  ];

  const vectorOps: string[] = [
    'q',
    '0.25 0.35 0.55 RG',
    '0.8 w',
    '48 70 516 90 re S',
    ...input.bays.map((_b, idx) => {
      const col = idx % 25;
      const row = Math.floor(idx / 25);
      const x = 54 + col * 20;
      const y = 148 - row * 6;
      return `${String(x)} ${String(y)} 16 4 re S`;
    }),
    'Q',
  ];

  pageStreams.push(
    buildPageStream(1, totalPages, docNumber, manifestShort, coverLines, vectorOps),
  );

  // Pages 2..N: Paginated Bay Schedule (40 bays per page)
  scheduleChunks.forEach((chunk, chunkIdx) => {
    const pageNumber = chunkIdx + 2;
    const lines: string[] = [
      `Bay Schedule — Section ${String(chunkIdx + 1)} of ${String(scheduleChunks.length)} (Total Bays: ${String(input.bays.length)})`,
      'Idx  | Run ID       | Bay ID       | X (um)       | Y (um)       | Length (um)  | Levels',
      '----------------------------------------------------------------------------------------',
      ...chunk.map(
        (b) =>
          `#${String(b.bayIndex).padStart(3, '0')} | ${b.runId.padEnd(12)} | ${b.bayId.padEnd(12)} | ${String(b.xUm).padStart(12)} | ${String(b.yUm).padStart(12)} | ${String(b.lengthUm).padStart(12)} | ${String(b.levels)}`,
      ),
    ];
    pageStreams.push(
      buildPageStream(pageNumber, totalPages, docNumber, manifestShort, lines, []),
    );
  });

  // Assemble PDF-1.4 objects:
  // 1: Catalog
  // 2: Pages
  // 3: Font (/Helvetica)
  // For each page k (0..totalPages-1):
  //   pageObjId = 4 + k * 2
  //   contentObjId = 5 + k * 2
  const objects: string[] = [];
  const kidsRefs = pageStreams.map((_, idx) => `${String(4 + idx * 2)} 0 R`).join(' ');

  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${kidsRefs}] /Count ${String(totalPages)} >>\nendobj\n`,
  );
  objects.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');

  pageStreams.forEach((streamText, idx) => {
    const pageObjId = 4 + idx * 2;
    const contentObjId = 5 + idx * 2;
    const streamLen = Buffer.byteLength(streamText, 'utf8');
    objects.push(
      `${String(pageObjId)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentObjId)} 0 R >>\nendobj\n`,
    );
    objects.push(
      `${String(contentObjId)} 0 obj\n<< /Length ${String(streamLen)} >>\nstream\n${streamText}\nendstream\nendobj\n`,
    );
  });

  let pdfText = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdfText, 'utf8'));
    pdfText += obj;
  }

  const xrefStart = Buffer.byteLength(pdfText, 'utf8');
  const totalObjects = objects.length + 1;
  pdfText += `xref\n0 ${String(totalObjects)}\n`;
  pdfText += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    pdfText += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdfText += `trailer\n<< /Size ${String(totalObjects)} /Root 1 0 R >>\nstartxref\n${String(xrefStart)}\n%%EOF\n`;

  const bytes = new Uint8Array(Buffer.from(pdfText, 'utf8'));
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  return {
    text: pdfText,
    bytes,
    sha256,
    pageCount: totalPages,
    bayCount: input.bays.length,
  };
}

export interface PdfJobSample {
  readonly jobId: string;
  readonly submissionId: string;
  readonly manifestHash: string;
  readonly durationMs: number;
  readonly pageCount: number;
  readonly bayCount: number;
  readonly recordedAt: string;
}

export interface PdfJobMetricsSummary {
  readonly count: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

export type PdfJobBudgetVerdict =
  | {
      readonly status: 'skipped_loudly';
      readonly count: number;
      readonly minJobs: number;
      readonly message: string;
    }
  | {
      readonly status: 'asserted';
      readonly summary: PdfJobMetricsSummary;
    };

/**
 * Compute distribution percentiles (`p50`, `p95`, `p99`) over the recorded set
 * of PDF job durations — never per call (**P-03**).
 */
export function summarizePdfJobMetrics(samples: readonly PdfJobSample[]): PdfJobMetricsSummary {
  if (samples.length === 0) {
    throw new RangeError('summarizePdfJobMetrics requires at least 1 recorded job sample');
  }
  const sorted = samples.map((s) => s.durationMs).sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  const sum = sorted.reduce((acc, v) => acc + v, 0);

  return {
    count: sorted.length,
    min: sorted[0]!,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
  };
}

export interface AssertPdfJobBudgetOptions {
  readonly budgetP95Ms?: number;
  readonly minJobs?: number;
  readonly ratchetP50Ms?: number;
  readonly onSkip?: (message: string) => void;
}

/**
 * Assert §5.4 budget 5 (`6,000 ms` `p95`) over the recorded set of PDF jobs
 * once `>= 20` jobs exist; below 20 jobs the assertion is skipped **loudly**
 * via `onSkip` (defaulting to `console.warn`) rather than passing silently.
 */
export function assertPdfJobBudget(
  samples: readonly PdfJobSample[],
  options: AssertPdfJobBudgetOptions = {},
): PdfJobBudgetVerdict {
  const budgetP95Ms = options.budgetP95Ms ?? PDF_BUDGET_P95_MS;
  const minJobs = options.minJobs ?? PDF_BUDGET_MIN_JOBS;
  const notifySkip = options.onSkip ?? ((msg: string): void => console.warn(msg));

  if (samples.length < minJobs) {
    const message =
      `[P-03 SKIPPED LOUDLY] PDF generation p95 budget (${String(budgetP95Ms)} ms) ` +
      `not asserted: only ${String(samples.length)} of ${String(minJobs)} required jobs recorded.`;
    notifySkip(message);
    return {
      status: 'skipped_loudly',
      count: samples.length,
      minJobs,
      message,
    };
  }

  const summary = summarizePdfJobMetrics(samples);
  if (summary.p95 > budgetP95Ms) {
    throw new Error(
      `PDF generation p95 ${summary.p95.toFixed(2)} ms exceeds §5.4 budget of ${String(budgetP95Ms)} ms across ${String(summary.count)} jobs`,
    );
  }

  if (options.ratchetP50Ms !== undefined && summary.p50 > options.ratchetP50Ms) {
    throw new Error(
      `PDF generation p50 ${summary.p50.toFixed(2)} ms exceeds p50 ratchet of ${String(options.ratchetP50Ms)} ms across ${String(summary.count)} jobs`,
    );
  }

  return {
    status: 'asserted',
    summary,
  };
}
