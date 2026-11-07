// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// What a transport rejects with when the backend answers with an error: the
// status and, when the backend gave one, its own message (step 14.7: a
// replay's 404 says why the session can't be replayed, a 400 what was wrong
// with the request). The message keeps the "failed with status N" wording
// every view already shows, with the backend's words after it.
export class ApiRequestError extends Error {
  constructor(
    target: string,
    readonly status: number | undefined,
    readonly detail: string | undefined,
  ) {
    super(`Request to ${target} failed with status ${String(status)}${detail ? `: ${detail}` : ""}`);
    this.name = "ApiRequestError";
  }
}

// The backend's own words for a failed request, else the whole message.
export function apiErrorDetail(error: unknown): string {
  if (error instanceof ApiRequestError && error.detail) return error.detail;
  return error instanceof Error ? error.message : String(error);
}
