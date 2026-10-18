import { useEffect } from 'react';

export interface ProvenanceInfo {
  readonly id: string;
  readonly label: string;
  readonly established: 'INPUT' | 'DERIVED' | 'CATALOG' | 'RULE' | 'UNKNOWN';
  readonly displayValue: string;
  readonly rawMicrometres?: number;
  readonly formula?: string;
  readonly source: string;
}

export function ProvenancePopover({
  info,
  onClose,
}: {
  readonly info: ProvenanceInfo | null;
  readonly onClose: () => void;
}): React.JSX.Element | null {
  useEffect(() => {
    if (info === null) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [info, onClose]);

  if (info === null) return null;

  const isUnknown = info.established === 'UNKNOWN';

  return (
    <div
      id="prov"
      className="prov-popover"
      role="dialog"
      aria-modal="false"
      aria-labelledby="prov-title"
    >
      <div className="prov-head">
        <strong id="prov-title" className="prov-title">
          {info.label}
        </strong>
        <button
          id="provclose"
          type="button"
          className="prov-close"
          onClick={onClose}
          aria-label="Close provenance dialog"
        >
          ×
        </button>
      </div>
      <dl className="prov-body">
        <div className="prov-row">
          <dt>Origin</dt>
          <dd>
            <span className={`prov-origin prov-origin-${info.established.toLowerCase()}`}>
              {info.established}
            </span>
          </dd>
        </div>
        <div className="prov-row">
          <dt>Shown value</dt>
          <dd>{isUnknown ? 'VERIFY (not established)' : info.displayValue}</dd>
        </div>
        {info.rawMicrometres !== undefined && (
          <div className="prov-row">
            <dt>Stored µm</dt>
            <dd>
              <code>{info.rawMicrometres.toLocaleString('en-US')} µm</code>
            </dd>
          </div>
        )}
        {info.formula !== undefined && (
          <div className="prov-row">
            <dt>Derivation</dt>
            <dd>
              <code>{info.formula}</code>
            </dd>
          </div>
        )}
        <div className="prov-row">
          <dt>Source</dt>
          <dd>{info.source}</dd>
        </div>
      </dl>
    </div>
  );
}
