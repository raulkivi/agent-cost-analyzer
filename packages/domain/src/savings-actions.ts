// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { MAX_SAVINGS_NAME_LENGTH, type SavingsActionParams, type SavingsOpportunityKind } from "./savings.js";

// Phase 16 SR9 (docs/plans/savings-report.md §5.2, §7, §11): what to change,
// as fixed text in the second person. Only numbers, model ids and capped,
// one-line names go into a template, so a hostile log name cannot add markup
// or instructions. No template says the app changed anything: the report is
// read-only (vision §6, D1). Wording is reviewed by the owner in SR11.

type ParamType = "number" | "modelId" | "name";

// The required parameters of each template, with their types.
export const SAVINGS_ACTION_PARAMS: Readonly<Record<SavingsOpportunityKind, Readonly<Record<string, ParamType>>>> = {
  "unused-tools": { group: "name", tools: "number", tokens: "number", sessions: "number", days: "number" },
  "idle-cache-expiry": { breaks: "number", minutes: "number", tokens: "number" },
  "unexplained-cache-break": { breaks: "number", tokens: "number" },
  "model-switch": { times: "number", tokens: "number" },
  // `category` only selects fixed advice; it is never echoed.
  "failed-tool-calls": { name: "name", calls: "number", sessions: "number", category: "name" },
  "cheaper-model": { model: "modelId", percent: "number", matchPercent: "number" },
};

const OPTIONAL_PARAMS: Readonly<Record<SavingsOpportunityKind, Readonly<Record<string, ParamType>>>> = {
  "unused-tools": {},
  // Claude Code: the 1-hour cache option, with its lifetime in minutes.
  "idle-cache-expiry": { extendedMinutes: "number" },
  "unexplained-cache-break": {},
  "model-switch": {},
  "failed-tool-calls": {},
  "cheaper-model": {},
};

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;
// Control (Cc), format (Cf: bidi and zero-width) and separator characters.
const CONTROL_OR_SPACE_RUN = /[\p{Cc}\p{Cf}\p{Z}\s]+/gu;

// en-US grouping, as the monthly gauge does (D: owner answer to SR11 question 5).
const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function number(kind: string, key: string, value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`savings action ${kind}: parameter "${key}" must be a finite number, 0 or more`);
  }
  return GROUPED.format(Number.isInteger(value) ? value : Math.round(value * 10) / 10);
}

function modelId(kind: string, key: string, value: unknown): string {
  if (typeof value !== "string" || !MODEL_ID.test(value)) {
    throw new Error(`savings action ${kind}: parameter "${key}" must be a plain model id`);
  }
  return value;
}

// One line, control characters out, capped.
function name(kind: string, key: string, value: unknown): string {
  const text = typeof value === "string" ? value.replace(CONTROL_OR_SPACE_RUN, " ").trim().slice(0, MAX_SAVINGS_NAME_LENGTH).trim() : "";
  if (text === "") throw new Error(`savings action ${kind}: parameter "${key}" must be a non-empty name`);
  return text;
}

const FORMATTERS: Record<ParamType, (kind: string, key: string, value: unknown) => string> = { number, modelId, name };

const FAILURE_ADVICE: Readonly<Record<string, string>> = {
  "command-not-found": "install it, or say in your instructions file which tool to use instead.",
  "wrong-directory": "say in your instructions file which directory to run it from.",
  "invalid-arguments": "say in your instructions file the arguments it takes.",
  "tool-input-invalid": "say in your instructions file the arguments it takes.",
  "file-not-found": "say in your instructions file where those files live.",
  "permission-denied": "check the permissions it needs, or say in your instructions file what to use instead.",
  timeout: "run it on a smaller scope, or say in your instructions file how to run it.",
  network: "check the connection it needs, or say in your instructions file what to use offline.",
  "dependency-missing": "install what it needs before the session, or say in your instructions file what is available.",
  "git-state": "check the repository state before the session starts.",
};
const DEFAULT_FAILURE_ADVICE = "look at these calls in the tool-call audit and say in your instructions file what to do instead.";

type Values = Record<string, string>;
// The raw numbers, so a template can choose a singular or a plural noun (R14).
type Counts = Record<string, number>;

const noun = (count: number | undefined, singular: string) => (count === 1 ? singular : `${singular}s`);

const TEMPLATES: Record<SavingsOpportunityKind, (v: Values, n: Counts) => string> = {
  "unused-tools": (v, n) =>
    `Turn off the tools of ${v.group} in the tool picker (${v.tools} ${noun(n.tools, "tool")}, about ${v.tokens} ${noun(n.tokens, "token")} on each request); none of them ran in ${v.sessions} ${noun(n.sessions, "session")} over ${v.days} ${noun(n.days, "day")}.`,
  "idle-cache-expiry": (v, n) =>
    `${v.breaks} ${noun(n.breaks, "break")} longer than the ${v.minutes}-minute cache lifetime resent about ${v.tokens} ${noun(n.tokens, "token")} uncached. Resuming a long session after a break resends all of it: start a new session with a short summary, or run /compact before the break.` +
    (v.extendedMinutes === undefined ? "" : ` The extended cache lifetime of ${v.extendedMinutes} ${noun(n.extendedMinutes, "minute")} (the 1-hour option) costs a higher price per cache write.`),
  "unexplained-cache-break": (v, n) =>
    `The cache broke ${v.breaks} ${noun(n.breaks, "time")} with no idle gap, resending about ${v.tokens} ${noun(n.tokens, "token")} uncached. Edit instructions files and enable or disable tools between sessions, not during one.`,
  "model-switch": (v, n) => `Pick the model when the session starts: switching resent ${v.tokens} ${noun(n.tokens, "token")} uncached ${v.times} ${noun(n.times, "time")}.`,
  "failed-tool-calls": (v, n) => `${v.name} failed ${v.calls} ${noun(n.calls, "time")} in ${v.sessions} ${noun(n.sessions, "session")}: ${Object.hasOwn(FAILURE_ADVICE, v.category) ? FAILURE_ADVICE[v.category] : DEFAULT_FAILURE_ADVICE}`,
  "cheaper-model": (v) =>
    `Replayed on ${v.model}, the same conversation would have cost about ${v.percent}% of what it did (Simulated; the replay matches the log on its own model for ${v.matchPercent}% of requests). ${v.model} would not have answered the same way.`,
};

// Throws on a missing, unknown or ill-typed parameter: detectors build the
// parameters, so a bad one is a bug, not a user error.
export function savingsActionText(kind: SavingsOpportunityKind, params: SavingsActionParams): string {
  const required = SAVINGS_ACTION_PARAMS[kind];
  const optional = OPTIONAL_PARAMS[kind];
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(required, key) && !Object.hasOwn(optional, key)) throw new Error(`savings action ${kind}: unknown parameter "${key}"`);
  }
  const values: Values = {};
  const counts: Counts = {};
  const fill = (key: string, type: ParamType) => {
    values[key] = FORMATTERS[type](kind, key, params[key]);
    if (type === "number") counts[key] = params[key] as number;
  };
  for (const [key, type] of Object.entries(required)) {
    if (!Object.hasOwn(params, key)) throw new Error(`savings action ${kind}: missing parameter "${key}"`);
    fill(key, type);
  }
  for (const [key, type] of Object.entries(optional)) {
    if (Object.hasOwn(params, key)) fill(key, type);
  }
  return TEMPLATES[kind](values, counts);
}
