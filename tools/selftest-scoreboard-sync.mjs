// The checker runs before the check, for the reason every other checker here does:
// a comparison that silently stopped comparing would report PASS forever.
//
// Two axes are proved here, because the checker asserts two different things.
//
//   1. The PHASE TABLE: progress.md's arithmetic and progress.html's bars carry
//      the same points, and the total sums.
//   2. The MEASURE CARDS: the four figures a reader sees first in progress.html
//      appear in progress.md's headline. This axis exists because of drift 18 —
//      the phase tables agreed perfectly while the cards above them carried a
//      superseded percentage, and nothing looked at the cards at all.
import {
  syncViolations,
  phasesFromMarkdown,
  phasesFromHtml,
  measureCardsFromHtml,
  measureCardViolations,
} from './check-scoreboard-sync.mjs';

const MD = `
## The headline

| Measure | Value | Source |
| **§15.2 MVP-1 "done when"** | **0 of 8 steps — 0%** | x |
| Plan executed | 10 of 11 pts — **91%** | x |

---

| Phase | Points | Done | % |
| 0 — Make CI real | 1 | 0 | 0% |
| 1 — Catalog | 10 | 10 | 100% |
| **Total** | **11** | **10** | **91%** |
`;
const CARDS =
  '<div class="cards">' +
  '<div class="m"><span class="lbl">§15.2</span><span class="v">0 of 8</span>' +
  '<span class="d">0 of 8 steps run end to end.</span></div>' +
  '<div class="m"><span class="lbl">Plan executed</span><span class="v">91%</span>' +
  '<span class="d">10 of 11 effort points. A ceiling, not a measure.</span></div>' +
  '</div>';
const HTML = `${CARDS}<p>0 of 8 steps</p>
<div class="pct">0 / 1</div><div class="pct">10 / 10</div><div class="pct">10 / 11</div>`;

let failed = 0;
const check = (name, cond) => { if (!cond) { console.error('  FAIL ' + name); failed++; } else console.log('  ok   ' + name); };

check('the honest pair passes', syncViolations(MD, HTML).length === 0);
check('markdown parses 3 rows', phasesFromMarkdown(MD).length === 3);
check('html parses 3 rows', phasesFromHtml(HTML).length === 3);
check('a changed HTML figure fails',
  syncViolations(MD, HTML.replace('10 / 10', '9 / 10')).length > 0);
check('a changed markdown figure fails',
  syncViolations(MD.replace('| 10 | 10 |', '| 10 | 9 |'), HTML).length > 0);
check('a dropped HTML row fails',
  syncViolations(MD, HTML.replace('<div class="pct">10 / 10</div>', '')).length > 0);
check('a total that does not sum fails',
  syncViolations(MD.replace('**11**', '**12**'), HTML.replace('10 / 11', '10 / 12')).length > 0);
// The card and the paragraph both carry the phrase, exactly as the real file
// does, so a genuine edit changes both — mutating one and leaving the other is
// itself a drift, and the case below asserts that too.
check('a §15.2 headline that disagrees fails',
  syncViolations(MD, HTML.replaceAll('0 of 8 steps', '3 of 8 steps')).length > 0);
check('a missing §15.2 headline fails',
  syncViolations(MD, HTML.replaceAll('0 of 8', 'several')).length > 0);
check('the card and the paragraph disagreeing with each other fails',
  syncViolations(MD, HTML.replace('<p>0 of 8 steps</p>', '<p>3 of 8 steps</p>')).length > 0);

// --- the measure cards (drift 18) ------------------------------------------

check('both measure cards parse', measureCardsFromHtml(HTML).length === 2);
check('a card reads its value and its first ratio',
  measureCardsFromHtml(HTML)[1]?.value === '91%' &&
  measureCardsFromHtml(HTML)[1]?.ratio === '10 of 11');
check('drift 18 itself: a card percentage the headline does not carry fails',
  measureCardViolations(MD, HTML.replace('<span class="v">91%</span>', '<span class="v">73%</span>')).length > 0);
check('a card ratio the headline does not carry fails',
  measureCardViolations(MD, HTML.replace('10 of 11 effort points', '9 of 11 effort points')).length > 0);
check('a card drift fails the whole checker, not just its own function',
  syncViolations(MD, HTML.replace('<span class="v">91%</span>', '<span class="v">73%</span>')).length > 0);
check('html with no measure cards at all fails',
  measureCardViolations(MD, HTML.replace(CARDS, '')).length > 0);
check('markdown with no headline section fails',
  measureCardViolations(MD.replace('## The headline', '## Something else'), HTML).length > 0);
check('a slash ratio in a card value normalises to the headline prose form',
  measureCardViolations(MD, HTML.replace('<span class="v">0 of 8</span>', '<span class="v">0/8</span>')).length === 0);
check('prose mentioning a superseded figure does not, by itself, fail',
  measureCardViolations(MD, HTML.replace('A ceiling, not a measure.',
    'It took 20.0% down to 19.7% and only the numerator is progress.')).length === 0);

console.log(failed ? `selftest-scoreboard-sync FAIL (${failed})` : 'selftest-scoreboard-sync PASS');
process.exit(failed ? 1 : 0);
