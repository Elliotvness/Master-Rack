/**
 * The studio's views, in tab order.
 *
 * Declared as DATA rather than as JSX so that "the tab order matches the
 * artifact" is a test rather than a screenshot. The `artifactId` column carries
 * the artifact's own element ids: the 22 prototype interaction checks address
 * the screen by those ids, and keeping them means S4 can bring those checks
 * across with a selector change and nothing else.
 *
 * Three of the six had no artifact tab — the prototype reached screening, the
 * BOM and revisions by other means. Those carry `null`, which is an honest
 * absence rather than an invented id.
 *
 * Pure: no I/O, no clock, no RNG.
 */

export interface StudioView {
  /** URL segment, and the lazy chunk's name. */
  readonly path: string;
  /** The tab label. */
  readonly label: string;
  /** The artifact's element id, where the artifact had one. */
  readonly artifactId: string | null;
  /** What the view is for, used as the tab's accessible description. */
  readonly description: string;
}

export const VIEWS: readonly StudioView[] = Object.freeze([
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
    path: 'sheets',
    label: 'Sheets',
    artifactId: 'tab-sheet',
    description: 'R-101, R-201 and R-501 with the title block',
  },
  {
    path: 'screening',
    label: 'Screening',
    artifactId: null,
    description: 'Findings, grouped by status, each with its derivation chain',
  },
  {
    path: 'bom',
    label: 'BOM',
    artifactId: null,
    description: 'The internal takeoff, with its unresolved register',
  },
  {
    path: 'revisions',
    label: 'Revisions',
    artifactId: null,
    description: 'Revision history and the differences between them',
  },
]);

/** The view a bare `/` redirects to. */
export const DEFAULT_VIEW = 'plan';

/** Tab order, as paths. The header renders this and the test asserts it. */
export const TAB_ORDER: readonly string[] = Object.freeze(VIEWS.map((v) => v.path));

/**
 * The header's focusable controls, in DOM order, with the artifact's ids.
 *
 * The artifact's order is: job tag, the three view tabs, undo, save, theme.
 * A keyboard user reaches the destructive-ish controls last, which is the right
 * order and the reason it is pinned here rather than left to JSX ordering.
 */
export const HEADER_CONTROL_ORDER: readonly string[] = Object.freeze([
  'jobtag',
  ...VIEWS.map((v) => `tab-${v.path}`),
  'undobtn',
  'savebtn',
  'themebtn',
]);

/** Look a view up by path. Returns undefined rather than a default. */
export function viewByPath(path: string): StudioView | undefined {
  return VIEWS.find((v) => v.path === path);
}
