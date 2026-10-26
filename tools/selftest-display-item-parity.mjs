#!/usr/bin/env node
/**
 * selftest-display-item-parity — prove the parity checker catches the thing it
 * exists for.
 *
 * The thing: `@rms/display-list` grows an item kind, the client DTO's
 * `ITEM_KINDS` enum does not, and the response guard quietly refuses a view the
 * server itself built. That is F-62, found 2026-10-26 with three kinds already
 * missing, and the repository's own history says why a self-test comes with it:
 * a checker nobody can prove goes red reports a clean pass forever.
 *
 * Fixtures rather than the real files, because the cases include a model and a
 * DTO that DISAGREE — which the tree, now corrected, cannot provide. The last
 * case reads the real tree as well, so a green fixture run cannot hide a
 * checker that has lost its grip on the actual sources.
 *
 * Runs first, before the checker, like every self-test here.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DTO_SOURCE,
  MODEL_SOURCE,
  dtoKindList,
  modelItemKinds,
  parityViolations,
  stripComments,
} from './check-display-item-parity.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** A model union written the way the real one is: a member per line, with docblocks between. */
function modelFixture(kinds) {
  const members = kinds
    .map((k) => `  /** what a ${k} is, at length. */\n  | '${k}'`)
    .join('\n');
  return `export type ItemKind =\n${members};\n\nexport type ViewKind = 'plan' | 'elevation';\n`;
}

function dtoFixture(transported, withheld) {
  const t = transported.map((k) => `'${k}'`).join(', ');
  const parts = [`const ITEM_KINDS = [${t}] as const;`];
  if (withheld !== null) {
    const w = withheld.map((k) => `'${k}'`).join(', ');
    parts.push(`const ITEM_KINDS_NOT_TRANSPORTED = [${w}] as const;`);
  }
  return `${parts.join('\n\n')}\n`;
}

const FULL = ['upright', 'beam', 'unit-load', 'flue', 'reference', 'annotation'];

function fixture(files) {
  return (rel) => (Object.hasOwn(files, rel) ? files[rel] : null);
}

const CASES = [
  {
    name: 'F-62 itself: the model draws a kind the client wire does not carry',
    meaning: 'the response guard refuses the server’s own elevation view and step 5 cannot ship',
    files: {
      [MODEL_SOURCE]: modelFixture(FULL),
      [DTO_SOURCE]: dtoFixture(['upright', 'beam', 'annotation'], null),
    },
    expect: 'FAIL',
    contains: 'neither carries nor withholds',
  },
  {
    name: 'the wire carries a kind the model cannot produce',
    meaning: 'the contract promises a shape nothing can draw',
    files: {
      [MODEL_SOURCE]: modelFixture(FULL),
      [DTO_SOURCE]: dtoFixture([...FULL, 'hologram'], null),
    },
    expect: 'FAIL',
    contains: 'not an item kind',
  },
  {
    name: 'a withheld kind the model no longer declares',
    meaning: 'a stale exclusion reads as a decision about something that exists',
    files: {
      [MODEL_SOURCE]: modelFixture(FULL),
      [DTO_SOURCE]: dtoFixture(FULL, ['retired-kind']),
    },
    expect: 'FAIL',
    contains: 'no longer declares',
  },
  {
    name: 'a kind listed as both transported and withheld',
    meaning: 'two lists disagree and whichever is read last wins',
    files: {
      [MODEL_SOURCE]: modelFixture(FULL),
      [DTO_SOURCE]: dtoFixture(FULL, ['flue']),
    },
    expect: 'FAIL',
    contains: 'both transported and withheld',
  },
  {
    name: 'the model union cannot be parsed',
    meaning: 'a parse failure is a failure, not a skip — the F-43 shape',
    files: {
      [MODEL_SOURCE]: 'export type SomethingElse = string;\n',
      [DTO_SOURCE]: dtoFixture(FULL, null),
    },
    expect: 'FAIL',
    contains: 'could not read',
  },
  {
    name: 'ITEM_KINDS is present but empty',
    meaning: 'an empty vocabulary passes every kind by vacuity',
    files: {
      [MODEL_SOURCE]: modelFixture(FULL),
      [DTO_SOURCE]: dtoFixture([], null),
    },
    expect: 'FAIL',
    contains: 'non-empty array',
  },
  {
    name: 'a missing DTO file',
    meaning: 'a checker that inspected nothing must not pass',
    files: { [MODEL_SOURCE]: modelFixture(FULL) },
    expect: 'FAIL',
    contains: 'refusing to pass a check that inspected nothing',
  },
  {
    name: 'the honest green: every model kind carried',
    meaning: 'the checker must not cry wolf on a correct tree',
    files: {
      [MODEL_SOURCE]: modelFixture(FULL),
      [DTO_SOURCE]: dtoFixture(FULL, null),
    },
    expect: 'PASS',
    contains: null,
  },
  {
    name: 'the other honest green: a kind withheld with a reason',
    meaning: 'withholding is a legal audience decision, as long as one was made',
    files: {
      [MODEL_SOURCE]: modelFixture(FULL),
      [DTO_SOURCE]: dtoFixture(
        FULL.filter((k) => k !== 'flue'),
        ['flue'],
      ),
    },
    expect: 'PASS',
    contains: null,
  },
];

let failures = 0;

for (const c of CASES) {
  const violations = parityViolations(fixture(c.files));
  const verdict = violations.length > 0 ? 'FAIL' : 'PASS';
  if (verdict !== c.expect) {
    failures += 1;
    console.error(`  MISS  ${c.name}`);
    console.error(`        expected ${c.expect}, got ${verdict} — ${c.meaning}`);
    for (const v of violations) console.error(`        ${v}`);
    continue;
  }
  if (c.contains !== null && !violations.some((v) => v.includes(c.contains))) {
    failures += 1;
    console.error(`  MISS  ${c.name}`);
    console.error(`        caught it, but no message contained ${JSON.stringify(c.contains)}`);
    for (const v of violations) console.error(`        ${v}`);
    continue;
  }
  console.log(`  ok    ${c.name}`);
}

/** Comments must not be read as declarations — this file names kinds in prose. */
if (stripComments("/* const ITEM_KINDS = ['planted'] as const; */\n").includes('planted')) {
  failures += 1;
  console.error('  MISS  stripComments left a commented declaration in place');
} else {
  console.log('  ok    a commented-out declaration is not a declaration');
}

/**
 * Read-only against the REAL tree: every fixture above could pass while the
 * parsers had lost their grip on the actual two files, which is the blind spot
 * a fixtures-only self-test always has.
 */
const readReal = (rel) => {
  const p = join(ROOT, ...rel.split('/'));
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const realModelText = readReal(MODEL_SOURCE);
const realDtoText = readReal(DTO_SOURCE);
if (realModelText === null || realDtoText === null) {
  failures += 1;
  console.error('  MISS  real tree: one of the two sources is missing');
} else {
  const kinds = modelItemKinds(realModelText);
  const transported = dtoKindList(realDtoText, 'ITEM_KINDS');
  if (kinds === null || kinds.length === 0) {
    failures += 1;
    console.error(`  MISS  real tree: parsed no item kinds out of ${MODEL_SOURCE}`);
  } else if (transported === null || transported.length === 0) {
    failures += 1;
    console.error(`  MISS  real tree: parsed no ITEM_KINDS out of ${DTO_SOURCE}`);
  } else {
    console.log(
      `  reachable   real tree: ${String(kinds.length)} model kind(s), ` +
        `${String(transported.length)} carried on the client wire`,
    );
  }
}

if (failures > 0) {
  console.error(`\nselftest-display-item-parity: FAIL — ${String(failures)} case(s) not caught.`);
  process.exitCode = 1;
} else {
  console.log(`\nselftest-display-item-parity: PASS — ${String(CASES.length + 1)} cases, real sources reachable.`);
}
