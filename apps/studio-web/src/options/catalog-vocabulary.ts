/**
 * Controlled vocabulary for Option Builder (Blueprint §15.2 Step 4, §15.3 D-03, FR-CP-05).
 *
 * Sourced directly from the pinned Interlake Mecalux catalog release (`interlake-2026-08`).
 * Free-text dimensional entry is strictly forbidden for configuration parameters:
 * clients pick from published values only.
 *
 * Pure: no I/O, no clock, no random.
 */

/**
 * Published beam spans in inches, sorted ascending.
 * Note: 108" and 114" are published; 110" is NOT published (Demo Beat 5).
 */
export const PUBLISHED_BEAM_SPANS_IN: readonly number[] = Object.freeze([
  48, 54, 60, 66, 72, 78, 84, 92, 96, 102, 108, 114, 120, 126, 132, 138, 144, 150, 156, 162, 168,
]);

/** Published standard frame depths in inches. 42" is standard for 48x40 pallets. */
export const PUBLISHED_FRAME_DEPTHS_IN: readonly number[] = Object.freeze([
  36, 42, 44, 48, 54, 60,
]);

/** Published standard frame upright heights in inches. */
export const PUBLISHED_FRAME_HEIGHTS_IN: readonly number[] = Object.freeze([
  96, 120, 144, 168, 192, 216, 240, 264, 288, 312, 336, 360,
]);

/** Published roll-formed beam face heights in inches. */
export const PUBLISHED_BEAM_FACES_IN: readonly number[] = Object.freeze([
  2.75, 3.65, 4.0, 4.5, 5.0, 5.92, 6.54,
]);

/** Scope per OD-03: floor level plus 2–6 beam levels, uniform bays within a run. */
export const MIN_BEAM_LEVELS = 2;
export const MAX_BEAM_LEVELS = 6;

/** Default standard counterbalance forklift aisle width in inches (10 ft). */
export const DEFAULT_AISLE_WIDTH_IN = 120;

export type RackConfigurationType = 'back_to_back' | 'single_deep';

export interface RackConfigurationChoice {
  readonly type: RackConfigurationType;
  readonly label: string;
  readonly description: string;
}

export const RACK_CONFIGURATIONS: readonly RackConfigurationChoice[] = Object.freeze([
  {
    type: 'back_to_back',
    label: 'Selective — Back-to-Back',
    description: 'Two rows back-to-back sharing a flue space. Maximum density for selective rack.',
  },
  {
    type: 'single_deep',
    label: 'Selective — Single Row',
    description: 'Single row against a wall or standalone run with dedicated aisle access.',
  },
]);
