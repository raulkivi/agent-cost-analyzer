import { useState, type KeyboardEvent, type MouseEvent } from "react";
import type { FieldValue, ValueState } from "../../lib/associative/data-model.js";

const SEARCH_THRESHOLD = 8;

const STATE_TITLES: Record<ValueState, string> = {
  selected: "Selected",
  possible: "Associated with the current selections",
  alternative: "Not selected, but would be possible if this field's selection changed",
  excluded: "Excluded by the current selections",
};

interface ListBoxProps {
  label: string;
  values: FieldValue[];
  // additive = Ctrl/⌘ held: toggle this value instead of selecting only it.
  onSelect: (value: string, additive: boolean) => void;
  onClear: () => void;
}

// A QlikView list box (docs/plans/insights-dashboard.md §2): every value of
// one field, coloured by its associative state. Colour is never the only
// cue — aria-selected, a title and the count carry the same information.
export function ListBox({ label, values, onSelect, onClear }: ListBoxProps) {
  const [query, setQuery] = useState("");
  const hasSelection = values.some((value) => value.state === "selected");
  const needle = query.trim().toLowerCase();
  const shown = needle ? values.filter((value) => value.label.toLowerCase().includes(needle)) : values;

  function select(value: string) {
    return (event: MouseEvent | KeyboardEvent) => onSelect(value, event.ctrlKey || event.metaKey);
  }

  return (
    <section className="listbox">
      <header className="listbox-header">
        <span className="listbox-title">{label}</span>
        {hasSelection && (
          <button type="button" className="btn btn-ghost listbox-clear" aria-label={`Clear ${label} selection`} onClick={onClear}>
            ✕
          </button>
        )}
      </header>
      {values.length > SEARCH_THRESHOLD && (
        <input
          type="search"
          className="input listbox-search"
          aria-label={`Search ${label}`}
          placeholder="Search…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <ul className="listbox-values" role="listbox" aria-label={label} aria-multiselectable="true">
        {shown.map((value) => (
          <li
            key={value.value}
            role="option"
            tabIndex={0}
            aria-selected={value.state === "selected"}
            data-state={value.state}
            title={`${value.label} — ${STATE_TITLES[value.state]}`}
            className={`listbox-value listbox-value--${value.state}`}
            onClick={select(value.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                select(value.value)(event);
              }
            }}
          >
            <span className="listbox-label truncate">{value.label}</span>
            {value.count > 0 && <span className="listbox-count">{value.count}</span>}
          </li>
        ))}
      </ul>
      {values.length === 0 && <p className="text-muted listbox-empty">No values</p>}
    </section>
  );
}
