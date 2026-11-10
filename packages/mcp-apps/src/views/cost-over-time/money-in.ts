// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Currency } from "@agent-cost-analyzer/domain";
import { formatAmount } from "@agent-cost-analyzer/web/lib/cost/cost-format";
import type { MoneyView } from "../../view-models/index.js";
import { UNKNOWN_TEXT } from "../../view-models/index.js";
import { unitLabelOf } from "./chart-model.js";

// One table cell of money in the currency the switch chose. The unit and the
// basis are in the section's heading, as the board has them, so the cell is
// the number. Nothing known is Unknown, never 0 (constraint 6).

export interface MoneyCell {
  text: string;
  known: boolean;
  coverageNote?: string;
}

export function moneyIn(money: readonly MoneyView[], currency: Currency | null): MoneyCell {
  const found = currency === null ? undefined : money.find((view) => view.known && view.currency === currency && view.amount !== null);
  if (found?.amount != null && currency !== null) {
    return { text: formatAmount(found.amount, currency), known: true, ...(found.coverageNote === undefined ? {} : { coverageNote: found.coverageNote }) };
  }
  const knownElsewhere = currency !== null && money.some((view) => view.known);
  return { text: knownElsewhere ? `none in ${unitLabelOf(currency)}` : UNKNOWN_TEXT, known: false };
}
