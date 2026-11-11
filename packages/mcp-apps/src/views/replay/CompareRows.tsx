// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useRef } from "react";
import type { CompareEntryView, ReplayCompareViewModel } from "../../view-models/index.js";
import { useFocusOnMountIfLost } from "../focus.js";
import { isPlainModelId } from "./model-id.js";
import "./replay.css";

// U12's compare mode (board Replay, plan §9.2 Q3-Q5): the measured row first,
// then one row per model in the tool's order. A model is a button that opens
// its replay in place. Measured is a solid bar, simulated a hatched one, a
// floor (known for some turns only) open at its end; a model with no price
// has no bar and reads Unknown, never 0. Every bar is on one scale.

// Headroom so the longest bar stops short of the track's end, as the board draws it.
const HEADROOM = 1.06;

function widthOf(amount: number | null, max: number): string | undefined {
  if (amount === null || max <= 0) return undefined;
  return `${Math.min(100, (amount / (max * HEADROOM)) * 100).toFixed(1)}%`;
}

function vendorLine(entry: CompareEntryView): string {
  return entry.noteText === undefined ? entry.vendorText : `${entry.vendorText} · session's own model`;
}

function ModelButton({ entry, returning, onOpen }: { entry: CompareEntryView; returning: boolean; onOpen: (model: string) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnMountIfLost(ref, returning);
  // A model id that is not a plain id is shown but never sent to the tool.
  const plain = isPlainModelId(entry.model);
  return (
    <button ref={ref} type="button" className="rp-model" disabled={!plain} title={plain ? undefined : "This model id can't be replayed from here"} onClick={() => onOpen(entry.model)}>
      {entry.model}
    </button>
  );
}

export function CompareRows({ vm, focusOnMount, onOpen }: { vm: ReplayCompareViewModel; focusOnMount: string | undefined; onOpen: (model: string) => void }) {
  const amounts = [vm.measured.amount, ...vm.entries.map((entry) => entry.total.amount)].filter((value): value is number => value !== null);
  const max = Math.max(0, ...amounts);
  const measuredWidth = widthOf(vm.measured.amount, max);
  return (
    <ul className="rp-rows" aria-label="Simulated total per model">
      <li className="rp-row rp-row--measured" data-row="measured">
        <div className="rp-name">
          <b>Measured</b>
          <span>{vm.measuredModel === undefined ? "from the log" : `${vm.measuredModel} · from the log`}</span>
        </div>
        <span className="rp-track" aria-hidden="true">
          {measuredWidth !== undefined && <span className="rp-bar rp-bar--measured" data-bar="measured" style={{ width: measuredWidth }} />}
        </span>
        <div className="rp-figure">
          <b className={vm.measured.known ? undefined : "view-unknown"}>{vm.measured.text}</b>
          <small>{vm.measured.known ? vm.measuredCoverageText : (vm.measured.unknownNote ?? vm.measuredCoverageText)}</small>
        </div>
        <div className="rp-change text-muted">log</div>
      </li>
      {vm.entries.map((entry) => {
        const width = widthOf(entry.total.amount, max);
        return (
          <li key={entry.model} className="rp-row" data-row={entry.model}>
            <div className="rp-name">
              <ModelButton entry={entry} returning={focusOnMount === entry.model} onOpen={onOpen} />
              <span>{vendorLine(entry)}</span>
            </div>
            <span className="rp-track" aria-hidden="true">
              {width !== undefined && <span className={entry.partial ? "rp-bar rp-bar--simulated rp-bar--floor" : "rp-bar rp-bar--simulated"} data-bar="simulated" {...(entry.partial ? { "data-floor": "" } : {})} style={{ width }} />}
            </span>
            <div className="rp-figure">
              <b className={entry.total.known ? undefined : "view-unknown"}>
                <span className="sr-only">{`${vm.label}: `}</span>
                {entry.displayText}
              </b>
              <small>{entry.subText}</small>
            </div>
            <div className={`rp-change rp-change--${entry.changeDirection}`}>{entry.changeText}</div>
          </li>
        );
      })}
    </ul>
  );
}
