import { migrate, type StudioDocument } from '@rms/studio-model';
import { useMemo } from 'react';

import { PlanCanvas } from '../plan/plan-canvas.js';
import fixture from '../../../../fixtures/continuity/rack-studio-v1.json';

/**
 * The plan view.
 *
 * **The document is the continuity fixture, migrated v1 → v2 at load.** That is
 * a scaffold and it is labelled as one on screen: S6 replaces it with the
 * revision API and OPFS autosave. Using the real fixture rather than a
 * hand-written sample is deliberate — it is the same document the migration and
 * command suites run against, so what is drawn here is what those tests assert,
 * not a second sample that could drift from them.
 */
export default function PlanView(): React.JSX.Element {
  const doc = useMemo<StudioDocument>(() => migrate(fixture.document).document, []);

  return (
    <section className="plan-view" aria-labelledby="view-heading-plan">
      <h1 id="view-heading-plan" className="visually-hidden">
        Plan
      </h1>
      <p className="scaffold-note">
        <b>Scaffold document.</b> This is the rack-studio-v1 continuity fixture, migrated to v2 at
        load. Editing, persistence and the revision API arrive in later slices — nothing here is
        saved.
      </p>
      <PlanCanvas document={doc} />
    </section>
  );
}
