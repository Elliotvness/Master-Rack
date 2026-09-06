#!/usr/bin/env node
/**
 * selftest-findings — proves check-findings catches each case it claims to.
 *
 * Temp trees only, outside the working copy, for T-28's reason: a probe written
 * inside the repository can strand and make the NEXT run fail against the
 * self-test's own leftover.
 *
 * The must-NOT-fire cases are here in equal number, because the real register
 * legitimately carries follow-up headings — `## F-12 and F-13 — …`,
 * `## F-29 closure note — …` — and a checker that called those duplicates would
 * be switched off within a week.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REGISTER, checkFindings } from './check-findings.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
const ok = (name) => console.log(`  ok     ${name}`);
const bad = (name, detail) => {
  console.error(`  FAIL   ${name}${detail ? ` — ${detail}` : ''}`);
  failures += 1;
};

function tree(body) {
  const dir = mkdtempSync(join(tmpdir(), 'rms-selftest-findings-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, REGISTER), body, 'utf8');
  return dir;
}

function run(name, body, expect) {
  const dir = tree(body);
  try {
    const { problems } = checkFindings(dir);
    if (expect === null) {
      if (problems.length === 0) ok(name);
      else bad(name, `expected clean, got: ${problems.join('; ')}`);
    } else if (problems.some((p) => p.includes(expect))) {
      ok(name);
    } else {
      bad(name, `expected a problem containing ${JSON.stringify(expect)}, got: ${problems.join('; ') || '(none)'}`);
    }
  } catch (error) {
    bad(name, `threw: ${error.message}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GOOD = '## F-1 — first\n\ntext\n\n## F-2 — second\n\ntext\n';

console.log('selftest-findings');

// --- must NOT fire ---------------------------------------------------------
run('a clean register passes', GOOD, null);
run(
  'a follow-up heading naming two findings is not a duplicate',
  `${GOOD}\n## F-1 and F-2 — both fixed\n\ntext\n`,
  null,
);
run(
  'a closure-note heading is not a duplicate',
  `${GOOD}\n## F-2 closure note — the rest of it\n\ntext\n`,
  null,
);
run('prose mentioning F-1 in a paragraph is ignored', `${GOOD}\nSee F-1 and F-9 above.\n`, null);

// --- must fire -------------------------------------------------------------
run(
  'the same id allocated twice is caught — THE MERGE COLLISION',
  `${GOOD}\n## F-2 — a different defect entirely\n\ntext\n`,
  'is allocated twice',
);
run(
  'a gap in the sequence is caught',
  '## F-1 — first\n\n## F-3 — third\n',
  'F-02 is never allocated',
);
run(
  'a follow-up naming a finding that does not exist is caught',
  `${GOOD}\n## F-7 closure note — dangling\n\ntext\n`,
  'which is never allocated',
);
run('an empty register fails rather than passing vacuously', '# Findings\n\nNothing yet.\n', 'declares no findings');

// --- the real register -----------------------------------------------------
try {
  const { problems, allocated, highest } = checkFindings(ROOT);
  if (problems.length === 0 && allocated > 0) {
    ok(`the real register: ${allocated} allocated, F-01 to F-${String(highest).padStart(2, '0')}`);
  } else {
    bad('the real register', problems.join('; ') || 'nothing allocated');
  }
} catch (error) {
  bad('the real register', `threw: ${error.message}`);
}

if (failures > 0) {
  console.error(`selftest-findings FAIL — ${failures} case(s)`);
  process.exitCode = 1;
} else {
  console.log('selftest-findings PASS — 9 case(s), four of which must NOT go red.');
}
