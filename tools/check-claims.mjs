#!/usr/bin/env node
/**
 * check-claims — a number a document states about the code is derived from the
 * code, or the build fails.
 *
 * Audit **D-19**, task **T-10b**. The technique is on the reuse register from
 * `rack-studio` ("the mechanic, not the scale"); the claims below are this
 * repository's own. Every project in the reference set had assertion counts that
 * disagreed across its own documents, and this one has produced a fresh example
 * in every session it has looked: `47 test files` was published in both
 * scoreboard copies while the tree held 50, and nothing noticed.
 *
 * WHY THIS IS A DECLARED TABLE AND NOT A SWEEP OVER EVERY NUMBER.
 *
 * T-10a settled the editorial rule this repository runs on: *a dated observation
 * keeps its number and says its date; a present-tense assertion is re-derived or
 * removed.* `docs/CURRENT_STATE.md` is allowed to say "3 commits" forever,
 * because it says "Assessed 2026-08-31" at the top and rewriting it would
 * falsify a record. A checker that flagged every stale-looking integer would
 * fire on every dated record in the repository, be judged noisy, and be
 * switched off inside a week — which is worse than not having one.
 *
 * So a claim is checked because someone DECLARED it here, naming the file, the
 * pattern that finds it, and the derivation that settles it. Exemptions-as-data,
 * the same shape `check-rls` uses for its policy exemptions.
 *
 * THE BLIND SPOTS, stated beside the guarantee (house rule):
 *   - It checks the claims in the table below and NOTHING ELSE. A new number
 *     written into a living document tomorrow is invisible to this checker until
 *     someone adds it here. That is a real gap and it is the price of not firing
 *     on dated records; the mitigation is that adding a row is three lines.
 *   - It proves a stated number equals a derived one. It cannot tell you the
 *     derivation is the right question to ask.
 *   - A pattern that stops matching is treated as FAILURE, not as "nothing to
 *     check" — see below. That is the one way this checker refuses to rot
 *     quietly.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* ------------------------------------------------------------------ *
 * Derivations — what the code actually says.
 * ------------------------------------------------------------------ */

function walk(dir, predicate, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, predicate, out);
    else if (predicate(entry)) out.push(full);
  }
  return out;
}

export const DERIVATIONS = Object.freeze({
  testFiles: (root) =>
    ['packages', 'apps', 'tools'].reduce(
      (n, d) => n + walk(join(root, d), (f) => f.endsWith('.test.ts')).length,
      0,
    ),
  packages: (root) => {
    try {
      return readdirSync(join(root, 'packages')).filter((p) =>
        statSync(join(root, 'packages', p)).isDirectory(),
      ).length;
    } catch {
      return 0;
    }
  },
  migrations: (root) => {
    try {
      return readdirSync(join(root, 'packages', 'db', 'migrations')).filter((f) =>
        /^\d+_.*\.sql$/.test(f),
      ).length;
    } catch {
      return 0;
    }
  },
  routeTableEntries: (root) => {
    try {
      const src = readFileSync(join(root, 'apps', 'api', 'src', 'authz', 'routes.ts'), 'utf8');
      return (src.match(/^ {2}\{ method:/gm) ?? []).length;
    } catch {
      return 0;
    }
  },
});

/* ------------------------------------------------------------------ *
 * The claims. Each names the file, the pattern, and what settles it.
 * ------------------------------------------------------------------ */

/**
 * `pattern` must contain exactly one capture group, and must match EXACTLY ONCE
 * in the file. Zero matches means the sentence was reworded and this claim
 * stopped being checked without anyone noticing; more than one means the
 * checker cannot tell which number is the claim. Both are failures.
 */
export const CLAIMS = Object.freeze([
  {
    id: 'progress.md · packages',
    file: 'tasks/progress.md',
    pattern: /^\| Packages \| \*\*(\d+)\*\*/m,
    derive: 'packages',
  },
  {
    id: 'progress.md · test files',
    file: 'tasks/progress.md',
    pattern: /^\| Test files \| \*\*(\d+)\*\*/m,
    derive: 'testFiles',
  },
  {
    id: 'progress.md · migrations',
    file: 'tasks/progress.md',
    pattern: /^\| Migrations \| \*\*(\d+)\*\*/m,
    derive: 'migrations',
  },
  {
    id: 'progress.md · route table entries',
    file: 'tasks/progress.md',
    pattern: /^\| Route table \| \*\*(\d+) entries\*\*/m,
    derive: 'routeTableEntries',
  },
  {
    id: 'progress.html · packages',
    file: 'tasks/progress.html',
    pattern: /<strong>(\d+)<\/strong> packages/,
    derive: 'packages',
  },
  {
    id: 'progress.html · test files',
    file: 'tasks/progress.html',
    pattern: /<strong>(\d+)<\/strong> test files/,
    derive: 'testFiles',
  },
  {
    id: 'progress.html · migrations',
    file: 'tasks/progress.html',
    pattern: /<strong>(\d+)<\/strong> migrations/,
    derive: 'migrations',
  },
]);

export function claimViolations(root = ROOT, claims = CLAIMS, derivations = DERIVATIONS) {
  const violations = [];
  let checked = 0;

  for (const claim of claims) {
    const derive = derivations[claim.derive];
    if (derive === undefined) {
      violations.push(`${claim.id}: names derivation '${claim.derive}', which does not exist.`);
      continue;
    }

    let text;
    try {
      text = readFileSync(join(root, claim.file), 'utf8');
    } catch {
      violations.push(`${claim.id}: '${claim.file}' could not be read.`);
      continue;
    }

    // Global copy of the pattern, so "matched exactly once" can be asserted
    // rather than assumed. A claim that matches twice is ambiguous; a claim that
    // matches zero times has silently stopped being a claim.
    const all = [...text.matchAll(new RegExp(claim.pattern.source, `${claim.pattern.flags}g`))];
    if (all.length === 0) {
      violations.push(
        `${claim.id}: its pattern matched NOTHING in ${claim.file}. The sentence was probably ` +
          'reworded, which means this claim stopped being checked. Fix the pattern or remove ' +
          'the claim — do not leave it matching nothing.',
      );
      continue;
    }
    if (all.length > 1) {
      violations.push(
        `${claim.id}: its pattern matched ${String(all.length)} times in ${claim.file}. ` +
          'A claim must be unambiguous; narrow the pattern.',
      );
      continue;
    }

    const stated = Number(all[0]?.[1]);
    const actual = derive(root);
    checked += 1;
    if (stated !== actual) {
      violations.push(
        `${claim.id}: states ${String(stated)}, the code says ${String(actual)}. ` +
          `Derivation: ${claim.derive}.`,
      );
    }
  }

  return { violations, checked };
}

function main() {
  const { violations, checked } = claimViolations();

  if (checked === 0 && violations.length === 0) {
    console.error('check-claims: checked no claims. A checker that checks nothing passes everything.');
    process.exitCode = 1;
    return;
  }

  if (violations.length > 0) {
    console.error('check-claims: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }

  console.log(`check-claims: PASS — ${String(checked)} declared claim(s) match the code.`);
}

if (process.argv[1]?.split(sep).join('/').endsWith('check-claims.mjs')) main();
