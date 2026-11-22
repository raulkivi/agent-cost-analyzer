// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { apiMethodResultSchemas, type AllowanceSettingsWrite, type MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { ApiRequestError } from "./api-request-error.js";
import { getApiTransport } from "./current-transport.js";

// MS6 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §4.3, §4.6): the monthly allowance
// answer (GET /api/monthly-allowance) and its write (PUT
// /api/config/monthly-allowance), through the ApiTransport. The extension has
// no allowance store and answers both methods with 404. Answers are parsed
// with the domain schema, so a server that drifts fails here rather than
// showing wrong figures.

// 404: this product has no allowance (the extension, or an older server).
export class AllowanceUnavailable extends Error {
  constructor() {
    super("The monthly allowance is not available in this product.");
    this.name = "AllowanceUnavailable";
  }
}

export type AllowanceField = keyof AllowanceSettingsWrite;
const FIELDS: readonly AllowanceField[] = ["aiCredits", "resetDay", "warnAtPercent"];

// 400: the server wrote nothing. Its message names the bad fields, "field:
// reason" joined with "; "; `fieldErrors` goes beside the inputs and
// `otherErrors` (no field named) above the buttons.
export class AllowanceSettingsRejected extends Error {
  constructor(
    readonly fieldErrors: Partial<Record<AllowanceField, string>>,
    readonly otherErrors: string[],
  ) {
    super([...Object.entries(fieldErrors).map(([field, reason]) => `${field}: ${reason}`), ...otherErrors].join("; "));
    this.name = "AllowanceSettingsRejected";
  }
}

function isField(name: string): name is AllowanceField {
  return (FIELDS as readonly string[]).includes(name);
}

function rejectionOf(message: string | undefined): AllowanceSettingsRejected {
  const fieldErrors: Partial<Record<AllowanceField, string>> = {};
  const otherErrors: string[] = [];
  for (const part of (message ?? "").split("; ").filter((p) => p.length > 0)) {
    const colon = part.indexOf(": ");
    const name = colon < 0 ? "" : part.slice(0, colon);
    if (isField(name)) {
      fieldErrors[name] = part.slice(colon + 2);
    } else {
      otherErrors.push(name === "body" ? part.slice(colon + 2) : part);
    }
  }
  if (Object.keys(fieldErrors).length === 0 && otherErrors.length === 0) {
    otherErrors.push("The settings were not accepted.");
  }
  return new AllowanceSettingsRejected(fieldErrors, otherErrors);
}

// The transport rejects with an ApiRequestError (status and the backend's
// message); 404 and, for the write, 400 get their own meaning here.
async function call(method: "getMonthlyAllowance" | "setMonthlyAllowance", params: unknown, signal: AbortSignal | undefined): Promise<MonthlyAllowanceAnswer> {
  try {
    return apiMethodResultSchemas[method].parse(await getApiTransport().call(method, params, signal));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      throw new AllowanceUnavailable();
    }
    if (error instanceof ApiRequestError && error.status === 400 && method === "setMonthlyAllowance") {
      throw rejectionOf(error.detail);
    }
    throw error;
  }
}

export function getMonthlyAllowance(signal?: AbortSignal): Promise<MonthlyAllowanceAnswer> {
  return call("getMonthlyAllowance", undefined, signal);
}

// Returns the fresh answer, so the header updates from one response.
export function setMonthlyAllowance(settings: AllowanceSettingsWrite, signal?: AbortSignal): Promise<MonthlyAllowanceAnswer> {
  return call("setMonthlyAllowance", { settings }, signal);
}
