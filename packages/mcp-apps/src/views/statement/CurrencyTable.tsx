// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency } from "@agent-cost-analyzer/domain";
import type { StatementTotalView, StatementViewModel } from "../../view-models/index.js";
import "./statement.css";

// One table per currency, AI Credits first (§9.2 Q13): basis, channel, model,
// turns and amount. Tokens and unit prices are not shown. The unit is in the
// column head, so cells hold the bare number.

export const UNIT: Record<Currency, string> = { AI_CREDITS: "AI Credits", USD: "USD" };
export const bare = (text: string): string => text.replace(/ AI Credits$/, "");

const NOTE: Record<Currency, string> = { AI_CREDITS: "basis per line", USD: "API-priced use, kept apart from AI Credits" };

export function CurrencyTable({ vm, total }: { vm: StatementViewModel; total: StatementTotalView }) {
  const unit = UNIT[total.currency];
  const lines = vm.lines.filter((line) => line.currency === total.currency);
  const fixed = vm.fixedLines.filter((line) => line.currency === total.currency);
  const hasMarkup = !/^\$?0\.00/.test(total.markupText);
  return (
    <section className="stm-section" aria-label={`Statement lines in ${unit}`}>
      <div className="stm-cur">
        <h2>{unit}</h2>
        <span className="text-muted">{NOTE[total.currency]}</span>
      </div>
      <div className="view-scroll" tabIndex={0} role="region" aria-label={`Statement lines in ${unit}, scrollable`}>
        <table className="view-table">
          <caption className="sr-only">{`Statement lines in ${unit}`}</caption>
          <thead>
            <tr>
              <th scope="col" className="view-left">Basis</th>
              <th scope="col" className="view-left stm-col-channel">Channel</th>
              <th scope="col" className="view-left">Model</th>
              <th scope="col">Turns</th>
              <th scope="col">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key}>
                <td className="view-left">{line.basisText}</td>
                <td className="view-left stm-col-channel">{line.channelText}</td>
                <td className="view-left view-cell-text">
                  {line.model}
                  {line.apiEquivalent && <span className="text-muted"> (API-equivalent)</span>}
                </td>
                <td>{line.turnsText.replace(/ turns?$/, "")}</td>
                <td>{bare(line.amountText)}</td>
              </tr>
            ))}
            {fixed.map((line, index) => (
              <tr key={`fixed:${index}`}>
                <td className="view-left view-cell-text" colSpan={4}>{`Fixed: ${line.label}`}</td>
                <td>{bare(line.amountText)}</td>
              </tr>
            ))}
            <tr className="stm-total">
              <td className="view-left" colSpan={4}>Lines</td>
              <td>{bare(total.linesText)}</td>
            </tr>
            {hasMarkup && (
              <tr>
                <td className="view-left" colSpan={4}>Markup</td>
                <td>{bare(total.markupText)}</td>
              </tr>
            )}
            <tr className="stm-total">
              <td className="view-left" colSpan={4}>Total</td>
              <td>{bare(total.totalText)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
