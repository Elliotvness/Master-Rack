#!/usr/bin/env node
/**
 * check-findings — every finding id is allocated once, and every reference has
 * something to refer to.
 *
 * **Why this exists.** On 2026-09-05 two branches off the same base each
 * allocated **F-46 through F-50** to five entirely different defects. Neither
 * did anything wrong: both read the register, both took the highest number, and
 * both were right at the moment they looked. The register is a shared counter
 * with no allocator, and a shared counter with no allocator hands the same
 * number to everyone who asks at once.
 *
 * That is not the usual shape this repository hunts — it is not a control that
 * fails open. It is the **absence of a control over the register itself**, and
 * the failure only appears at merge, which is the worst moment to discover that
 * two F-47s describe unrelated defects and every commit body citing one is now
 * ambiguous.
 *
 * WHAT COUNTS AS AN ALLOCATION, and why the distinction matters. The register
 * already carries two kinds of heading:
 *
 *     ## F-12 — `changes_from_2026_08` denies a change …      <- allocation
 *     ## F-12 and F-13 — fixed, values untouched              <- follow-up
 *     ## F-29 closure note — the tenth suite skipped …        <- follow-up
 *
 * Only the first form allocates. Treating every mention as an allocation would
 * report the follow-ups as duplicates and the checker would be silenced within
 * a week — which is the failure mode `check-language`'s docstring names.
 *
 * WHAT IS CHECKED
 *   1. No id is allocated twice. This is the merge collision.
 *   2. Allocations run 1..N with no gap. A skipped number means a finding was
 *      written and lost, or a number was reserved and never used; either way
 *      somebody should say which.
 *   3. Every id referenced by a follow-up heading has an allocation. A
 *      follow-up to a finding that does not exist is a dangling citation.
 *
 * A VACUOUS PASS IS A FAILURE: no allocations at all exits 1 rather than
 * reporting nothing to check, which is the house rule.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const REGISTER = 'tasks/review-findings.md';

/** `## F-07 — text`. The em dash directly after the id is what makes it an allocation. */
const ALLOCATION_RE = /^## F-(\d+)\s+—/;
/** Any `F-nn` in a heading, allocation or not. */
const REFERENCE_RE = /F-(\d+)/g;

export function readFindings(text) {
  const allocations = new Map(); // id -> line number
  const duplicates = [];
  const references = new Map(); // id -> line number of first reference

  text.split('\n').forEach((line, i) => {
    if (!line.startsWith('## ')) return;
    const lineNo = i + 1;

    const alloc = ALLOCATION_RE.exec(line);
    if (alloc !== null) {
      const id = Number.parseInt(alloc[1], 10);
      if (allocations.has(id)) duplicates.push({ id, first: allocations.get(id), again: lineNo });
      else allocations.set(id, lineNo);
      return;
    }

    REFERENCE_RE.lastIndex = 0;
    for (const m of line.matchAll(REFERENCE_RE)) {
      const id = Number.parseInt(m[1], 10);
      if (!references.has(id)) references.set(id, lineNo);
    }
  });

  return { allocations, duplicates, references };
}

export function checkFindings(root = ROOT) {
  const problems = [];
  const text = readFileSync(join(root, REGISTER), 'utf8');
  const { allocations, duplicates, references } = readFindings(text);

  if (allocations.size === 0) {
    problems.push(
      `${REGISTER} declares no findings. A register with nothing in it is not a clean register; ` +
        'refusing to report a pass over it.',
    );
    return { problems, allocated: 0 };
  }

  for (const { id, first, again } of duplicates) {
    problems.push(
      `F-${String(id).padStart(2, '0')} is allocated twice — line ${first} and line ${again}. ` +
        'Two branches almost certainly took the same next number from the same base. Renumber ' +
        'the later one and fix every commit body that cites it.',
    );
  }

  const ids = [...allocations.keys()].sort((a, b) => a - b);
  const highest = ids[ids.length - 1];
  for (let n = 1; n <= highest; n += 1) {
    if (!allocations.has(n)) {
      problems.push(
        `F-${String(n).padStart(2, '0')} is never allocated, though F-${String(highest).padStart(2, '0')} is. ` +
          'A gap means a finding was written and lost, or a number reserved and never used. Say which.',
      );
    }
  }

  for (const [id, line] of references) {
    if (!allocations.has(id)) {
      problems.push(
        `line ${line} refers to F-${String(id).padStart(2, '0')}, which is never allocated.`,
      );
    }
  }

  return { problems, allocated: allocations.size, highest };
}

function main() {
  let result;
  try {
    result = checkFindings();
  } catch (error) {
    console.error(`check-findings: FAIL — could not read ${REGISTER}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (result.problems.length > 0) {
    console.error('check-findings: FAIL');
    for (const p of result.problems) console.error(`  ${p}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `check-findings: PASS — ${result.allocated} finding(s) allocated once each, ` +
      `F-01 to F-${String(result.highest).padStart(2, '0')} with no gaps, every reference resolved.`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
