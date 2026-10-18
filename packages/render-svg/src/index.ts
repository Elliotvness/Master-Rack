/**
 * @rms/render-svg
 *
 * Display list to SVG (ADR-003, T-17). Draws what it is given and derives
 * nothing; never formats a number, so an unestablished value renders VERIFY.
 *
 * Pure: no I/O, no clock, no RNG, no DOM or React dependency.
 */

export {
  computeViewBox,
  escapeXml,
  label,
  renderSvg,
  renderSvgFragment,
  type DisplayText,
  type RenderSvgOptions,
  type SvgPadding,
  type SvgViewBox,
} from './render.js';
