import { useState } from 'react';

/**
 * The screening-only notice.
 *
 * Rendered in the compact bottom footer bar so it does not consume top-of-page
 * vertical canvas space. The `<p role="note">` element contains no child button,
 * while the footer wrapper allows collapsing the bar during active drafting.
 *
 * The wording is held by `check-language`, which forbids "code compliant",
 * "engineered", "approved", "certified" and "PE" as claims this design cannot
 * support.
 */
export function Banner(): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <footer
      id="studio-screening-footer"
      className={collapsed ? 'banner-footer-bar banner-footer-collapsed' : 'banner-footer-bar'}
    >
      <p className="banner-note" role="note">
        <b>Preliminary screening only.</b> This tool produces a preliminary layout for review. It is
        not an engineering, structural, seismic, anchorage, slab or fire-protection design, and
        nothing it outputs is a substitute for review by the manufacturer, the engineer of record,
        the fire-protection designer or the authority having jurisdiction.
      </p>
      <button
        id="dismiss-screening-banner-btn"
        type="button"
        className="banner-dismiss-btn"
        aria-label={collapsed ? 'Expand screening notice' : 'Minimize screening notice'}
        title={collapsed ? 'Expand screening notice' : 'Minimize screening notice'}
        onClick={() => setCollapsed((prev) => !prev)}
      >
        {collapsed ? 'Notice ▲' : '×'}
      </button>
    </footer>
  );
}
