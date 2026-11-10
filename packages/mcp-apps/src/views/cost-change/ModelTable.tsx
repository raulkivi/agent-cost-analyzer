// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useId, useState } from "react";
import type { CurrencyBlock, ModelRowView, PeriodView } from "../../view-models/index.js";
import "./cost-change.css";

// Change by model (plan §4.5): costs A and B, the change, and the usage and
// price effects. A model's usage effect includes the work it gained or lost
// to another model. A row opens (a button, so Tab, Enter and Space work) to
// its token types with tokens, unit prices and price versions. Opening a row
// is local; nothing goes to the host. Costs A and B collapse out of view at
// narrow widths (cost-change.css), as the board draws.

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={open ? "view-chevron--open" : undefined} aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function versions(ids: readonly string[]): string {
  return ids.length === 0 ? "none" : ids.join(", ");
}

function TokenTypes({ model }: { model: ModelRowView }) {
  return (
    <div className="cv-detail">
      <div className="cv-detail-head">
        <b>{`${model.model} by token type`}</b>
        <span className="text-muted">unit price per 1M tokens, A → B</span>
      </div>
      <div className="view-scroll" tabIndex={0} role="region" aria-label={`${model.model} token types, scrollable`}>
        <table className="view-table" aria-label={`${model.model} by token type`}>
          <thead>
            <tr>
              <th className="view-left">Token type</th>
              <th>Tokens</th>
              <th>Unit price</th>
              <th>Usage</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {model.cells.map((cell) => (
              <tr key={cell.tokenText}>
                <td className="view-left">{cell.tokenText}</td>
                <td>{`${cell.tokensAText} → ${cell.tokensBText}`}</td>
                <td>{`${cell.unitPriceAText} → ${cell.unitPriceBText}`}</td>
                <td>{cell.usageText}</td>
                <td>{cell.priceText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="text-muted cv-versions">{`Price versions: ${versions(model.priceVersionIdsA)} → ${versions(model.priceVersionIdsB)}`}</span>
    </div>
  );
}

export function ModelTable({ block, periodA, periodB }: { block: CurrencyBlock; periodA: PeriodView; periodB: PeriodView }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = (model: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(model)) next.add(model);
      return next;
    });
  if (block.models.length === 0) return <p className="text-muted">No model had priced turns in either period.</p>;
  const unit = block.currency === "USD" ? "USD" : "AI Credits";
  return (
    <div className="view-scroll" tabIndex={0} role="region" aria-label={`Change by model, ${unit}, scrollable`}>
      <table className="view-table" aria-label={`Change by model, ${unit}`}>
        <thead>
          <tr>
            <th className="view-left">Model</th>
            <th className="cv-col-wide">{periodA.label}</th>
            <th className="cv-col-wide">{periodB.label}</th>
            <th>Change</th>
            <th>Usage</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {block.models.map((model) => {
            const isOpen = open.has(model.model);
            return (
              <ModelRows key={model.model} model={model} isOpen={isOpen} onToggle={() => toggle(model.model)} />
            );
          })}
          <tr className="cv-total">
            <td className="view-left">All models</td>
            <td className="cv-col-wide">{block.modelTotals.costAText}</td>
            <td className="cv-col-wide">{block.modelTotals.costBText}</td>
            <td>{block.modelTotals.changeText}</td>
            <td>{block.modelTotals.usageText}</td>
            <td>{block.modelTotals.priceText}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ModelRows({ model, isOpen, onToggle }: { model: ModelRowView; isOpen: boolean; onToggle: () => void }) {
  const detailId = useId();
  return (
    <>
      <tr className={isOpen ? "view-row-selected" : undefined}>
        <td className="view-left view-cell-text">
          <button type="button" className="view-row-button" aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined} onClick={onToggle}>
            <Chevron open={isOpen} />
            <span>{model.model}</span>
          </button>
        </td>
        <td className="cv-col-wide">{model.costAText}</td>
        <td className="cv-col-wide">{model.costBText}</td>
        <td>{model.changeText}</td>
        <td>{model.usageText}</td>
        <td>{model.priceText}</td>
      </tr>
      {isOpen && (
        <tr id={detailId} className="view-row-detail">
          <td colSpan={6}>
            <TokenTypes model={model} />
          </td>
        </tr>
      )}
    </>
  );
}
