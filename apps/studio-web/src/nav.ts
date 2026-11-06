/**
 * The studio's navigation: job STEPS, each owning one or more routed VIEWS.
 *
 * ADR-020 (2026-11-06) replaced the artifact's six flat tabs with the order of
 * the job itself. Blueprint §5.4 already framed the routes that way — "each of
 * the eight §15.2 steps is a lazily-loaded route chunk" — and the six-tab order
 * was the build plan's, not the blueprint's. Facility and Options, routed but
 * reachable only by typing an address before ADR-020, are steps one and two.
 *
 * Declared as DATA rather than as JSX so the order is a test, not a screenshot.
 * `artifactId` keeps the prototype's element ids where it had them: the 22
 * prototype interaction checks address the screen by those ids.
 *
 * Pure: no I/O, no clock, no RNG.
 */

export interface StudioView {
  /** URL segment, and the lazy chunk's name. */
  readonly path: string;
  /** The label shown where the view is one of several inside a step. */
  readonly label: string;
  /** The artifact's element id, where the artifact had one. */
  readonly artifactId: string | null;
  /** What the view is for, used as the link's accessible description. */
  readonly description: string;
}

export interface JobStep {
  /** Stable id; the step link's DOM id is `step-${id}`. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** The views this step owns, the first being where the step link goes. */
  readonly views: readonly string[];
}

export const VIEWS: readonly StudioView[] = Object.freeze([
  {
    path: 'facility',
    label: 'Facility',
    artifactId: null,
    description: 'Building, fire protection and handling units — every field answerable as not known',
  },
  {
    path: 'options',
    label: 'Options',
    artifactId: null,
    description: 'Controlled rack options over the pinned catalog release',
  },
  {
    path: 'plan',
    label: 'Plan',
    artifactId: 'tab-plan',
    description: 'The plan view — runs, aisles and flues in world coordinates',
  },
  {
    path: 'elevation',
    label: 'Elevation',
    artifactId: 'tab-elev',
    description: 'The elevation view — beam levels, loads and reference elevations',
  },
  {
    path: 'screening',
    label: 'Checks',
    artifactId: null,
    description: 'Every screening finding, grouped by status, each with what closes it',
  },
  {
    path: 'bom',
    label: 'Takeoff',
    artifactId: null,
    description: 'The internal takeoff, with its unresolved register',
  },
  {
    path: 'sheets',
    label: 'Sheets',
    artifactId: 'tab-sheet',
    description: 'The preliminary sheet set with the title block',
  },
  {
    path: 'revisions',
    label: 'Review & submit',
    artifactId: null,
    description: 'What must be fixed, answered or acknowledged before P01 can be locked',
  },
]);

export const STEPS: readonly JobStep[] = Object.freeze([
  { id: 'facility', label: 'Facility', description: 'Tell us about the building', views: ['facility'] },
  { id: 'options', label: 'Options', description: 'Build the rack options to compare', views: ['options'] },
  {
    id: 'layout',
    label: 'Layout',
    description: 'Plan, elevation and the checks against them',
    views: ['plan', 'elevation', 'screening'],
  },
  { id: 'takeoff', label: 'Takeoff', description: 'Quantities and the unresolved register', views: ['bom'] },
  { id: 'sheets', label: 'Sheets', description: 'The preliminary sheet set', views: ['sheets'] },
  {
    id: 'submit',
    label: 'Review & submit',
    description: 'Fix, answer and acknowledge, then lock the preliminary revision',
    views: ['revisions'],
  },
]);

/** The view a bare `/` redirects to. */
export const DEFAULT_VIEW = 'plan';

/** Step order, as ids. The header renders this and the test asserts it. */
export const STEP_ORDER: readonly string[] = Object.freeze(STEPS.map((s) => s.id));

/** Look a view up by path. Returns undefined rather than a default. */
export function viewByPath(path: string): StudioView | undefined {
  return VIEWS.find((v) => v.path === path);
}

/** The step that owns a view path, or undefined for a path no step owns. */
export function stepForPath(path: string): JobStep | undefined {
  return STEPS.find((s) => s.views.includes(path));
}

/**
 * The header's focusable controls, in DOM order.
 *
 * Job, then the steps, then the views inside the active step (Layout on the
 * default route), then undo, save and theme last — a keyboard user reaches the
 * destructive-ish controls after the navigation, which is the artifact's rule
 * and the reason the order is pinned here rather than left to JSX.
 */
export const HEADER_CONTROL_ORDER: readonly string[] = Object.freeze([
  'jobtag',
  ...STEPS.map((s) => `step-${s.id}`),
  'tab-plan',
  'tab-elevation',
  'tab-screening',
  'undobtn',
  'savebtn',
  'themebtn',
]);
