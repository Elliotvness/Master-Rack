/**
 * @rms/render-svg
 *
 * Display list to SVG renderer (ADR-003, T-17).
 *
 * **One display list, three renderers (ADR-003):** this renderer consumes a
 * `DisplayList` (e.g. from `buildElevation` or `buildPlan`) and renders pure
 * SVG markup with one uniform scale on both axes.
 *
 * **A renderer consumes, never recomputes:** it performs no domain arithmetic
 * and no number formatting. Every string rendered on the drawing arrives as a
 * `DisplayText` (`{ text, established }`) from `@rms/display-list`, so any
 * unestablished datum prints `VERIFY` (AC-07).
 *
 * Pure: no I/O, no clock, no RNG, no DOM or React dependency.
 */

import type { DisplayItem, DisplayList } from '@rms/display-list';

export interface DisplayText {
  readonly text: string;
  readonly established: boolean;
}

export interface SvgPadding {
  readonly left?: number;
  readonly right?: number;
  readonly top?: number;
  readonly bottom?: number;
}

export interface SvgViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RenderSvgOptions {
  readonly id?: string;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly padding?: SvgPadding;
  readonly flipY?: boolean;
  readonly fontSize?: number;
  readonly strokeWidth?: number;
  readonly slabDatum?: boolean;
  readonly selectedIds?: ReadonlySet<string>;
}

const DEFAULT_PAD_LEFT = 1_200_000;
const DEFAULT_PAD_RIGHT = 2_600_000;
const DEFAULT_PAD_TOP = 1_200_000;
const DEFAULT_PAD_BOTTOM = 600_000;
const DEFAULT_FONT_SIZE = 110_000;
const DEFAULT_STROKE_WIDTH = 22_000;

/**
 * Renders display text, substituting 'VERIFY' for any unestablished datum (AC-07).
 */
export function label(t: DisplayText): string {
  return t.established === true ? t.text : 'VERIFY';
}

/**
 * Escapes characters for safe inclusion in SVG / XML attributes and text nodes.
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Computes the SVG viewBox based on display list extent and padding.
 */
export function computeViewBox(
  extent: { readonly width: number; readonly height: number },
  padding?: SvgPadding,
): SvgViewBox {
  const padLeft = padding?.left ?? DEFAULT_PAD_LEFT;
  const padRight = padding?.right ?? DEFAULT_PAD_RIGHT;
  const padTop = padding?.top ?? DEFAULT_PAD_TOP;
  const padBottom = padding?.bottom ?? DEFAULT_PAD_BOTTOM;

  return {
    x: -padLeft,
    y: -padTop,
    width: extent.width + padLeft + padRight,
    height: extent.height + padTop + padBottom,
  };
}

function renderItem(
  item: DisplayItem,
  extentHeight: number,
  flipY: boolean,
  fontSize: number,
  strokeW: number,
  selected: ReadonlySet<string>,
): string {
  const isSelected = selected.has(item.id);
  const selectedClass = isSelected ? ' selected' : '';
  const flip = (y: number): number => (flipY ? extentHeight - y : y);

  switch (item.kind) {
    case 'line': {
      const y1 = flip(item.from.y);
      const y2 = flip(item.to.y);
      const isThick = item.item === 'upright' || item.item === 'beam';
      const width = isThick ? strokeW * 2 : strokeW;
      const dash =
        item.item === 'reference' ? ` stroke-dasharray="${strokeW * 4} ${strokeW * 2}"` : '';

      return (
        `<line data-item-id="${escapeXml(item.id)}" ` +
        `data-item-kind="${escapeXml(item.item)}" ` +
        `class="elev-line elev-line-${escapeXml(item.item)}${selectedClass}" ` +
        `x1="${item.from.x}" y1="${y1}" x2="${item.to.x}" y2="${y2}" ` +
        `stroke-width="${width}"${dash} />`
      );
    }

    case 'rect': {
      const topY = flip(item.origin.y + (flipY ? item.height : 0));
      const dash =
        item.item === 'unit-load' ? ` stroke-dasharray="${strokeW * 3} ${strokeW * 2}"` : '';

      let xml =
        `<g data-item-id="${escapeXml(item.id)}" data-item-kind="${escapeXml(item.item)}">` +
        `<rect class="elev-rect elev-rect-${escapeXml(item.item)}${selectedClass}" ` +
        `x="${item.origin.x}" y="${topY}" width="${item.width}" height="${item.height}" ` +
        `stroke-width="${strokeW}"${dash} />`;

      if (item.label !== null) {
        const textClass = item.label.established
          ? 'elev-text'
          : 'elev-text elev-text-unestablished';
        const midX = item.origin.x + item.width / 2;
        const midY = topY + item.height / 2;
        xml +=
          `<text class="${textClass}" data-established="${item.label.established}" ` +
          `x="${midX}" y="${midY}" font-size="${fontSize}" text-anchor="middle">` +
          `${escapeXml(label(item.label))}</text>`;
      }

      xml += '</g>';
      return xml;
    }

    case 'dimension': {
      const y1 = flip(item.from.y);
      const y2 = flip(item.to.y);
      const midY = (y1 + y2) / 2;
      const textClass = item.text.established
        ? 'elev-text'
        : 'elev-text elev-text-unestablished';

      return (
        `<g data-item-id="${escapeXml(item.id)}" data-item-kind="dimension" class="elev-dim${selectedClass}">` +
        `<line class="elev-dim-line" x1="${item.from.x}" y1="${y1}" x2="${item.to.x}" y2="${y2}" stroke-width="${strokeW}" />` +
        `<text class="${textClass}" data-established="${item.text.established}" ` +
        `x="${item.to.x - strokeW * 3}" y="${midY}" font-size="${fontSize}" text-anchor="end">` +
        `${escapeXml(label(item.text))}</text></g>`
      );
    }

    case 'text': {
      const y = flip(item.at.y);
      const textClass = item.text.established
        ? 'elev-text'
        : 'elev-text elev-text-unestablished';

      return (
        `<text data-item-id="${escapeXml(item.id)}" data-item-kind="text" class="${textClass}${selectedClass}" ` +
        `data-established="${item.text.established}" ` +
        `x="${item.at.x + strokeW * 2}" y="${y}" font-size="${fontSize}">` +
        `${escapeXml(label(item.text))}</text>`
      );
    }
  }
}

/**
 * Renders the child SVG nodes of a display list as an XML fragment string.
 */
export function renderSvgFragment(
  list: DisplayList,
  options?: RenderSvgOptions,
): string {
  const flipY = options?.flipY ?? (list.view === 'elevation');
  const fontSize = options?.fontSize ?? DEFAULT_FONT_SIZE;
  const strokeW = options?.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const selected = options?.selectedIds ?? new Set<string>();
  const flip = (y: number): number => (flipY ? list.extent.height - y : y);

  const parts: string[] = [];

  // Slab datum line (rendered for elevation views when slabDatum is true or unset)
  const renderSlab = options?.slabDatum ?? (list.view === 'elevation');
  if (renderSlab) {
    const padLeft = options?.padding?.left ?? DEFAULT_PAD_LEFT;
    const padRight = options?.padding?.right ?? DEFAULT_PAD_RIGHT;
    parts.push(
      `<line class="elev-slab" x1="${-padLeft / 2}" y1="${flip(0)}" ` +
        `x2="${list.extent.width + padRight / 2}" y2="${flip(0)}" stroke-width="${strokeW}" />`,
    );
  }

  for (const item of list.items) {
    parts.push(renderItem(item, list.extent.height, flipY, fontSize, strokeW, selected));
  }

  return parts.join('');
}

/**
 * Renders a display list as a complete, standalone SVG document or inline `<svg>`.
 */
export function renderSvg(
  list: DisplayList,
  options?: RenderSvgOptions,
): string {
  const vb = computeViewBox(list.extent, options?.padding);
  const idAttr = options?.id ? ` id="${escapeXml(options.id)}"` : '';
  const classAttr = options?.className ? ` class="${escapeXml(options.className)}"` : ' class="elevation-svg"';
  const labelAttr = options?.ariaLabel
    ? ` aria-label="${escapeXml(options.ariaLabel)}"`
    : ` aria-label="${escapeXml(list.view)} drawing"`;

  const inner = renderSvgFragment(list, options);

  return (
    `<svg${idAttr}${classAttr} viewBox="${vb.x} ${vb.y} ${vb.width} ${vb.height}" ` +
    `preserveAspectRatio="xMidYMid meet" role="img"${labelAttr}>` +
    inner +
    '</svg>'
  );
}
