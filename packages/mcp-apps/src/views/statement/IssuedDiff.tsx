// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { StatementDiffView } from "../../view-models/index.js";
import { UNIT } from "./CurrencyTable.js";
import "./statement.css";

// An issued period's diff against a re-run today (§9.2 Q14). The issued copy
// is the record; nothing here changes it, and there is no control. An added
// line says "no earlier figure", never "from 0".

const WARN_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4" />
    <path d="M12 17v.5" />
  </svg>
);

export function IssuedDiff({ diff }: { diff: StatementDiffView }) {
  if (!diff.changed) {
    return (
      <div className="stm-alert stm-alert--info" role="status">
        <span>A re-run today matches the issued copy.</span>
      </div>
    );
  }
  const inputs = diff.inputsText.length === 0 ? ["Price book unchanged", "Projects file unchanged"] : diff.inputsText.map((text) => text.charAt(0).toUpperCase() + text.slice(1));
  return (
    <>
      <div className="stm-alert stm-alert--warn" role="status">
        {WARN_ICON}
        <div>
          <b>A re-run today differs from the issued copy.</b> The issued copy stays the statement of record. Nothing here changes it.
        </div>
      </div>
      <section className="stm-section" aria-label="Issued vs re-run">
        <div className="stm-cur">
          <h2>Issued vs re-run</h2>
          <span className="text-muted">per changed line and per currency total</span>
        </div>
        <div className="view-scroll" tabIndex={0} role="region" aria-label="Issued against re-run, scrollable">
          <table className="view-table">
            <caption className="sr-only">Issued against re-run, per line</caption>
            <thead>
              <tr>
                <th scope="col" className="view-left">Line</th>
                <th scope="col">Issued</th>
                <th scope="col">Re-run</th>
                <th scope="col">Difference</th>
              </tr>
            </thead>
            <tbody>
              {diff.lines.map((line) => (
                <tr key={line.key} className="stm-diff-row">
                  <td className="view-left view-cell-text">
                    {line.labelText}
                    {line.change !== "changed" && <span className="stm-tag">{line.change}</span>}
                  </td>
                  <td>{line.change === "added" ? <i className="view-unknown">{line.issuedText}</i> : line.issuedText}</td>
                  <td>{line.change === "removed" ? <i className="view-unknown">{line.currentText}</i> : line.currentText}</td>
                  <td><b>{line.differenceText}</b></td>
                </tr>
              ))}
              {diff.totals.map((total) => (
                <tr key={total.currency} className="stm-total">
                  <td className="view-left">{`Total, ${UNIT[total.currency]}`}</td>
                  <td>{total.issuedText}</td>
                  <td>{total.currentText}</td>
                  <td><b>{total.differenceText}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="stm-list" aria-label="What else changed">
          <li>{diff.sessionsText}</li>
          <li>{diff.unknownTurnsText}</li>
          {inputs.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
