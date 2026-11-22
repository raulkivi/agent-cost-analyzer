// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  computeMonthlyAllowance,
  describeMonthlyAllowance,
  type AllowanceDescription,
  type AllowanceLevel,
  type HiddenAllowance,
  type MonthlyAllowanceFigures,
  type MonthlyAllowanceInput as FiguresInput,
} from "@agent-cost-analyzer/domain";
import { identityTranslate, type Translate } from "../l10n/localize.js";

// The monthly AI Credits allowance gauge (step 10.21, plan
// https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance.md §3.2 to §3.4). Pure and free of `vscode`: the status
// bar adapter and the Sessions view apply it. The figures are the domain's
// (`computeMonthlyAllowance`, shared with the standalone app) and so are the
// words (`describeMonthlyAllowance`, MS2); this module adds the status bar's
// codicons, its "Open Sessions." hint and the Sessions row.

export interface MonthlyAllowance extends MonthlyAllowanceFigures {
  // Status bar text, codicon first and outside the translated message. The
  // words in `text` and `ariaLabel` carry the level; a background color
  // may only add to them.
  text: string;
  tooltip: string;
  ariaLabel: string;
  // The Sessions view header row: the state as the label, the days left as
  // the muted description.
  rowLabel: string;
  rowDescription: string;
}

export type MonthlyAllowanceView = HiddenAllowance | MonthlyAllowance;

export interface MonthlyAllowanceInput extends FiguresInput {
  t?: Translate;
}

const CODICONS: Record<AllowanceLevel, string> = { normal: "$(dashboard)", near: "$(warning)", over: "$(error)" };

function rowLabelOf(description: AllowanceDescription, t: Translate): string {
  switch (description.state) {
    case "no-sessions":
      return t("This month: no sessions");
    case "unknown":
      return t("This month: AI Credits unknown");
    default:
      return t("This month: {0}", description.statusLine);
  }
}

export function buildMonthlyAllowance({ t = identityTranslate, ...input }: MonthlyAllowanceInput): MonthlyAllowanceView {
  const figures = computeMonthlyAllowance(input);
  const description = describeMonthlyAllowance(figures, { t });
  if (figures.level === "hidden" || description.state === "hidden") {
    return { level: "hidden" };
  }
  return {
    ...figures,
    // The codicon stays outside the message: a translator must not see it.
    text: `${CODICONS[figures.level]} ${description.statusLine}`,
    tooltip: description.detailLines.join("\n"),
    ariaLabel: `${description.ariaLabel} ${t("Open Sessions.")}`,
    rowLabel: rowLabelOf(description, t),
    rowDescription: t("· {0}", description.daysLeft),
  };
}
