// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { formatAmount } from "@agent-cost-analyzer/web/lib/cost/cost-format";
import { useRef } from "react";
import type { ChangeView, ComparisonRowView, CostComparisonViewModel, MoneyView } from "../../view-models/index.js";
import { UNKNOWN_TEXT } from "../../view-models/index.js";
import { useFocusOnMountIfLost } from "../focus.js";
import "./cost-compare.css";

// The comparison table (board CostCompare.dc.html, plan §4.5). A row opens
// that repository or project in place; the click hands on the ids from the
// row's drillDown, never the label. Money cells are the number: the unit and
// the basis are in the sentence above the table. A figure with nothing known
// is Unknown, never 0; a currency is a line of its own and never added.

export interface OpenRow {
  key: string;
  label: string;
  drillDown: ComparisonRowView["drillDown"];
}

function Chevron() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function Arrow({ direction }: { direction: "up" | "down" | "flat" }) {
  // The sign in the text carries the meaning; the arrow only helps the eye.
  const path = direction === "up" ? "M12 19V5M6 11l6-6 6 6" : direction === "down" ? "M12 5v14M6 13l6 6 6-6" : "M5 12h14";
  return (
    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const figure = (view: MoneyView): string => (view.known && view.amount !== null && view.currency !== null ? formatAmount(view.amount, view.currency) : UNKNOWN_TEXT);

function Lines({ views, notes = false }: { views: readonly MoneyView[]; notes?: boolean }) {
  return (
    <>
      {views.map((view, index) => (
        <span key={view.currency ?? index} className="cc-total">
          <span className={view.known ? "cc-line" : "cc-line view-unknown"}>{figure(view)}</span>
          {notes && view.coverageNote !== undefined && <span className="cc-note text-muted">{view.coverageNote}</span>}
        </span>
      ))}
    </>
  );
}

function ShareBar({ share, text }: { share: number; text: string }) {
  return (
    <span className="cc-share text-muted">
      <span className="cc-track" aria-hidden="true">
        <span data-bar="" className="cc-fill" style={{ width: `${Math.max(1, share * 100)}%` }} />
      </span>
      {text}
    </span>
  );
}

function TotalCell({ row }: { row: ComparisonRowView }) {
  return (
    <>
      {row.total.map((view, index) => {
        const share = view.currency === null ? undefined : row.shares.find((entry) => entry.currency === view.currency);
        return (
          <span key={view.currency ?? index} className="cc-total">
            <span className={view.known ? "cc-line" : "cc-line view-unknown"}>{figure(view)}</span>
            {share !== undefined && view.known && <ShareBar share={share.share} text={share.text} />}
            {view.coverageNote !== undefined && <span className="cc-note text-muted">{view.coverageNote}</span>}
            {view.unknownNote !== undefined && <span className="cc-note text-muted">{view.unknownNote}</span>}
          </span>
        );
      })}
    </>
  );
}

function Change({ change }: { change: ChangeView }) {
  if (change.noEarlierFigure) return <span className="cc-change text-muted">{change.text}</span>;
  if (change.direction === undefined) return <span className="cc-change view-unknown">{change.text}</span>;
  return (
    <span className="cc-change">
      <Arrow direction={change.direction} />
      {change.percentText !== undefined && <span className="cc-change-pct">{change.percentText}</span>}
      <span className="cc-change-abs text-muted">{change.absoluteText}</span>
    </span>
  );
}

// "per session 11.82 · per active day 10.95 · …": under the name where the
// figure columns are hidden.
function narrowLine(row: ComparisonRowView): string {
  const money = (views: readonly MoneyView[]) => views.map(figure).join(", ");
  return `per session ${money(row.perSession)} · per active day ${money(row.perActiveDay)} · per turn ${money(row.perTurn)} · cache hit ${row.cacheHit.text}`;
}

function RowButton({ row, returning, onOpen }: { row: ComparisonRowView; returning: boolean; onOpen: (row: OpenRow) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnMountIfLost(ref, returning);
  return (
    <button ref={ref} type="button" className="view-row-button" onClick={() => onOpen({ key: row.key, label: row.label, drillDown: row.drillDown })}>
      <Chevron />
      <span>{row.label}</span>
    </button>
  );
}

export function ComparisonTable({
  vm,
  noun,
  focusOnMount,
  onOpen,
}: {
  vm: CostComparisonViewModel;
  noun: string;
  focusOnMount: string | undefined;
  onOpen: (row: OpenRow) => void;
}) {
  const column = noun === "project" ? "Project" : "Repository";
  return (
    <div className="view-scroll" tabIndex={0} role="region" aria-label={`Cost by ${noun}, scrollable`}>
      <table className="view-table" aria-label={`Cost by ${noun}`}>
        <thead>
          <tr>
            <th className="view-left">{column}</th>
            <th>Total</th>
            <th>Change</th>
            <th className="cc-col-wide">Per session</th>
            <th className="cc-col-wide">Per active day</th>
            <th className="cc-col-wide">Per turn</th>
            <th className="cc-col-wide">Cache hit</th>
          </tr>
        </thead>
        <tbody>
          {vm.rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="view-left view-cell-text cc-name">
                <RowButton row={row} returning={focusOnMount === row.key} onOpen={onOpen} />
                <span className="cc-sub text-muted">{`${row.sessionsText} · ${row.turnsText}`}</span>
                <span className="cc-narrow text-muted">{narrowLine(row)}</span>
              </th>
              <td>
                <TotalCell row={row} />
              </td>
              <td className="view-cell-text cc-change-cell">
                {row.change.map((change, index) => (
                  <Change key={change.currency ?? index} change={change} />
                ))}
              </td>
              <td className="cc-col-wide">
                <Lines views={row.perSession} />
              </td>
              <td className="cc-col-wide">
                <Lines views={row.perActiveDay} />
              </td>
              <td className="cc-col-wide">
                <Lines views={row.perTurn} />
              </td>
              <td className={row.cacheHit.known ? "cc-col-wide" : "cc-col-wide view-unknown"}>{row.cacheHit.text}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="view-left">
              Together
            </th>
            <td>
              <Lines views={vm.total} notes />
            </td>
            <td />
            <td className="cc-col-wide" />
            <td className="cc-col-wide" />
            <td className="cc-col-wide" />
            <td className="cc-col-wide" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
