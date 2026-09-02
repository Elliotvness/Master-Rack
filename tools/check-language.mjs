#!/usr/bin/env node
/**
 * check-language — the product must not claim more than its design delivers.
 *
 * `src/verify.py` already guards this wording in the blueprint documents. This
 * is the equivalent for SHIPPED STRINGS, which is where it actually matters: a
 * document nobody reads cannot mislead a client, and a button label can.
 *
 * The phrase that motivates it is "tamper-proof". SHA-256 and a hash chain give
 * tamper EVIDENCE: they let anyone holding a later head hash detect that
 * history was altered. They do not prevent a database superuser from rewriting
 * the chain. Object Lock in compliance mode upgrades one specific artifact, the
 * manifest, to genuinely undeletable — but the system as a whole is
 * tamper-evident, externally timestamped and independently re-verifiable, and
 * saying otherwise is a claim we would have to withdraw in front of the person
 * who relied on it.
 *
 * Scope is deliberately narrow: string and template literals in shipped source.
 * Comments and identifiers are exempt, because this file, the module that
 * explains the distinction, and every honest discussion of it must be free to
 * name the forbidden phrase. A checker that cannot tolerate its own subject
 * matter gets disabled within a week.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Directories whose string literals reach a human. */
const SCANNED = ['apps', 'packages'];

/**
 * Forbidden phrases, each with the reason the claim is unsupportable.
 *
 * Matched case-insensitively, and tolerant of a hyphen, space or none, because
 * "tamper proof" misleads exactly as much as "tamper-proof".
 */
const FORBIDDEN = [
  {
    pattern: /tamper[\s-]?proof/i,
    say: 'tamper-evident, externally timestamped and independently re-verifiable',
    why: 'a hash chain detects modification; it does not prevent a superuser from rewriting history',
  },
  {
    pattern: /\bunhackable\b/i,
    say: 'name the specific control and what it defends against',
    why: 'no system is unhackable, and the claim invites the one test nobody wants run',
  },
  {
    pattern: /\b100%\s+(secure|accurate|guaranteed)\b/i,
    say: 'state the measured property and its bound',
    why: 'a total claim cannot survive one counterexample',
  },
  {
    pattern: /stamped\s+engineering\s+review/i,
    say: 'quote delivery',
    why: 'outside the scope fence; nothing here is a stamped engineering review',
  },
  {
    pattern: /\bprelim\s+turnaround\b/i,
    say: 'acknowledgement',
    why: 'the client makes the preliminary, so the clock is not ours to name that way',
  },
  {
    pattern: /\bcertified\s+(by\s+us|design|drawing)\b/i,
    say: 'preliminary, unstamped, for discussion',
    why: 'OD-16: no seal, licence number or engineer identity on any preliminary output',
  },
];

/**
 * Files whose whole purpose is to name the forbidden wording.
 *
 * `status.ts` exports FORBIDDEN_STATUS_WORDING, a denylist the client app
 * checks its own strings against. Flagging a denylist for containing the words
 * it denies is the exact false positive that gets a checker switched off in a
 * week: the entry is not a claim, it is the guard against the claim.
 *
 * Listed as explicit paths rather than matched by a name pattern, so adding a
 * new exemption is a visible decision in a diff rather than a file someone
 * quietly names to slip past.
 */
const DENYLIST_FILES = new Set(['apps/client-web/src/lib/status.ts']);

/**
 * Extract string and template literals, skipping comments.
 *
 * A regex over raw source would flag every comment explaining the rule,
 * including the ones in this file. Walking the text character by character is
 * cruder than an AST but has no dependency and no parse-failure mode, and the
 * self-test proves it distinguishes the cases that matter.
 */
export function stringLiterals(source) {
  const out = [];
  let i = 0;
  let line = 1;

  const push = (value, startLine) => {
    if (value !== '') out.push({ value, line: startLine });
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    // Line comment.
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }

    // Block comment.
    if (c === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1;
        i += 1;
      }
      i += 2;
      continue;
    }

    // String or template literal.
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      const startLine = line;
      let value = '';
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') {
          value += source[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (source[i] === '\n') line += 1;
        value += source[i];
        i += 1;
      }
      i += 1;
      push(value, startLine);
      continue;
    }

    i += 1;
  }

  return out;
}

function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else if (/\.(ts|mts|tsx)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}


/**
 * T-28. Every scan is rooted at `root`, which defaults to the repository. The
 * self-test passes a temp tree instead, so it never writes a probe file inside
 * the working copy — on a filesystem that refuses deletion a stranded probe
 * makes the NEXT run fail against the self-test's own leftover fixture, and a
 * false red trains people to re-run until it passes.
 *
 * The rules themselves are module constants, not files, so a temp tree exercises
 * the REAL configuration rather than a simplified copy of it.
 */
export function checkLanguage(root = ROOT) {
  const violations = [];
  const scanned = [];

  for (const base of SCANNED) {
    for (const file of listFiles(join(root, base))) {
      const rel = relative(root, file).split(sep).join('/');

      /**
       * Test files are excluded, for the same reason check-boundaries excludes
       * them: the property being protected is a property of SHIPPED strings. A
       * test that proves the wording guard fires has to be able to write the
       * wording it rejects, and `status.test.ts` does exactly that. A test
       * string never reaches a client.
       */
      if (/\.test\.ts$/.test(rel)) continue;

      if (DENYLIST_FILES.has(rel)) {
        scanned.push(rel);
        continue;
      }

      const source = readFileSync(file, 'utf8');
      scanned.push(rel);

      for (const { value, line } of stringLiterals(source)) {
        for (const rule of FORBIDDEN) {
          if (!rule.pattern.test(value)) continue;
          violations.push(
            `${rel}:${line} says "${value.slice(0, 60)}"\n` +
              `    why: ${rule.why}\n` +
              `    say: ${rule.say}`,
          );
        }
      }
    }
  }

  return { violations, scanned };
}

function main() {
  const { violations, scanned } = checkLanguage();
  if (violations.length > 0) {
    console.error('check-language: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-language: PASS — ${scanned.length} file(s) scanned, no overclaiming strings.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
