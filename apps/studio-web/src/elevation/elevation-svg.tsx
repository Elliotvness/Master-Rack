/**
 * Inline SVG renderer for `buildElevation` display lists — build-plan **S3.3**.
 *
 * **One display list, three renderers (ADR-003):** this component consumes a
 * `DisplayList` produced by `buildElevation` and renders it as inline `<svg>`
 * with one uniform scale on both axes (`preserveAspectRatio="xMidYMid meet"`).
 *
 * It performs **no domain arithmetic and no number formatting** — every string
 * rendered on the drawing arrives as a `DisplayText` (`{ text, established }`)
 * from `@rms/display-list`, so any unestablished datum prints `VERIFY` (AC-07).
 */

import { buildElevation, type DisplayList } from '@rms/display-list';
import { poundsPerPair } from '@rms/kernel-units';
import {
  bayTypeForRun,
  length,
  runGeometry,
  witnessedQuantity,
  type StudioDocument,
} from '@rms/studio-model';
import { useMemo } from 'react';

export function buildDocumentElevation(doc: StudioDocument): DisplayList {
  const run = doc.runs[0];
  const bt = run !== undefined ? bayTypeForRun(doc, run) : doc.bayTypes[0];
  if (run === undefined || bt === undefined) {
    return {
      view: 'elevation',
      extent: { width: 2_590_800, height: 6_096_000 },
      items: [],
      revisionHash: `doc:${doc.id}:${doc.revision}`,
    };
  }

  const g = runGeometry(doc, run);
  const loadQty =
    bt.beamPairCapacity.established === 'UNKNOWN'
      ? null
      : poundsPerPair(bt.beamPairCapacity.value, bt.beamPairCapacity.established);

  return buildElevation({
    revisionHash: `doc:${doc.id}:${doc.revision}`,
    runId: run.id,
    frameHeight: witnessedQuantity(bt.frameHeight),
    bayPitch: g.bayPitch,
    levels: bt.beamLevels.map((elevUm, idx) => ({
      levelId: `${run.id}:L${idx + 1}`,
      elevation: length(elevUm, 'INPUT'),
      load: loadQty,
    })),
    references: [
      {
        id: 'clear-height',
        label: 'Clear height',
        elevation:
          doc.building.clearHeight.established === 'UNKNOWN'
            ? null
            : witnessedQuantity(doc.building.clearHeight),
      },
      {
        id: 'deflector',
        label: 'Sprinkler deflector',
        elevation:
          doc.building.deflectorElev.established === 'UNKNOWN'
            ? null
            : witnessedQuantity(doc.building.deflectorElev),
      },
    ],
    floorStorage: run.floorStorage
      ? {
          height: length(doc.unitLoad.height, 'INPUT'),
          depth: length(doc.unitLoad.palletD, 'INPUT'),
        }
      : null,
  });
}

export function ElevationSvg({
  document: doc,
  id = 'elevsvg',
}: {
  readonly document: StudioDocument;
  readonly id?: string;
}): React.JSX.Element {
  const list = useMemo(() => buildDocumentElevation(doc), [doc]);

  // Model coordinates are integer micrometres with y=0 at the slab.
  // SVG viewBox uses micrometres directly so X and Y share the exact same scale.
  const padLeft = 1_200_000;
  const padRight = 2_600_000;
  const padTop = 1_200_000;
  const padBottom = 600_000;

  const vbX = -padLeft;
  const vbY = -padTop;
  const vbW = list.extent.width + padLeft + padRight;
  const vbH = list.extent.height + padTop + padBottom;

  const flipY = (modelY: number): number => list.extent.height - modelY;
  const fontSize = 110_000;
  const strokeW = 22_000;

  return (
    <svg
      id={id}
      className="elevation-svg"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Bay elevation drawing for ${doc.name}`}
    >
      {/* Slab datum line */}
      <line
        className="elev-slab"
        x1={-padLeft / 2}
        y1={flipY(0)}
        x2={list.extent.width + padRight / 2}
        y2={flipY(0)}
        strokeWidth={strokeW}
      />

      {list.items.map((item) => {
        if (item.kind === 'line') {
          return (
            <line
              key={item.id}
              data-item-id={item.id}
              data-item-kind={item.item}
              className={`elev-line elev-line-${item.item}`}
              x1={item.from.x}
              y1={flipY(item.from.y)}
              x2={item.to.x}
              y2={flipY(item.to.y)}
              strokeWidth={item.item === 'upright' || item.item === 'beam' ? strokeW * 2 : strokeW}
              strokeDasharray={item.item === 'reference' ? `${strokeW * 4} ${strokeW * 2}` : undefined}
            />
          );
        }

        if (item.kind === 'rect') {
          const topY = flipY(item.origin.y + item.height);
          return (
            <g key={item.id} data-item-id={item.id} data-item-kind={item.item}>
              <rect
                className={`elev-rect elev-rect-${item.item}`}
                x={item.origin.x}
                y={topY}
                width={item.width}
                height={item.height}
                strokeWidth={strokeW}
                strokeDasharray={
                  item.item === 'unit-load' ? `${strokeW * 3} ${strokeW * 2}` : undefined
                }
              />
              {item.label !== null && (
                <text
                  className={
                    item.label.established ? 'elev-text' : 'elev-text elev-text-unestablished'
                  }
                  data-established={item.label.established}
                  x={item.origin.x + item.width / 2}
                  y={topY + item.height / 2}
                  fontSize={fontSize}
                  textAnchor="middle"
                >
                  {item.label.text}
                </text>
              )}
            </g>
          );
        }

        if (item.kind === 'dimension') {
          const y1 = flipY(item.from.y);
          const y2 = flipY(item.to.y);
          const midY = (y1 + y2) / 2;
          return (
            <g
              key={item.id}
              data-item-id={item.id}
              data-item-kind="dimension"
              className="elev-dim"
            >
              <line
                className="elev-dim-line"
                x1={item.from.x}
                y1={y1}
                x2={item.to.x}
                y2={y2}
                strokeWidth={strokeW}
              />
              <text
                className={
                  item.text.established ? 'elev-text' : 'elev-text elev-text-unestablished'
                }
                data-established={item.text.established}
                x={item.to.x - strokeW * 3}
                y={midY}
                fontSize={fontSize}
                textAnchor="end"
              >
                {item.text.text}
              </text>
            </g>
          );
        }

        return (
          <text
            key={item.id}
            data-item-id={item.id}
            data-item-kind="text"
            className={item.text.established ? 'elev-text' : 'elev-text elev-text-unestablished'}
            data-established={item.text.established}
            x={item.at.x + strokeW * 2}
            y={flipY(item.at.y)}
            fontSize={fontSize}
          >
            {item.text.text}
          </text>
        );
      })}
    </svg>
  );
}
