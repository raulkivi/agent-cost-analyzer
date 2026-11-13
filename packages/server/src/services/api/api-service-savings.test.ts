// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { savingsReportSchema, type SavingsReport } from "@agent-cost-analyzer/domain";
import { UnknownLogProviderIdError } from "../../data-sources/log-providers/registry.js";
import { InvalidSavingsWindowError } from "../savings/savings-window.js";
import type { SavingsFilter, SavingsOptions, SavingsQueries } from "../savings/savings-service.js";
import { ApiService, SAVINGS_REPORT_UNAVAILABLE_MESSAGE, type ApiServiceDeps } from "./api-service.js";
import { BadRequestError, InternalError, NotFoundError } from "./api-errors.js";

// Phase 16 SR12 (docs/plans/savings-report.md §5.3, threat-model §11):
// getSavingsReport parses its query through savings-query-params.ts, calls the
// savings service and maps its failures to the API's typed errors; a product
// without the service answers 404.

const report: SavingsReport = {
  window: { since: "2026-10-08", until: "2026-11-06", days: 30 },
  pricing: "as-of-use",
  opportunities: [],
  simulated: [],
  notAnalysed: [],
};

interface Call {
  filter: SavingsFilter | undefined;
  options: SavingsOptions | undefined;
  signal: AbortSignal | undefined;
}

function fake(outcome: SavingsReport | Error = report) {
  const calls: Call[] = [];
  const queries: SavingsQueries = {
    async report(filter, options, signal) {
      calls.push({ filter, options, signal });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
  return { queries, calls };
}

const service = (savingsReport?: SavingsQueries) => new ApiService({ ...(savingsReport ? { savingsReport } : {}) } as ApiServiceDeps);

describe("ApiService savings report", () => {
  it("passes the parsed query on and answers a schema-valid report", async () => {
    const { queries, calls } = fake();

    const answer = await service(queries).getSavingsReport({ since: "2026-10-01", until: "2026-10-31", provider: "claude-code", pricing: "today", includeSimulated: "true" });

    expect(savingsReportSchema.parse(answer)).toEqual(report);
    expect(calls).toEqual([{ filter: { providerId: "claude-code", since: "2026-10-01", until: "2026-10-31" }, options: { pricing: "today", includeSimulated: true }, signal: undefined }]);
  });

  it("runs no replay and sets no window unless asked (D5, D8)", async () => {
    const { queries, calls } = fake();

    await service(queries).getSavingsReport();

    expect(calls[0]).toEqual({ filter: {}, options: { includeSimulated: false }, signal: undefined });
  });

  it("hands the caller's AbortSignal on, and never a limit", async () => {
    const { queries, calls } = fake();
    const controller = new AbortController();

    await service(queries).getSavingsReport({ limit: "100000" }, controller.signal);

    expect(calls[0]!.signal).toBe(controller.signal);
    expect(calls[0]!.filter).not.toHaveProperty("limit");
  });

  it("rejects a bad query as a bad request without calling the service", async () => {
    const { queries, calls } = fake();
    const api = service(queries);

    await expect(api.getSavingsReport({ since: "last week" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(api.getSavingsReport({ pricing: "cheapest" })).rejects.toBeInstanceOf(BadRequestError);
    await expect(api.getSavingsReport({ includeSimulated: "maybe" })).rejects.toThrow(/includeSimulated/);
    expect(calls).toEqual([]);
  });

  it("maps an inverted window and an unknown provider to 400", async () => {
    await expect(service(fake(new InvalidSavingsWindowError("since cannot be after until")).queries).getSavingsReport()).rejects.toMatchObject({
      constructor: BadRequestError,
      message: "since cannot be after until",
    });
    await expect(service(fake(new UnknownLogProviderIdError("nope")).queries).getSavingsReport({ provider: "nope" })).rejects.toBeInstanceOf(BadRequestError);
  });

  it("words any other failure as an internal error without its detail", async () => {
    const error = await service(fake(new Error("EACCES: /home/someone/x.jsonl")).queries).getSavingsReport().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InternalError);
  });

  it("lets a cancelled call's abort through unchanged", async () => {
    const controller = new AbortController();
    controller.abort();
    const { queries } = fake(controller.signal.reason as Error);

    await expect(service(queries).getSavingsReport({}, controller.signal)).rejects.toBe(controller.signal.reason);
  });

  it("answers 404 in a product without the savings service", async () => {
    await expect(service().getSavingsReport()).rejects.toThrow(new NotFoundError(SAVINGS_REPORT_UNAVAILABLE_MESSAGE));
  });
});
