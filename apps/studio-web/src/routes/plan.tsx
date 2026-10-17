import { PlanCanvas } from '../plan/plan-canvas.js';
import { ParamsPanel } from '../plan/params-panel.js';
import { useStudioSession } from '../session-context.js';

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
  const { session, runCommand, onUndo } = useStudioSession();

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
      <div className="plan-layout">
        <ParamsPanel document={session.document} onCommand={runCommand} />
        <PlanCanvas document={session.document} onCommand={runCommand} onUndo={onUndo} />
      </div>
    </section>
  );
}
