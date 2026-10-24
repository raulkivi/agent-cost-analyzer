import { activateOnEnterOrSpace, ChartLegend, type LegendItem } from "./chart-parts.js";
import { ViewAsTable } from "./ViewAsTable.js";

export interface BarRow {
  key: string;
  label: string;
  values: Record<string, number>;
}

interface HorizontalBarsProps {
  ariaLabel: string;
  series: LegendItem[];
  rows: BarRow[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
  emptyText?: string;
}

// Ranked horizontal bars (magnitude by category): one shared scale, value
// at the bar tip, segments separated by a 2px surface gap. HTML rather than
// SVG so long labels truncate with a native title instead of colliding.
export function HorizontalBars({ ariaLabel, series, rows, selectedKey, onSelect, emptyText }: HorizontalBarsProps) {
  const totals = rows.map((row) => series.reduce((sum, s) => sum + (row.values[s.id] ?? 0), 0));
  const max = Math.max(1, ...totals);

  const legend = series.length > 1 ? <ChartLegend items={series} /> : undefined;
  // A value a row doesn't carry is unknown in the table; the bars and the
  // total count only what is there.
  const table = {
    caption: ariaLabel,
    rowHeader: "Category",
    columns: [...series.map((s) => s.label), "Total"],
    rows: rows.map((row, index) => ({
      key: row.key,
      header: row.label,
      cells: [
        ...series.map((s) => (row.values[s.id] === undefined ? null : String(row.values[s.id]))),
        String(totals[index]),
      ],
    })),
  };

  return (
    <div role="group" aria-label={ariaLabel}>
      {rows.length === 0 ? (
        <div className="chart">
          {legend && <div className="chart-toolbar">{legend}</div>}
          <p className="text-muted chart-empty">{emptyText ?? "No data."}</p>
        </div>
      ) : (
        <ViewAsTable table={table} legend={legend}>
          <div className="hbars">
            {rows.map((row, index) => {
              const selected = row.key === selectedKey;
              const select = () => onSelect?.(row.key);
              const label = `${row.label}: ${series.map((s) => `${row.values[s.id] ?? 0} ${s.label}`).join(", ")}`;
              return (
                <div
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  aria-pressed={selected}
                  title={label}
                  className={selected ? "hbar-row hbar-row--selected" : "hbar-row"}
                  onClick={select}
                  onKeyDown={activateOnEnterOrSpace(select)}
                >
                  <span className="hbar-label truncate">{row.label}</span>
                  <span className="hbar-track">
                    {series.map((s) => {
                      const value = row.values[s.id] ?? 0;
                      return value > 0 ? (
                        <span
                          key={s.id}
                          data-segment={s.id}
                          className="hbar-segment"
                          style={{
                            width: `${(value / max) * 100}%`,
                            background: s.color,
                          }}
                        />
                      ) : null;
                    })}
                    <span className="hbar-value">{totals[index]}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </ViewAsTable>
      )}
    </div>
  );
}
