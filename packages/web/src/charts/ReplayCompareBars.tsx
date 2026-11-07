// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CSSProperties } from "react";
import { UNKNOWN_CELL } from "./ChartDataTable.js";
import { ViewAsTable } from "./ViewAsTable.js";

export interface ReplayCompareBar {
  key: string;
  // The model id, as the table beside the chart writes it.
  label: string;
  // "Measured model", or the vendor's channel.
  sublabel: string;
  // null when unknown: written "unknown", never drawn as a 0-length bar.
  value: number | null;
  isMeasuredModel: boolean;
  // Said after "unknown" (why there is no total).
  unknownReason?: string;
}

export interface ReplayCompareBarsProps {
  ariaLabel: string;
  bars: ReplayCompareBar[];
  // The session's measured total: the dashed reference line.
  measured: number | null;
  // How a value reads in the unit shown, e.g. "$4.82" or "9.65".
  format(value: number): string;
}

// A zero-based axis whose top is the next readable tick (1, 2 or 5 times a
// power of ten per step, about five steps).
export function niceScale(top: number): { max: number; ticks: number[] } {
  const target = top > 0 ? top : 1;
  const raw = target / 5;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw * (1 - 1e-9))!;
  const steps = Math.max(1, Math.ceil(target / step - 1e-9));
  const ticks = Array.from({ length: steps + 1 }, (_, index) => Number((index * step).toFixed(10)));
  return { max: ticks[ticks.length - 1]!, ticks };
}

const ROW_HEIGHT = 40;
const BAR_HEIGHT = 18;
// Room past the longest bar for its value label.
const LABEL_ROOM = "4.5rem";
const SERIES = "var(--color-series-1)";

// The own model: hatched in the series hue and outlined in the text colour,
// so it reads apart from the others without colour (and in High Contrast,
// where the outline carries it).
const OWN_BAR: CSSProperties = {
  backgroundImage: `repeating-linear-gradient(45deg, ${SERIES} 0 2px, transparent 2px 6px)`,
  border: "2px solid var(--color-text)",
};
// Every other model: the one hue, with an outline of the same hue so the
// bar survives a theme that flattens fills.
const OTHER_BAR: CSSProperties = { background: SERIES, border: `1px solid ${SERIES}` };

const percent = (value: number, max: number): string => `${Number(((value / max) * 100).toFixed(2))}%`;

function Swatch({ style }: { style: CSSProperties }) {
  return <span aria-hidden="true" style={{ display: "inline-block", width: 18, height: 12, boxSizing: "border-box", ...style }} />;
}

function describe(ariaLabel: string, bars: ReplayCompareBar[], measured: number | null, format: (value: number) => string): string {
  const each = bars.map((bar) => `${bar.label}${bar.isMeasuredModel ? " (measured model)" : ""} ${bar.value === null ? UNKNOWN_CELL : format(bar.value)}`);
  return `${ariaLabel}, measured ${measured === null ? UNKNOWN_CELL : format(measured)}: ${each.join(", ")}.`;
}

// Phase 14 step 14.7 (mock-up board 3): the session's simulated total on
// each model as horizontal bars in one hue, with the measured total as a
// dashed reference line and the value written at each bar's end. HTML, not
// SVG, so long model ids truncate rather than collide at a compact width.
export function ReplayCompareBars({ ariaLabel, bars, measured, format }: ReplayCompareBarsProps) {
  const known = bars.flatMap((bar) => (bar.value === null ? [] : [bar.value]));
  const { max, ticks } = niceScale(Math.max(0, measured ?? 0, ...known));
  const measuredText = measured === null ? undefined : `Measured ${format(measured)}`;

  const legend = (
    <ul className="chart-legend" aria-label="Legend">
      <li>
        <Swatch style={OTHER_BAR} />
        Other model
      </li>
      <li>
        <Swatch style={OWN_BAR} />
        Session's own model (hatched, outlined)
      </li>
      {measuredText && (
        <li>
          <span aria-hidden="true" style={{ display: "inline-block", width: 0, height: 12, borderLeft: "1.5px dashed var(--color-text)", margin: "0 8px" }} />
          {measuredText}
        </li>
      )}
    </ul>
  );

  const table = {
    caption: ariaLabel,
    rowHeader: "Model",
    columns: ["Simulated total"],
    rows: [
      ...bars.map((bar) => ({
        key: bar.key,
        header: bar.isMeasuredModel ? `${bar.label} (measured model)` : bar.label,
        cells: [bar.value === null ? null : format(bar.value)],
      })),
      { key: "__measured", header: "Measured", cells: [measured === null ? null : format(measured)] },
    ],
  };

  const plot: CSSProperties = { position: "relative", marginRight: LABEL_ROOM };

  return (
    <ViewAsTable table={table} legend={legend}>
      <div
        role="img"
        aria-label={describe(ariaLabel, bars, measured, format)}
        style={{ display: "grid", gridTemplateColumns: "minmax(5rem, 38%) minmax(0, 1fr)", columnGap: "var(--space-2)", fontSize: 12 }}
      >
        {/* The reference line's label, above the plot. */}
        <span />
        <div style={{ ...plot, height: 18 }}>
          {measured !== null && (
            <span
              style={{ position: "absolute", left: percent(measured, max), transform: "translateX(-50%)", whiteSpace: "nowrap", color: "var(--color-text)" }}
            >
              {measuredText}
            </span>
          )}
        </div>

        <div>
          {bars.map((bar) => (
            <div key={bar.key} style={{ height: ROW_HEIGHT, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
              <span className="truncate" title={bar.label} style={{ color: "var(--color-text)" }}>
                {bar.label}
              </span>
              <span className="truncate text-muted" style={{ fontSize: 11 }}>
                {bar.sublabel}
              </span>
            </div>
          ))}
        </div>

        <div style={plot}>
          {ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: percent(tick, max),
                borderLeft: tick === 0 ? "1.5px solid var(--color-text)" : "1px solid var(--color-divider)",
              }}
            />
          ))}
          {measured !== null && (
            <span
              data-reference=""
              aria-hidden="true"
              style={{ position: "absolute", top: 0, bottom: 0, left: percent(measured, max), borderLeft: "1.5px dashed var(--color-text)", zIndex: 1 }}
            />
          )}
          {bars.map((bar) => (
            <div key={bar.key} data-row={bar.key} style={{ position: "relative", height: ROW_HEIGHT }}>
              {bar.value === null ? (
                <span style={{ position: "absolute", left: 6, top: "50%", transform: "translateY(-50%)", whiteSpace: "nowrap" }}>
                  <em>{UNKNOWN_CELL}</em>
                  {bar.unknownReason && <span className="text-muted"> {bar.unknownReason}</span>}
                </span>
              ) : (
                <>
                  <span
                    data-bar={bar.key}
                    data-measured-model={String(bar.isMeasuredModel)}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
                      height: BAR_HEIGHT,
                      boxSizing: "border-box",
                      ...(bar.isMeasuredModel ? OWN_BAR : OTHER_BAR),
                      width: percent(bar.value, max),
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      left: `calc(${percent(bar.value, max)} + 6px)`,
                      top: "50%",
                      transform: "translateY(-50%)",
                      whiteSpace: "nowrap",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--color-text)",
                    }}
                  >
                    {format(bar.value)}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>

        <span />
        <div aria-hidden="true" style={{ ...plot, height: 16 }}>
          {ticks.map((tick) => (
            <span
              key={tick}
              className="chart-axis-text"
              style={{ position: "absolute", left: percent(tick, max), transform: "translateX(-50%)", color: "var(--color-text-muted)", fontSize: 10 }}
            >
              {format(tick)}
            </span>
          ))}
        </div>
      </div>
    </ViewAsTable>
  );
}
