/**
 * @rms/display-list
 *
 * The renderer-neutral drawing model (C-06, ADR-003). One display list, three
 * renderers: Canvas 2D for plans, inline SVG for elevations, PDF for documents.
 *
 * A renderer consumes this; it may not recompute a dimension. Every text entry
 * carries {text, established}, never a bare string, so an unestablished value
 * renders VERIFY rather than a numeral (AC-07).
 *
 * Pure: no I/O, no clock, no RNG.
 */

export {
  DisplayListError,
  dimension,
  displayList,
  itemsOfKind,
  line,
  point,
  rect,
  text,
  textEntries,
  unestablishedEntries,
  type DisplayItem,
  type DisplayList,
  type ItemKind,
  type Point,
  type ViewKind,
} from './model.js';

export {
  buildDetailedPlan,
  gridRef,
  type DetailAisle,
  type DetailBay,
  type DetailFlue,
  type DetailPallet,
  type DetailRow,
  type DetailRun,
} from './detail.js';

export {
  buildElevation,
  buildPlan,
  type AisleGeometry,
  type LevelGeometry,
  type ReferenceElevation,
  REFERENCE_LABEL_SEPARATION_UM,
  type RunGeometry,
} from './build.js';

export {
  StaggerError,
  narrowestGap,
  stagger,
  type StaggerItem,
  type StaggeredLabel,
} from './stagger.js';
