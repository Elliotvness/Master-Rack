/**
 * The screening-only notice.
 *
 * Always visible, on every view, never dismissible — the artifact's
 * `.banner-note` behaves the same way and it is the one piece of chrome that
 * must not become a preference. ADR-002: this product screens, it does not
 * design, and the sentence that says so cannot be behind a "don't show again".
 *
 * The wording is held by `check-language`, which forbids "code compliant",
 * "engineered", "approved", "certified" and "PE" as claims this design cannot
 * support.
 */
export function Banner(): React.JSX.Element {
  return (
    <p className="banner-note" role="note">
      <b>Preliminary screening only.</b> This tool produces a preliminary layout for review. It is
      not an engineering, structural, seismic, anchorage, slab or fire-protection design, and
      nothing it outputs is a substitute for review by the manufacturer, the engineer of record,
      the fire-protection designer or the authority having jurisdiction.
    </p>
  );
}
