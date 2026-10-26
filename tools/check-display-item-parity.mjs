#!/usr/bin/env node
/**
 * check-display-item-parity — the client wire's drawing vocabulary may not
 * drift from the model's, silently.
 *
 * `apps/api/src/dto/client.ts` restates `@rms/display-list`'s `ItemKind` union
 * by hand, and says so: *"The union is closed in `@rms/display-list`; it is
 * re-stated here rather than spread so a new variant or a new field on an old
 * one is a change to THIS file, which is a review point."* Restating it is the
 * right call — a transport that widens automatically when the model widens has
 * no review point at all, and the client audience is exactly where one belongs.
 *
 * But a review point is not a control, and this one had already failed. Found
 * 2026-10-26 (F-62): the model declares **nine** item kinds and the DTO's
 * `ITEM_KINDS` enum carried **six**. The three the elevation builder emits —
 * `unit-load`, `flue` and `reference` — were absent, so the response guard
 * would refuse the server's own elevation view, and §15.2 step 5 is the
 * "plan/elevation preview". Nothing caught it: the TypeScript type says
 * `item: string`, so the compiler had no opinion, and the only place the two
 * lists met was prose.
 *
 * So this checker asks the two source files, and requires every model kind to
 * be ACCOUNTED FOR on the wire — either transported (`ITEM_KINDS`) or
 * deliberately withheld with a reason (`ITEM_KINDS_NOT_TRANSPORTED`). A kind
 * added to the model next month fails this until somebody says which it is,
 * which is the review point the comment always claimed.
 *
 * WHAT IT DOES NOT COVER, so nobody reads a green run as more than it is:
 *   - It compares VOCABULARIES, not shapes. A field added to `rect` in the
 *     model and not on the wire is invisible here; that is what the field-by
 *     -field mapper in `toDisplayItemClientDTO` is for.
 *   - It reads the two source files as text. It is not a TypeScript parser —
 *     it strips comments and takes the quoted members of one union and one
 *     array literal. A declaration written in some other shape is a parse
 *     failure, which is a FAILURE here and not a skip.
 *   - It says nothing about whether a withheld kind SHOULD be withheld. That
 *     is an audience decision for a human; this only insists one was made.
 *   - Zero kinds parsed from either side is a FAILURE. A checker that
 *     inspected nothing must not pass.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export const MODEL_SOURCE = 'packages/display-list/src/model.ts';
export const DTO_SOURCE = 'apps/api/src/dto/client.ts';

/** Comments carry example code and prose; neither is a declaration. */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * The quoted members of `export type ItemKind = 'a' | 'b' | …;`.
 *
 * Reads to the terminating semicolon, so a union spread over twenty lines with
 * a docblock between every member — which is how the model actually writes it —
 * parses the same as a one-liner.
 */
export function modelItemKinds(modelText) {
  const src = stripComments(modelText);
  const start = src.search(/export\s+type\s+ItemKind\s*=/);
  if (start < 0) return null;
  const end = src.indexOf(';', start);
  if (end < 0) return null;
  const body = src.slice(start, end);
  const found = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  return found.length > 0 ? found : null;
}

/** The quoted members of a `const NAME = [ … ] as const;` array literal. */
export function dtoKindList(dtoText, name) {
  const src = stripComments(dtoText);
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`);
  const m = re.exec(src);
  if (m === null) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/**
 * Every way the two vocabularies can disagree. `readText` is injected so the
 * self-test can feed fixtures; it returns null for a missing file.
 */
export function parityViolations(readText) {
  const violations = [];

  const modelText = readText(MODEL_SOURCE);
  if (modelText === null) {
    violations.push(`${MODEL_SOURCE}: not found — refusing to pass a check that inspected nothing`);
    return violations;
  }
  const dtoText = readText(DTO_SOURCE);
  if (dtoText === null) {
    violations.push(`${DTO_SOURCE}: not found — refusing to pass a check that inspected nothing`);
    return violations;
  }

  const model = modelItemKinds(modelText);
  if (model === null) {
    violations.push(
      `${MODEL_SOURCE}: could not read \`export type ItemKind\` as a union of quoted members — ` +
        'a parse failure is a failure here, not a skip',
    );
    return violations;
  }

  const transported = dtoKindList(dtoText, 'ITEM_KINDS');
  if (transported === null || transported.length === 0) {
    violations.push(
      `${DTO_SOURCE}: could not read \`const ITEM_KINDS = [...]\` as a non-empty array of quoted members`,
    );
    return violations;
  }

  // Absent is legal and means "nothing is withheld"; unparseable is not.
  const withheldRaw = dtoKindList(dtoText, 'ITEM_KINDS_NOT_TRANSPORTED');
  const withheld = withheldRaw ?? [];

  const modelSet = new Set(model);
  const transportedSet = new Set(transported);
  const withheldSet = new Set(withheld);

  for (const kind of model) {
    if (!transportedSet.has(kind) && !withheldSet.has(kind)) {
      violations.push(
        `'${kind}' is a display-list item kind that the client wire neither carries nor withholds. ` +
          `Add it to ITEM_KINDS in ${DTO_SOURCE}, or to ITEM_KINDS_NOT_TRANSPORTED with the reason ` +
          'the client audience does not receive it.',
      );
    }
  }

  for (const kind of transported) {
    if (!modelSet.has(kind)) {
      violations.push(
        `ITEM_KINDS carries '${kind}', which is not an item kind in ${MODEL_SOURCE}. ` +
          'The wire cannot transport a shape the model cannot produce.',
      );
    }
  }

  for (const kind of withheld) {
    if (!modelSet.has(kind)) {
      violations.push(
        `ITEM_KINDS_NOT_TRANSPORTED withholds '${kind}', which the model no longer declares — ` +
          'a stale exclusion reads as a decision somebody made about something that exists.',
      );
    }
    if (transportedSet.has(kind)) {
      violations.push(
        `'${kind}' is listed as both transported and withheld. One of the two lists is wrong.`,
      );
    }
  }

  return violations;
}

/** Counts for the PASS line, so a green run still says what it measured. */
export function parityCounts(readText) {
  const modelText = readText(MODEL_SOURCE) ?? '';
  const dtoText = readText(DTO_SOURCE) ?? '';
  const model = modelItemKinds(modelText) ?? [];
  const transported = dtoKindList(dtoText, 'ITEM_KINDS') ?? [];
  const withheld = dtoKindList(dtoText, 'ITEM_KINDS_NOT_TRANSPORTED') ?? [];
  return { model: model.length, transported: transported.length, withheld: withheld.length };
}

function main() {
  const readText = (rel) => {
    const p = join(ROOT, ...rel.split('/'));
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const violations = parityViolations(readText);
  if (violations.length > 0) {
    console.error('check-display-item-parity: FAIL');
    for (const v of violations) console.error(`  ${v}`);
    process.exitCode = 1;
    return;
  }
  const c = parityCounts(readText);
  console.log(
    `check-display-item-parity: PASS — ${String(c.model)} model item kind(s), all accounted for: ` +
      `${String(c.transported)} transported, ${String(c.withheld)} withheld with a reason.`,
  );
}

if (process.argv[1]?.split(sep).join('/').endsWith('check-display-item-parity.mjs')) main();
