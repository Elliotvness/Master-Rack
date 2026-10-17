import { ElevationSvg } from '../elevation/elevation-svg.js';
import { useStudioSession } from '../session-context.js';

/**
 * The elevation view — build-plan **S3.3**.
 *
 * Renders one bay in section as inline SVG from `@rms/display-list`'s
 * `buildElevation`, with staggered reference elevation labels, floor-storage
 * dashed load rectangle, and `VERIFY` for any unestablished datum (AC-07).
 */
export default function ElevationView(): React.JSX.Element {
  const { session } = useStudioSession();
  const doc = session.document;
  const bt = doc.bayTypes[0];

  return (
    <section className="elevation-view" aria-labelledby="view-heading-elevation">
      <div className="elevation-header">
        <h1 id="view-heading-elevation" className="elevation-title">
          Elevation
        </h1>
        {bt !== undefined && (
          <span className="elevation-sub">
            {bt.name} · {bt.uprightPart} · {bt.beamPart} · {bt.beamLevels.length} beam levels
          </span>
        )}
      </div>

      <div className="elevation-stage">
        <ElevationSvg document={doc} id="elevsvg" />
      </div>
    </section>
  );
}
