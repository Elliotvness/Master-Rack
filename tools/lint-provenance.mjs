#!/usr/bin/env node
/**
 * lint-provenance — a formatter may only be applied to a provenanced quantity.
 *
 * `C-06` states the rule: a renderer consumes a display list and may not
 * recompute a dimension. A drawing must never print a number the model did not
 * produce. This enforces it mechanically, because the rule is one line of prose
 * and the failure it prevents is one line of code written in a hurry.
 *
 * The specific failure: `formatLength(96)` or `displayText(someRawNumber)`.
 * A `Quantity` carries a unit and an origin, so the formatter can refuse to
 * print a numeral for an unestablished value (AC-07). A raw number carries
 * neither, so it always prints — and the refusal is silently bypassed at the
 * last inch, on the one surface the client actually reads.
 *
 * This is a source scan rather than a type check for a deliberate reason. The
 * type system already rejects `formatLength(96)`, and yet the scan still earns
 * its place: `as never`, `as unknown as Quantity`, `@ts-expect-error` and a
 * hand-built object literal all defeat the type system, and every one of them
 * appears in real code under deadline pressure. A cast is exactly how a raw
 * number reaches a formatter.
 *
 * The self-test in selftest-provenance.mjs proves this catches what it claims.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Directories whose source may call a formatter. */
const SCAN_ROOTS = ['packages', 'apps'];

/**
 * The formatters. Each takes a Quantity as its first argument, and each returns
 * VERIFY rather than a numeral when that quantity is not established.
 */
const FORMATTERS = [
  'formatLength',
  'formatLoad',
  'formatCount',
  'format',
  'displayText',
];

/**
 * A first argument that is definitely not a provenanced quantity.
 *
 * Deliberately narrow: this flags what is provably wrong rather than guessing
 * at what might be. A bare identifier is NOT flagged, because `formatLength(x)`
 * is fine when `x` is a Quantity, and deciding that needs types rather than
 * text. The cases below cannot be a Quantity under any binding.
 */
const RAW_FIRST_ARG = [
  {
    // formatLength(96), formatLength(-4.5), formatLength(1e6)
    pattern: /^-?\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?$/i,
    why: 'a numeric literal',
  },
  {
    // formatLength(a + b) — arithmetic produces a number, not a Quantity.
    // Quantity arithmetic goes through add()/subtract()/scale() in kernel-units.
    pattern: /[+\-*/%]\s*\d|\d\s*[+\-*/%]/,
    why: 'an arithmetic expression on raw numbers',
  },
  {
    // formatLength(q.value) — reaching past the Quantity to its raw count
    // discards the unit and the origin, which is the whole point of the type.
    pattern: /\.value\s*$/,
    why: "the raw .value of a quantity, which discards its unit and origin",
  },
  {
    // formatLength(Number(x)) / parseFloat(x) / parseInt(x)
    pattern: /^(?:Number|parseFloat|parseInt)\s*\(/,
    why: 'a numeric coercion',
  },
];

/**
 * A cast that launders a raw value into a Quantity. These defeat the type
 * checker, so the scan flags them wherever they appear near a formatter.
 */
const LAUNDERING_CAST = /\bas\s+(?:unknown\s+as\s+)?(?:never|any|Quantity)\b/;

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
    } else if (/\.(ts|mts)$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments and string literals so prose mentioning a formatter is not a hit. */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

/**
 * Extract the first argument of a call, balancing brackets so a nested call is
 * not truncated at its own comma.
 */
function firstArgument(source, openIndex) {
  let depth = 0;
  let start = openIndex + 1;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i).trim();
    } else if (ch === ',' && depth === 1) {
      return source.slice(start, i).trim();
    }
  }
  return null;
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

export function lintProvenance() {
  const violations = [];
  const scanned = [];

  for (const root of SCAN_ROOTS) {
    for (const file of listFiles(join(ROOT, root))) {
      const rel = relative(ROOT, file).split(sep).join('/');
      // The formatters' own package defines and tests them; scanning it would
      // flag every unit test of the formatter itself.
      if (rel.startsWith('packages/kernel-units/')) continue;
      scanned.push(rel);

      const code = stripNonCode(readFileSync(file, 'utf8'));

      for (const fn of FORMATTERS) {
        const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
        let m;
        while ((m = re.exec(code)) !== null) {
          const open = m.index + m[0].length - 1;
          const arg = firstArgument(code, open);
          if (arg === null || arg === '') continue;

          for (const { pattern, why } of RAW_FIRST_ARG) {
            if (pattern.test(arg)) {
              violations.push(
                `${rel}:${lineOf(code, m.index)}: ${fn}() is applied to ${why} ` +
                  `(\`${arg.slice(0, 40)}\`). A formatter takes a provenanced Quantity, ` +
                  'so an unestablished value can render VERIFY instead of a numeral.',
              );
              break;
            }
          }

          if (LAUNDERING_CAST.test(arg)) {
            violations.push(
              `${rel}:${lineOf(code, m.index)}: ${fn}() is applied to a cast value ` +
                `(\`${arg.slice(0, 40)}\`). A cast launders a raw value past the type ` +
                'checker; the provenance it carries is then fiction.',
            );
          }
        }
      }
    }
  }

  return { violations, scanned };
}

function main() {
  const { violations, scanned } = lintProvenance();

  // A scan that matches nothing reports success while enforcing nothing. That
  // failure is silent and permanent, so refuse to pass on an empty scan.
  if (scanned.length === 0) {
    console.error(
      'lint-provenance: matched no source files. Refusing to report a pass for ' +
        'a scan that checked nothing.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`lint-provenance: scanned ${scanned.length} file(s).`);

  if (violations.length > 0) {
    console.error('\nlint-provenance: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }

  console.log('lint-provenance: PASS');
}

if (process.argv[1]?.endsWith('lint-provenance.mjs')) {
  main();
}
