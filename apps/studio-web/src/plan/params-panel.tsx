import type { StudioDocument, Witnessed } from '@rms/studio-model';

/**
 * The parameter rail — **read-only**.
 *
 * It renders the document's values and their establishment state, and nothing
 * here can change the document. That is a deliberate slice boundary rather than
 * a shortcut: an editable panel needs a typed `setField` command with an
 * inverse and its own command-bus tests, and shipping the presentation layer
 * first keeps the undo ledger untouched while the layout is settled.
 *
 * **Read-only text and badges, not disabled inputs.** A greyed-out input invites
 * a click and reads as "temporarily unavailable"; a value with a badge reads as
 * what it is — a recorded figure. The difference matters because half these
 * fields are not established, and a disabled input showing an unestablished
 * number would be the worst of both.
 *
 * **Every value goes through its `Witnessed<T>`.** Established shows the value;
 * `UNKNOWN` shows **VERIFY**. This is AC-07 at the panel: the same rule the
 * renderer follows, in the place the artifact's own screen got it wrong once —
 * the elevation printing a real-looking `25'-2"` beside a panel saying VERIFY
 * for the same quantity.
 */

const MICROMETRES_PER_INCH = 25_400;

/** Inches, for display. A stored µm value is exact; this is one-way. */
function inches(micrometres: number): string {
  const n = micrometres / MICROMETRES_PER_INCH;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** A plain, established value. */
function Field({
  label,
  value,
  suffix,
}: {
  readonly label: string;
  readonly value: string;
  readonly suffix?: string;
}): React.JSX.Element {
  return (
    <div className="pf-row">
      <span className="pf-label">{label}</span>
      <span className="pf-value">
        {value}
        {suffix !== undefined && <span className="pf-suffix">{suffix}</span>}
      </span>
    </div>
  );
}

/**
 * A witnessed value: the number when established, VERIFY when not.
 *
 * The unestablished case shows a badge as well as the word, because colour
 * alone is never the carrier (ADR-019 rule 5) and "VERIFY" on its own could be
 * mistaken for a value.
 */
function Witness({
  label,
  witnessed,
  format,
  suffix,
}: {
  readonly label: string;
  readonly witnessed: Witnessed<number> | Witnessed<string>;
  readonly format?: (v: number) => string;
  readonly suffix?: string;
}): React.JSX.Element {
  const established = witnessed.established !== 'UNKNOWN';
  const raw = witnessed.value;
  const shown =
    typeof raw === 'number' ? (format === undefined ? String(raw) : format(raw)) : raw;

  return (
    <div className="pf-row">
      <span className="pf-label">{label}</span>
      {established ? (
        <span className="pf-value">
          {shown}
          {suffix !== undefined && <span className="pf-suffix">{suffix}</span>}
        </span>
      ) : (
        <span className="pf-value pf-unestablished" title={witnessed.source ?? 'Not established'}>
          <span className="pf-badge">VERIFY</span>
          <span className="pf-not-established">Not established</span>
        </span>
      )}
    </div>
  );
}

/** A boolean the document states outright. Not witnessed — it has no VERIFY state. */
function Flag({
  label,
  on,
}: {
  readonly label: string;
  readonly on: boolean;
}): React.JSX.Element {
  return (
    <div className="pf-row">
      <span className="pf-label">{label}</span>
      <span className="pf-value">
        <span className={on ? 'pf-flag pf-flag-on' : 'pf-flag'} aria-hidden="true">
          {on ? '✓' : '—'}
        </span>
        {on ? 'Yes' : 'No'}
      </span>
    </div>
  );
}

export function ParamsPanel({
  document: doc,
}: {
  readonly document: StudioDocument;
}): React.JSX.Element {
  const bt = doc.bayTypes[0];

  return (
    <div className="params">
      <p className="pf-note">
        <b>Read-only.</b> Editing arrives with the <code>setField</code> command and its undo entry.
      </p>

      <section aria-labelledby="pf-project">
        <h2 id="pf-project" className="pf-heading">
          Project
        </h2>
        <Field label="Job" value={doc.name} />
        <Field label="Client" value={doc.client} />
        <Field label="Revision" value={doc.revision} />
      </section>

      <section aria-labelledby="pf-building">
        <h2 id="pf-building" className="pf-heading">
          Building <span className="pf-sub">survey and declaration</span>
        </h2>
        <Witness
          label="Clear internal height"
          witnessed={doc.building.clearHeight}
          format={inches}
          suffix="in"
        />
        <Witness
          label="Sprinkler deflector elev."
          witnessed={doc.building.deflectorElev}
          format={inches}
          suffix="in"
        />
        <Flag label="Building is sprinklered" on={doc.building.sprinklered} />
        <Field label="Flue regime" value={doc.building.insurer} />
        <Witness label="Commodity class" witnessed={doc.building.commodityClass} />
        <Witness label="Seismic design cat." witnessed={doc.building.sdc} />
      </section>

      <section aria-labelledby="pf-unit-load">
        <h2 id="pf-unit-load" className="pf-heading">
          Unit load
        </h2>
        <Field label="Pallet width, aisle face" value={inches(doc.unitLoad.palletW)} suffix="in" />
        <Field label="Pallet depth, into rack" value={inches(doc.unitLoad.palletD)} suffix="in" />
        <Field label="Unit load height" value={inches(doc.unitLoad.height)} suffix="in" />
        <Field label="Rated load" value={String(doc.unitLoad.weight)} suffix="lb" />
        <Field label="Load distribution factor" value={String(doc.loadDistributionFactor)} />
      </section>

      {bt !== undefined && (
        <section aria-labelledby="pf-bay-type">
          <h2 id="pf-bay-type" className="pf-heading">
            Bay type — {bt.name} <span className="pf-sub">from catalog</span>
          </h2>
          <Field label="Upright" value={bt.uprightPart} />
          <Field label="Upright face" value={inches(bt.uprightWidth)} suffix="in" />
          <Field label="Frame depth" value={inches(bt.frameDepth)} suffix="in" />
          <Witness label="Frame height" witnessed={bt.frameHeight} format={inches} suffix="in" />
          <Field label="Beam" value={bt.beamPart} />
          <Field label="Beam clear span" value={inches(bt.beamLength)} suffix="in" />
          <Field label="Pallets per bay" value={String(bt.palletsPerBay)} />
          <Field label="Beam levels" value={String(bt.beamLevels.length)} />
          <Witness label="Beam pair capacity" witnessed={bt.beamPairCapacity} suffix="lb" />
        </section>
      )}
    </div>
  );
}
