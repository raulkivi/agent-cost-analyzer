// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describeMonthlyAllowance, type MonthlyAllowanceAnswer, type MonthlyAllowanceFigures } from "@agent-cost-analyzer/domain";

// The text half of get_monthly_allowance (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §6):
// the answer put into the domain's wording, the words the app's header and
// the extension's status bar use. Built from numbers, day keys and the zone
// only, so no session title or path can reach the model.

export const NO_ALLOWANCE_TEXT = "No monthly allowance is set. The user sets it in the app's header; this tool cannot change it.";

const sentence = (line: string): string => line.replace(/\.$/, "");
const capitalize = (line: string): string => line.charAt(0).toUpperCase() + line.slice(1);

// What the shared wording takes: the answer's figures back in its input shape.
function figuresOf(answer: MonthlyAllowanceAnswer, allowance: number): MonthlyAllowanceFigures {
  const { period, figures } = answer;
  const known = figures !== undefined && "used" in figures ? figures : undefined;
  return {
    level: known?.level ?? "normal",
    allowance,
    used: known?.used ?? null,
    atLeast: known?.atLeast ?? false,
    percent: known?.percent ?? null,
    remaining: known?.remaining ?? null,
    daysLeft: period.daysLeft,
    period: { startKey: period.startKey, endKeyExclusive: period.endKeyExclusive },
    coverage: figures?.coverage ?? { known: 0, total: 0 },
    countedSinceKey: figures?.countedSinceKey,
  };
}

export function monthlyAllowanceText(answer: MonthlyAllowanceAnswer): string {
  const { aiCredits } = answer.settings;
  if (aiCredits === null) return NO_ALLOWANCE_TEXT;
  const description = describeMonthlyAllowance(figuresOf(answer, aiCredits), {
    sourceAvailable: answer.source.available,
    timeZone: answer.period.timeZone,
  });
  if (description.state === "hidden") return NO_ALLOWANCE_TEXT;
  // The first detail line repeats the allowance the status line already gives.
  const lines = [description.statusLine, ...description.detailLines.slice(1)];
  if (description.note !== undefined && !lines.includes(description.note)) lines.push(description.note);
  return `${lines.map((line) => capitalize(sentence(line))).join(". ")}.`;
}
