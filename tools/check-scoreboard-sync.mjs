// The scoreboard exists in two files: tasks/progress.md holds the arithmetic,
// tasks/progress.html is the source of the published page. Two copies of the same
// numbers drift. This re-derives the numbers from BOTH and asserts they agree.
//
// It compares parsed VALUES, not strings, so a reformat does not fail it and a
// changed number cannot pass it.
//
// WHAT IT DOES NOT COVER, so nobody reads a green build as more than it is:
//   - prose. Only the phase figures, their sum, and the S15.2 headline are compared.
//     The two files can describe the same numbers differently and still pass.
//   - the published artifact and the Claude Project doc. CI can reach neither.
//     Those are verified by hand at update time - see tasks/progress.md, Update cadence.
import { readFileSync } from 'node:fs';

export class ScoreboardSyncError extends Error {}

/** Phase rows from the markdown table: [{name, points, done}] plus the total row. */
export function phasesFromMarkdown(md) {
  const rows = [];
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*(?:\*\*)?([^|*]+?)(?:\*\*)?\s*\|\s*(?:\*\*)?(\d+)(?:\*\*)?\s*\|\s*(?:\*\*)?(\d+)(?:\*\*)?\s*\|/);
    if (!m) continue;
    const name = m[1].trim();
    if (!/^(\d+\s*—|Total)/.test(name)) continue;   // phase rows and the total only
    rows.push({ name, points: Number(m[2]), done: Number(m[3]) });
  }
  return rows;
}

/** The same figures from the HTML: <div class="pct">done / points</div>, in order. */
export function phasesFromHtml(html) {
  return [...html.matchAll(/class="pct">\s*(\d+)\s*\/\s*(\d+)\s*</g)]
    .map((m) => ({ done: Number(m[1]), points: Number(m[2]) }));
}

/** The §15.2 headline. It is the answer to "how done is it" and must appear in both. */
export function mvpStepsFrom(text) {
  const m = text.match(/(\d+)\s*(?:of|\/)\s*8\s*(?:steps)?/i);
  return m ? Number(m[1]) : null;
}

export function syncViolations(md, html) {
  const out = [];
  const a = phasesFromMarkdown(md);
  const b = phasesFromHtml(html);

  if (a.length === 0) out.push('progress.md: no phase table rows parsed');
  if (a.length !== b.length) {
    out.push(`row count differs: progress.md has ${a.length}, progress.html has ${b.length}`);
    return out;                       // pairwise comparison would be meaningless
  }
  a.forEach((row, i) => {
    if (row.points !== b[i].points || row.done !== b[i].done) {
      out.push(`"${row.name}": progress.md says ${row.done}/${row.points}, progress.html says ${b[i].done}/${b[i].points}`);
    }
  });

  // The total must equal the sum of the phases, in the markdown itself.
  const phases = a.filter((r) => r.name !== 'Total');
  const total = a.find((r) => r.name === 'Total');
  if (total) {
    const sp = phases.reduce((n, r) => n + r.points, 0);
    const sd = phases.reduce((n, r) => n + r.done, 0);
    if (sp !== total.points) out.push(`points do not sum: phases ${sp}, total row ${total.points}`);
    if (sd !== total.done) out.push(`done does not sum: phases ${sd}, total row ${total.done}`);
  } else {
    out.push('progress.md: no Total row found');
  }

  const ma = mvpStepsFrom(md), mb = mvpStepsFrom(html);
  if (ma === null || mb === null) out.push('the §15.2 "N of 8" headline is missing from one of the two files');
  else if (ma !== mb) out.push(`§15.2 disagrees: progress.md says ${ma} of 8, progress.html says ${mb} of 8`);

  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const v = syncViolations(
    readFileSync('tasks/progress.md', 'utf8'),
    readFileSync('tasks/progress.html', 'utf8'),
  );
  if (v.length) {
    console.error('check-scoreboard-sync FAIL');
    for (const x of v) console.error('  - ' + x);
    process.exit(1);
  }
  console.log('check-scoreboard-sync PASS — progress.md and progress.html agree');
}
