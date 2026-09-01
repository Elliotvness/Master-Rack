// The checker runs before the check, for the reason every other checker here does:
// a comparison that silently stopped comparing would report PASS forever.
import { syncViolations, phasesFromMarkdown, phasesFromHtml } from './check-scoreboard-sync.mjs';

const MD = `
| **§15.2 MVP-1 "done when"** | **0 of 8 steps — 0%** | x |
| Phase | Points | Done | % |
| 0 — Make CI real | 1 | 0 | 0% |
| 1 — Catalog | 10 | 10 | 100% |
| **Total** | **11** | **10** | **91%** |
`;
const HTML = `<p>0 of 8 steps</p>
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
check('a §15.2 headline that disagrees fails',
  syncViolations(MD, HTML.replace('0 of 8', '3 of 8')).length > 0);
check('a missing §15.2 headline fails',
  syncViolations(MD, HTML.replace('<p>0 of 8 steps</p>', '')).length > 0);

console.log(failed ? `selftest-scoreboard-sync FAIL (${failed})` : 'selftest-scoreboard-sync PASS');
process.exit(failed ? 1 : 0);
