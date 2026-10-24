import type { Selections } from "../../lib/associative/data-model.js";

interface CurrentSelectionsProps {
  selections: Selections;
  fieldLabel: (fieldId: string) => string;
  valueLabel: (fieldId: string, value: string) => string;
  canGoBack: boolean;
  onClearField: (fieldId: string) => void;
  onClearAll: () => void;
  onBack: () => void;
}

// QlikView's "Current Selections" box: every active selection as a chip,
// plus Back (undo the last change) and Clear all.
export function CurrentSelections({
  selections,
  fieldLabel,
  valueLabel,
  canGoBack,
  onClearField,
  onClearAll,
  onBack,
}: CurrentSelectionsProps) {
  const active = Object.entries(selections).filter(([, values]) => values.length > 0);
  return (
    <div className="current-selections" role="region" aria-label="Current selections">
      <span className="card-kicker">Current selections</span>
      {active.length === 0 ? (
        <span className="text-muted current-selections-hint">
          None. Click any value or bar to filter everything; Ctrl/⌘-click to pick several.
        </span>
      ) : (
        <ul className="current-selections-list">
          {active.map(([fieldId, values]) => {
            const text = `${fieldLabel(fieldId)}: ${values.map((value) => valueLabel(fieldId, value)).join(", ")}`;
            return (
              <li key={fieldId} className="selection-chip" aria-label={text}>
                <span className="truncate" title={text}>
                  <strong>{fieldLabel(fieldId)}</strong> {values.map((value) => valueLabel(fieldId, value)).join(", ")}
                </span>
                <button
                  type="button"
                  className="selection-chip-clear"
                  aria-label={`Clear ${fieldLabel(fieldId)}`}
                  onClick={() => onClearField(fieldId)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <span className="current-selections-actions">
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={!canGoBack}>
          Back
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClearAll} disabled={active.length === 0}>
          Clear all
        </button>
      </span>
    </div>
  );
}
