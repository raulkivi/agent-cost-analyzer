// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency } from "@agent-cost-analyzer/domain";
import type { BreakdownRowView, VendorRowView } from "../../view-models/index.js";
import { moneyIn } from "./money-in.js";
import "./cost-over-time.css";

// Cost by vendor, then model (project only). An unknown figure reads
// "Unknown" with the row's reason and has no share (constraint 6).

function Row({ row, currency, kind }: { row: BreakdownRowView; currency: Currency | null; kind: "vendor" | "model" }) {
  const cell = moneyIn(row.money, currency);
  const share = currency === null ? undefined : row.shares[currency];
  return (
    <tr className={kind === "vendor" ? "ct-vendor" : "ct-model"}>
      <td className="view-left ct-name">
        {row.label}
        {row.reason !== undefined && <span className="ct-reason">{`Reason: ${row.reason} (${row.turnsText})`}</span>}
      </td>
      <td>
        <span className={cell.known ? undefined : "view-unknown"}>{cell.text}</span>
        {cell.coverageNote !== undefined && <span className="ct-coverage text-muted">{cell.coverageNote}</span>}
      </td>
      <td className="text-muted">{share ?? ""}</td>
    </tr>
  );
}

export function VendorBreakdown({ vendors, currency }: { vendors: VendorRowView[]; currency: Currency | null }) {
  if (vendors.length === 0) return <p className="text-muted">No vendor breakdown in this period.</p>;
  return (
    <table className="view-table ct-vendors" aria-label="Cost by vendor, then model">
      <thead>
        <tr>
          <th className="view-left">Vendor / model</th>
          <th>Cost</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {vendors.flatMap((vendor) => [
          <Row key={`v:${vendor.key ?? vendor.label}`} row={vendor} currency={currency} kind="vendor" />,
          ...vendor.models.map((model) => <Row key={`m:${vendor.key ?? vendor.label}:${model.key ?? model.label}`} row={model} currency={currency} kind="model" />),
        ])}
      </tbody>
    </table>
  );
}
