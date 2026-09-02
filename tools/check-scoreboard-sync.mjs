// The scoreboard exists in two files: tasks/progress.md holds the arithmetic,
// tasks/progress.html is the source of the published page. Two copies of the same
// numbers drift. This re-derives the numbers from BOTH and asserts they agree.
//
// It compares parsed VALUES, not strings, so a reformat does not fail it and a
// changed number cannot pass it.
//
// WHAT IT DOES NOT COVER, so nobody reads a green build as more than it is:
//   - prose. The phase figures, their sum, the S15.2 headline, and (since T-10b)
//     the measure cards are compared. The two files can still describe the same
//     numbers in different words and pass; only the numbers are checked.
//
// WHAT T-10b ADDED, AND WHY. Until 2026-09-02 this compared the phase bars and
// the S15.2 headline AND NOTHING ELSE. progress.html published "task count 14%
// - 7 of 44" while progress.md published "10 of 44 - 23%", for a full session,
// with this checker green over it - drift 18. The gate ran, passed, and did not
// cover the figure a reader sees first. That is F-08's shape at the
// documentation layer: the docstring was honest, the NAME was wider than the
// mechanism. The measure cards are now in the mechanism.
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
export function mvpStepsAll(text) {
  return [...text.matchAll(/(\d+)\s*(?:of|\/)\s*8\s*(?:steps)?/gi)].map((m) => Number(m[1]));
}

export function mvpStepsFrom(text) {
  const all = mvpStepsAll(text);
  return all.length > 0 ? all[0] : null;
}

/**
 * The measure cards at the top of `progress.html` — the four or five big
 * percentages a reader sees before anything else.
 *
 * Only two things are taken from each card: the headline value in `.v`, and the
 * FIRST `N of M` in its detail text. Deliberately not every number in the card:
 * the weighted card's prose legitimately mentions older figures ("it took 20.0%
 * down to 19.7%"), and a checker that flagged those would be reporting history
 * as drift.
 */
export function measureCardsFromHtml(html) {
  const cards = [...html.matchAll(/<div class="m[^"]*">([\s\S]*?)<\/div>\s*(?=<div class="m|<\/div>)/g)];
  return cards.map((m) => {
    const body = m[1] ?? '';
    const value = /<span class="v">([^<]+)<\/span>/.exec(body)?.[1]?.trim() ?? null;
    const detail = /<span class="d">([\s\S]*?)<\/span>/.exec(body)?.[1] ?? '';
    const ratio = /(\d+)\s*of\s*(?:the\s+)?(\d+)/.exec(detail);
    return {
      value,
      ratio: ratio ? `${ratio[1]} of ${ratio[2]}` : null,
    };
  });
}

/** `19/21` and `19 of 21` are the same claim written two ways. */
function normaliseValue(value) {
  const slash = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  return slash ? `${slash[1]} of ${slash[2]}` : value;
}

/** The headline table in progress.md — the rows the cards are supposed to mirror. */
export function headlineTextFromMarkdown(md) {
  const start = md.indexOf('## The headline');
  if (start < 0) return null;
  const rest = md.slice(start + 1);
  const end = rest.indexOf('\n---');
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Every figure a measure card states must appear in the markdown headline table.
 *
 * Containment rather than positional matching, because the two files label the
 * same measure differently on purpose - "Plan executed · weighted" against
 * "Plan-task completion, effort-weighted" - and pairing them by label would make
 * this checker fail on a rewording rather than on a disagreement.
 */
export function measureCardViolations(md, html) {
  const out = [];
  const headline = headlineTextFromMarkdown(md);
  if (headline === null) {
    out.push('progress.md: no "## The headline" section found, so the measure cards cannot be checked');
    return out;
  }

  const cards = measureCardsFromHtml(html);
  if (cards.length === 0) {
    // Drift 18 was invisible because nothing looked at the cards. A run that
    // finds no cards and reports success would recreate exactly that.
    out.push('progress.html: no measure cards parsed. This checker would pass over any card drift.');
    return out;
  }

  for (const card of cards) {
    if (card.value !== null) {
      const wanted = normaliseValue(card.value);
      if (!headline.includes(wanted)) {
        out.push(
          `measure card value "${card.value}" is not in progress.md's headline table. ` +
            'The two files disagree about a figure a reader sees first.',
        );
      }
    }
    if (card.ratio !== null && !headline.includes(card.ratio)) {
      out.push(
        `measure card detail "${card.ratio}" is not in progress.md's headline table. ` +
          'The two files disagree about a figure a reader sees first.',
      );
    }
  }
  return out;
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

  // §15.2 is stated more than once in each file — a measure card, a headline
  // row, and prose. Comparing only the FIRST occurrence in each means three of
  // the four in progress.md could be edited with nothing going red, which is
  // the drift-18 shape one level down: a figure a reader sees, outside the gate.
  for (const [name, text] of [['progress.md', md], ['progress.html', html]]) {
    const all = mvpStepsAll(text);
    const distinct = [...new Set(all)];
    if (distinct.length > 1) {
      out.push(
        `${name} states §15.2 as ${distinct.join(' and ')} of 8 in the same file. ` +
          'One occurrence was edited and the others were not.',
      );
    }
  }

  const ma = mvpStepsFrom(md), mb = mvpStepsFrom(html);
  if (ma === null || mb === null) out.push('the §15.2 "N of 8" headline is missing from one of the two files');
  else if (ma !== mb) out.push(`§15.2 disagrees: progress.md says ${ma} of 8, progress.html says ${mb} of 8`);

  // T-10b, drift 18. The figures a reader sees first were outside this gate.
  out.push(...measureCardViolations(md, html));

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
