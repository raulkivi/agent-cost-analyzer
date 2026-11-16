// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef } from "react";
import type { MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { allowanceDetailRows } from "../../lib/allowance/allowance-detail-rows.js";
import { allowanceView } from "../../lib/allowance/allowance-view.js";
import { useEscapeKey, useFocusTrap } from "../../lib/focus.js";
import { AllowanceMeter } from "./AllowanceMeter.js";

interface AllowanceDetailsDialogProps {
  answer: MonthlyAllowanceAnswer;
  onClose: () => void;
  // Reads the logs again (§4.8); the dialog stays open and shows the new answer.
  onRecount: () => void;
  // Closes this dialog and opens the settings dialog.
  onChange: () => void;
}

// What the figure never is, and why a state has none. Words only.
const NO_SOURCE_PROSE =
  "The allowance counts GitHub Copilot sessions recorded by VS Code. Claude Code, pi and mitmproxy sessions record no AI Credits.";
const KNOWN_PROSE = "Only sessions recorded on this machine are counted.";

// Details.dc.html: the tooltip's lines as a dialog, so keyboard and touch
// reach them. Focus lands on Close, Tab cycles inside, Escape or Close gives
// focus back to the gauge (§3.5: dialogs trap focus, Escape closes them).
export function AllowanceDetailsDialog({ answer, onClose, onRecount, onChange }: AllowanceDetailsDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useFocusTrap(dialog);
  useEscapeKey(onClose);
  // The trap starts on the first control; Close is first in the DOM already,
  // this keeps it so if the order ever changes.
  useEffect(() => closeButton.current?.focus(), []);

  const view = allowanceView(answer);
  const { rows, higherNote } = allowanceDetailRows(answer);
  const figure = view.meter !== undefined;

  return (
    <div className="dialog-backdrop" data-testid="allowance-details-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className="dialog allowance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div id={titleId} className="dialog-title">
          Monthly allowance
        </div>
        <p className="allowance-lead">
          {view.levelWord !== undefined ? (
            <>
              {view.figureText} · <b>{view.levelWord}</b>
            </>
          ) : (
            view.headerText
          )}
        </p>
        {view.meter && <AllowanceMeter meter={view.meter} level={view.level} large />}
        <dl className="allowance-rows">
          {rows.map((row) => (
            <div key={row.label} className="allowance-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        {higherNote !== undefined && <div className="allowance-note">{higherNote}</div>}
        {view.state === "unknown" && view.note !== undefined && <div className="allowance-note">{view.note}</div>}
        {view.state === "no-source" && view.note !== undefined && <div className="allowance-note">{view.note}</div>}
        {view.byHarness.length > 0 && (
          <>
            <h4 className="allowance-subhead">By harness</h4>
            <table className="allowance-table">
              <thead>
                <tr>
                  <th scope="col">Harness</th>
                  <th scope="col" className="allowance-num">
                    Cost data
                  </th>
                  <th scope="col" className="allowance-num">
                    AI Credits
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.byHarness.map((harness) => (
                  <tr key={harness.harness}>
                    <td>{harness.label}</td>
                    <td className="allowance-num">{harness.coverage}</td>
                    <td className="allowance-num">{harness.credits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {figure && <p className="allowance-prose">{KNOWN_PROSE}</p>}
        {view.state === "no-sessions" && view.note !== undefined && <p className="allowance-prose">{view.note}</p>}
        {view.state === "no-source" && <p className="allowance-prose">{NO_SOURCE_PROSE}</p>}
        {view.state !== "no-source" && (
          <>
            <h4 className="allowance-subhead">Not counted</h4>
            <ul className="allowance-list">
              {view.notCounted.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </>
        )}
        <div className="dialog-actions allowance-actions">
          <button ref={closeButton} type="button" className="btn btn-primary allowance-close" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-ghost" onClick={onRecount}>
            Recount
          </button>
          <button type="button" className="btn btn-secondary" onClick={onChange}>
            Change allowance
          </button>
        </div>
      </div>
    </div>
  );
}
