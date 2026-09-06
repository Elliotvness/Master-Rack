/**
 * Pushing labels apart so none overprints another.
 *
 * An elevation carries three reference heights — underside of structure,
 * sprinkler deflector, maximum top of storage — and on a real building two of
 * them are often within a few inches of each other. Drawn at their true
 * elevations the labels overlap, and two overlapping labels are worse than one
 * missing label: the reader cannot tell which number belongs to which line, and
 * both look legible.
 *
 * This is S3.3's stated acceptance criterion — *"the three reference lines never
 * overprint"* — expressed as a function so it is a test rather than a look at a
 * screenshot.
 *
 * **The line does not move; only its label does.** The reference elevation is a
 * model value and is drawn where it belongs. What is displaced is the text, and
 * a leader joins the two so the association survives the displacement. A
 * renderer that drew the label without the leader would be showing a number at
 * an elevation that is not the one it names.
 *
 * Pure: no I/O, no clock, no RNG.
 */

export interface StaggerItem<T = undefined> {
  readonly id: string;
  /** The true model elevation, in micrometres. Never changed. */
  readonly at: number;
  /**
   * Whatever the caller needs back, carried through untouched.
   *
   * It exists so the caller never has to look the item up again. A lookup
   * returns `T | undefined` and forces a branch for a case that cannot happen —
   * `stagger` returns every input exactly once — and a branch no input can
   * reach is a branch no test can honestly cover.
   */
  readonly payload: T;
}

export interface StaggeredLabel<T = undefined> {
  readonly id: string;
  /** The true elevation, unchanged, where the reference line is drawn. */
  readonly at: number;
  /** Where the label text goes. Equal to `at` when nothing was in the way. */
  readonly label: number;
  /** How far the label was pushed. Zero when it did not move. */
  readonly displaced: number;
  readonly payload: T;
}

export class StaggerError extends Error {
  override readonly name = 'StaggerError';
}

/**
 * Place labels so consecutive ones are at least `minSeparation` apart.
 *
 * **Biased upward, deliberately.** The sweep runs from the lowest elevation up
 * and pushes a colliding label higher, never lower. Two reasons, and the second
 * is the one that matters: a label pushed *down* would drift toward the beam
 * levels and pallet loads that occupy the body of the elevation, where it has
 * something to collide with that this function cannot see; above the top
 * reference there is only empty sheet. And a consistent direction is
 * predictable — a reader learns that a crowded label sits slightly high, rather
 * than having to work out which way it went this time.
 *
 * **Order is preserved by construction**, which is the property that actually
 * protects the reader. If staggering could reorder labels, the topmost text
 * might name the lowest line, and every number on the sheet would still be
 * correct while the drawing said something false.
 */
export function stagger<T>(
  items: readonly StaggerItem<T>[],
  minSeparation: number,
): readonly StaggeredLabel<T>[] {
  if (!Number.isFinite(minSeparation) || minSeparation < 0) {
    throw new StaggerError(
      `minSeparation must be a non-negative finite number, got ${String(minSeparation)}`,
    );
  }
  for (const item of items) {
    if (!Number.isInteger(item.at)) {
      throw new StaggerError(
        `${item.id}: elevation must be an integer micrometre value, got ${String(item.at)} — ` +
          'a fractional model coordinate means someone converted to pixels early',
      );
    }
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new StaggerError(`duplicate id ${JSON.stringify(item.id)}`);
    seen.add(item.id);
  }

  // Sorted by elevation, ties broken by id so the result does not depend on
  // the caller's array order — two references at exactly the same height must
  // stagger the same way every run, or the drawing is not reproducible.
  const ordered = [...items].sort((a, b) => (a.at === b.at ? (a.id < b.id ? -1 : 1) : a.at - b.at));

  const out: StaggeredLabel<T>[] = [];
  let floor = Number.NEGATIVE_INFINITY;

  for (const item of ordered) {
    const label = Math.max(item.at, floor);
    out.push({ id: item.id, at: item.at, label, displaced: label - item.at, payload: item.payload });
    floor = label + minSeparation;
  }

  return out;
}

/**
 * The smallest gap between consecutive labels, or `Infinity` for fewer than two.
 *
 * Exists so a test can assert the property directly rather than re-deriving the
 * sweep and agreeing with itself.
 */
export function narrowestGap(labels: readonly StaggeredLabel<unknown>[]): number {
  if (labels.length < 2) return Number.POSITIVE_INFINITY;
  const sorted = [...labels].sort((a, b) => a.label - b.label);
  let narrowest = Number.POSITIVE_INFINITY;
  for (let i = 1; i < sorted.length; i += 1) {
    narrowest = Math.min(
      narrowest,
      (sorted[i] as StaggeredLabel<unknown>).label - (sorted[i - 1] as StaggeredLabel<unknown>).label,
    );
  }
  return narrowest;
}
