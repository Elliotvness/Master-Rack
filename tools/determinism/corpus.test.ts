import { describe, expect, it } from 'vitest';

import { canonicalBom, deriveBom, type RunTakeoff } from '@rms/kernel-bom';
import { contentHash, sha256 } from '@rms/kernel-model';
import { grossPositions, positionAccounting } from '@rms/kernel-derive';
import { convert, each, inches } from '@rms/kernel-units';

/**
 * E-09 - the determinism corpus.
 *
 * AC-12 says a BOM must regenerate byte-identically twice on two machines. A
 * test that derives the same corpus twice inside ONE process cannot show that:
 * both runs share a clock, a locale, a timezone and a module cache, so every
 * implicit input they might have leaked is identical by construction and the
 * comparison passes no matter what the code reads.
 *
 * So this file does only half the job, deliberately. It derives the corpus once
 * and prints a digest per case on stdout. `tools/check-determinism.mjs` runs it
 * in two SEPARATE child processes under deliberately hostile and mutually
 * incompatible environments, and compares the digests across them. The other
 * machine is simulated by making this machine behave like a different one.
 *
 * The digests are also pinned in `fixtures/determinism/digests.txt`, which is
 * what turns this from a self-consistency check into a regression check: two
 * runs of a changed engine agree with each other and disagree with the pin.
 * That is the "unintended engine change" half of the acceptance criterion.
 */

/** Emitted for the checker to parse. Kept trivially machine-readable on purpose. */
function emit(name: string, value: string): string {
  const digest = sha256(value);
  // eslint-disable-next-line no-console -- this line IS the interface to check-determinism.mjs.
  console.log(`RMS-DIGEST ${name} ${digest}`);
  return digest;
}

const ref = (id: string) => ({ kind: 'catalog', partRevisionId: id }) as const;

/** Every run shares these refs; the corpus is about the arithmetic, not the parts. */
const REFS = {
  frameRef: ref('frame-rev-1'),
  beamRef: ref('beam-rev-1'),
  anchorRef: ref('anchor-rev-1'),
  deckRef: ref('deck-rev-1'),
  spacerRef: ref('spacer-rev-1'),
  footplateRef: ref('footplate-rev-1'),
} as const;

/**
 * A fixed corpus. The values are arbitrary but PINNED: the point is not that
 * they are realistic, it is that they never change, so a digest change means
 * the engine changed.
 */
const RUNS: readonly RunTakeoff[] = Object.freeze([
  Object.freeze({ runId: 'run-a', bays: 12, rows: 2, beamLevels: 4, ...REFS }),
  Object.freeze({ runId: 'run-b', bays: 7, rows: 1, beamLevels: 3, ...REFS }),
  // A single-bay run: the (bays + 1) frame rule is at its most fragile here.
  Object.freeze({ runId: 'run-c', bays: 1, rows: 1, beamLevels: 1, ...REFS }),
]);

describe('E-09 determinism corpus', () => {
  it('reports the environment it actually observed', () => {
    // The checker claims to run this corpus under hostile environments. That
    // claim is worth nothing unless the hostility ARRIVED: Node ignores LANG
    // and LC_ALL on Windows, so a checker that merely sets them and reports a
    // pass would be certifying a comparison it never performed. So the child
    // reports what it actually sees, and the checker verifies the environments
    // really did differ before trusting that they agreed.
    const opts = Intl.DateTimeFormat().resolvedOptions();
    // eslint-disable-next-line no-console -- this line IS the interface to check-determinism.mjs.
    console.log(
      `RMS-ENV timezone=${opts.timeZone} locale=${opts.locale} ` +
        `offset=${new Date(0).getTimezoneOffset()} decimal=${(1.5).toLocaleString()}`,
    );
    expect(opts.timeZone).toBeTruthy();
  });

  it('BOM derivation over the pinned corpus', () => {
    const digest = emit('bom', canonicalBom(deriveBom(RUNS)));
    expect(digest).toHaveLength(64);
  });

  it('the canonical content hash of a fixed model', () => {
    const digest = emit(
      'content-hash',
      contentHash({
        // Insertion order is deliberately NOT alphabetical: canonicalisation
        // must sort, and a digest that changes when this literal is reordered
        // would mean it does not.
        width: 96,
        depth: 42,
        aisle: 132,
        label: 'Aisle I',
        nested: { z: 1, a: [3, 2, 1] },
      }),
    );
    expect(digest).toHaveLength(64);
  });

  it('position accounting over the pinned corpus', () => {
    const parts: string[] = [];
    for (const run of RUNS) {
      const gross = grossPositions({
        positionsPerBay: 2,
        bayCount: run.bays,
        beamLevels: run.beamLevels,
        // Pinned false: whether the floor stores pallets is a real input, and
        // letting it default would hide a change to that default.
        floorStores: false,
      });
      // Losses are per-run rather than a shared constant because run-c has only
      // two gross positions, and the engine correctly refuses to lose three of
      // them. The corpus is adjusted to be derivable; the refusal is not
      // weakened to accommodate the corpus.
      const acct = positionAccounting(
        gross,
        run.bays > 1
          ? [
              Object.freeze({ reason: 'obstruction', count: each(2) }),
              Object.freeze({ reason: 'clearance', count: each(1) }),
            ]
          : [Object.freeze({ reason: 'obstruction', count: each(1) })],
      );
      parts.push(`${run.runId}:${acct.gross.value}:${acct.lost.value}:${acct.net.value}`);
    }
    const digest = emit('positions', parts.join('|'));
    expect(digest).toHaveLength(64);
  });

  it('unit conversion and formatting', () => {
    // Formatting is where a locale leak shows up first: a tr-TR toLocaleString
    // renders 1.5 as "1,5", and a digest over the formatted string catches it
    // where a digest over the raw number never would.
    //
    // T-27, 2026-09-02: the two lines below read `convert(...).value`, but
    // `convert` returns a `number`, not a `Quantity`. `.value` on a number
    // primitive is `undefined`, so this case digested the literal string
    // "undefined|undefined|3812|2451100|3175" and the pinned digest was pinned
    // over it. The two CONVERSIONS - the only conversions in a case named for
    // them - contributed nothing, and `check:determinism` would not have gone
    // red if `convert` had started returning a different number. Confirmed at
    // runtime before the fix, not inferred from the type error. No test file in
    // this repository had ever been type-checked; that is what T-27 changed.
    const parts = [
      String(convert(inches(132), 'ft')),
      String(convert(inches(1), 'mm')),
      String(each(3812).value),
      String(inches(96.5).value),
      String(inches(0.125).value),
    ];
    const digest = emit('units', parts.join('|'));
    expect(digest).toHaveLength(64);
  });
});
