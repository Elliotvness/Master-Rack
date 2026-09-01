/**
 * The approver's independent verification act, as data.
 *
 * Section 10.2 is emphatic about why a name is not enough: *"running an
 * extraction script sets the digitiser to a machine identity, which lets one
 * person approve data they produced themselves and satisfies the check
 * trivially. A machine is a tool, not an independent party."*
 *
 * The gate as shipped required only that SOME verification path existed with at
 * least one cell. `interlake-2026-09` satisfied it with two machine extractions
 * reconciled by a machine -- materially stronger than one extraction, and
 * genuinely the technique that caught the 72% overstatement in the reference
 * data, but not an independent party. This module is the missing half.
 *
 * Three properties carry the weight, and each exists because its absence is a
 * known way this fails:
 *
 *   1. THE TOOL DRAWS THE SAMPLE. An approver-chosen sample drifts toward the
 *      cells that are easy to read, which are not the cells that are wrong.
 *   2. THE DRAW IS REPRODUCIBLE. A seed is recorded, so a reviewer in two years
 *      can redraw the same cells and see the approver checked what they said.
 *   3. ANY MISMATCH FAILS THE WHOLE RELEASE. No partial pass, no "approve with
 *      notes". One wrong cell means the extract has a defect of unknown extent.
 *
 * Pure: no I/O, no clock, no RNG. The seed is supplied by the caller.
 */

/** How large a sample must be: 20 cells or 5%, whichever is greater (section 10.2). */
export function requiredSampleSize(cells: number): number {
  if (!Number.isInteger(cells) || cells < 0) {
    throw new RangeError(`cell count must be a non-negative integer, got ${cells}`);
  }
  return Math.min(cells, Math.max(20, Math.ceil(cells * 0.05)));
}

/**
 * A small deterministic PRNG (mulberry32).
 *
 * Deliberately NOT Math.random(): the kernel forbids it, and more to the point a
 * sample nobody can redraw is a sample nobody can audit. The seed is recorded on
 * the release, so "show me the cells you checked" is answerable years later.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Draw the cells the approver must check, deterministically from `seed`.
 *
 * Returns them in the order drawn, so the record shows the draw rather than a
 * tidied-up version of it.
 */
export function drawSpotCheckSample(
  cellIds: readonly string[],
  seed: number,
  size = requiredSampleSize(cellIds.length),
): readonly string[] {
  if (cellIds.length === 0) {
    throw new RangeError('cannot draw a sample from an empty cell list');
  }
  if (size > cellIds.length) {
    throw new RangeError(`cannot draw ${size} cells from ${cellIds.length}`);
  }
  if (new Set(cellIds).size !== cellIds.length) {
    // A duplicated id would let one reading stand for two cells.
    throw new RangeError('cell ids must be unique');
  }

  // Partial Fisher-Yates over a copy: every cell equally likely, no cell drawn
  // twice, and the result depends only on (cellIds, seed, size).
  const pool = [...cellIds];
  const rand = mulberry32(seed);
  const drawn: string[] = [];
  for (let i = 0; i < size; i += 1) {
    const j = i + Math.floor(rand() * (pool.length - i));
    const a = pool[i] as string;
    const b = pool[j] as string;
    pool[i] = b;
    pool[j] = a;
    drawn.push(b);
  }
  return Object.freeze(drawn);
}

/**
 * Every reason a recorded spot-check does not satisfy the gate. Empty means it does.
 *
 * `cellIds` is REQUIRED and is the dataset's own cell ids, in file order. Without
 * them this function can only check that a sample is the right SIZE — which is
 * what it did as first shipped, and a review found it accepted twenty cell ids
 * reading `TOTALLY/FAKE/CELL-0` and up. The seed was recorded so the draw could
 * be reproduced, and nothing ever reproduced it.
 *
 * It is a required parameter rather than an optional one on purpose. An optional
 * argument that skips the strongest check when omitted is the same hole with a
 * default value in front of it.
 */
export function spotCheckRefusals(
  check: {
    readonly dataset: string;
    readonly cells: number;
    readonly sampledCells: readonly string[];
    readonly seed: number;
    readonly checkedBy: string;
    readonly outcome: string;
    readonly pageRef: string;
  },
  digitisedBy: string,
  cellIds: readonly string[],
): readonly string[] {
  // NOTE ON SCOPE: this is required of every release, not only of those with a
  // machine digitiser. An earlier draft of this module tried to detect machine
  // identities by pattern and demand the spot-check only for those. That is a
  // heuristic on a free-text field, and it fails in the UNSAFE direction: an
  // unrecognised identity reads as human and the stricter bar is skipped
  // silently. Section 10.2 does not describe the spot-check as a fallback -- it
  // calls the approver's procedure "part of the gate, not a convention" -- so it
  // applies always, and there is no string to get wrong.
  const reasons: string[] = [];
  const required = requiredSampleSize(check.cells);

  if (check.checkedBy.trim() === '') {
    reasons.push(`the spot-check of '${check.dataset}' must name who performed it`);
  }
  if (check.checkedBy === digitisedBy) {
    reasons.push(
      `the spot-check of '${check.dataset}' was performed by the digitiser; a machine is a tool, not an independent party`,
    );
  }
  if (check.sampledCells.length < required) {
    reasons.push(
      `the spot-check of '${check.dataset}' covered ${check.sampledCells.length} cells; ` +
        `${required} are required (20 or 5% of ${check.cells}, whichever is greater)`,
    );
  }
  if (new Set(check.sampledCells).size !== check.sampledCells.length) {
    reasons.push(`the spot-check of '${check.dataset}' lists the same cell more than once`);
  }
  if (check.pageRef.trim() === '') {
    reasons.push(`the spot-check of '${check.dataset}' must name the page it was read from`);
  }

  // The dataset must be the one the record claims to describe. A shrunken
  // `cells` shrinks `requiredSampleSize`, so an approver who edits it downward
  // reads fewer cells and the gate never notices.
  if (check.cells !== cellIds.length) {
    reasons.push(
      `the spot-check of '${check.dataset}' records ${check.cells} cells but the dataset holds ` +
        `${cellIds.length}; the sample size is derived from that number`,
    );
  } else if (new Set(cellIds).size !== cellIds.length) {
    // Not the approver's fault, but the draw is undefined over a list with a
    // repeated id, so nothing downstream can be trusted either.
    reasons.push(
      `the '${check.dataset}' dataset contains a repeated cell id; a draw over it cannot be verified`,
    );
  } else if (check.sampledCells.length >= required) {
    // THE check. Re-derive the draw and compare in order — the draw records the
    // order it drew in precisely so this comparison is possible. Skipped when
    // the sample is already too small, so one defect produces one reason.
    const expected = drawSpotCheckSample(cellIds, check.seed, required);
    const same =
      expected.length === check.sampledCells.length &&
      expected.every((id, i) => id === check.sampledCells[i]);
    if (!same) {
      const strays = check.sampledCells.filter((id) => !cellIds.includes(id));
      reasons.push(
        `the spot-check of '${check.dataset}' does not match the draw for seed ${check.seed}; ` +
          (strays.length > 0
            ? `${strays.length} of the recorded cells are not in the dataset at all ` +
              `(e.g. '${strays[0] ?? ''}')`
            : 'the recorded cells are real but are not the ones the tool drew') +
          '. A sample the approver chose is not a random sample',
      );
    }
  }
  // Any mismatch fails the ENTIRE release. There is no partial pass and no
  // "approve with notes": one wrong cell means a defect of unknown extent.
  if (check.outcome !== 'MATCHED') {
    reasons.push(
      `the spot-check of '${check.dataset}' did not match the source (outcome '${check.outcome}'); ` +
        'any mismatch fails the entire release',
    );
  }
  return Object.freeze(reasons);
}
