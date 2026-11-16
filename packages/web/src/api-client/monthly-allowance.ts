// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { monthlyAllowanceAnswerSchema, type AllowanceSettingsWrite, type MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { ApiRequestError } from "./api-request-error.js";

// MS6 (monthly-allowance-standalone.md §4.3, §4.6): the monthly allowance
// answer (GET /api/monthly-allowance) and its write (PUT
// /api/config/monthly-allowance). Standalone app only: the extension has no
// allowance store and no RPC method (§4.3), so this talks HTTP directly
// instead of going through the ApiTransport, and the UI reaches it only behind
// `ProductFeatures.monthlyAllowance`. Answers are parsed with the domain
// schema, so a server that drifts fails here rather than showing wrong figures.

const ANSWER_URL = "/api/monthly-allowance";
const WRITE_URL = "/api/config/monthly-allowance";

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

// The server's error body is `{ error: message }`.
async function errorMessageOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    const message = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
    return typeof message === "string" && message.length > 0 ? message : undefined;
  } catch {
    return undefined;
  }
}

async function answerOf(response: Response, url: string, onBadRequest?: (message: string | undefined) => Error): Promise<MonthlyAllowanceAnswer> {
  if (response.ok) {
    return monthlyAllowanceAnswerSchema.parse(await response.json());
  }
  if (response.status === 404) {
    throw new AllowanceUnavailable();
  }
  const message = await errorMessageOf(response);
  if (response.status === 400 && onBadRequest) {
    throw onBadRequest(message);
  }
  throw new ApiRequestError(url, response.status, message);
}

export async function getMonthlyAllowance(signal?: AbortSignal): Promise<MonthlyAllowanceAnswer> {
  return answerOf(await fetch(ANSWER_URL, signal ? { signal } : undefined), ANSWER_URL);
}

// Returns the fresh answer, so the header updates from one response.
export async function setMonthlyAllowance(settings: AllowanceSettingsWrite, signal?: AbortSignal): Promise<MonthlyAllowanceAnswer> {
  const response = await fetch(WRITE_URL, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
    ...(signal ? { signal } : {}),
  });
  return answerOf(response, WRITE_URL, rejectionOf);
}
