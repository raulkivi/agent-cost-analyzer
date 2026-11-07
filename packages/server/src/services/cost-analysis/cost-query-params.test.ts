// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseCostCompareQuery, parseCostSeriesQuery } from "./cost-query-params.js";

// Phase 15 step 15.7 (plan §10, §10.1.4): the query parameters of
// GET /api/cost/timeseries and /api/cost/compare, parsed by the same zod
// schemas the MCP tools' arguments use.

describe("parseCostSeriesQuery", () => {
  it("defaults to monthly buckets, the preferred basis, prices as of use and native currencies", () => {
    expect(parseCostSeriesQuery({})).toEqual({ ok: true, value: { bucket: "month", basis: "preferred", pricing: "as-of-use", currency: "native" } });
  });

  it("reads every option, with ids comma-separated", () => {
    expect(
      parseCostSeriesQuery({
        provider: "vscode",
        limit: "100",
        since: "2026-10-01",
        until: "2026-10-31",
        bucket: "week",
        basis: "priced",
        pricing: "today",
        currency: "usd",
        groupBy: "repository",
        ids: "github.com/acme/app, local:scratch",
      }),
    ).toEqual({
      ok: true,
      value: {
        providerId: "vscode",
        limit: 100,
        since: "2026-10-01",
        until: "2026-10-31",
        bucket: "week",
        basis: "priced",
        pricing: "today",
        currency: "usd",
        groupBy: "repository",
        ids: ["github.com/acme/app", "local:scratch"],
      },
    });
  });

  it.each([
    [{ bucket: "year" }],
    [{ basis: "cheapest" }],
    [{ pricing: "tomorrow" }],
    [{ currency: "eur" }],
    [{ since: "2026-10-01T10:00:00Z" }],
    [{ since: "2026-02-30" }],
    [{ since: "2026-10-31", until: "2026-10-01" }],
    [{ ids: "a,b" }],
    [{ groupBy: "model", ids: Array.from({ length: 21 }, (_, i) => `m${i}`).join(",") }],
    [{ groupBy: "project", ids: "a,a" }],
    [{ bucket: ["day", "week"] }],
    [{ limit: "ten" }],
  ])("rejects %j", (query) => {
    expect(parseCostSeriesQuery(query).ok).toBe(false);
  });
});

describe("parseCostCompareQuery", () => {
  const base = { groupBy: "project", ids: "app,portal", since: "2026-10-01", until: "2026-10-31" };

  it("reads the period and ids, comparing with the previous period by default", () => {
    expect(parseCostCompareQuery(base)).toEqual({
      ok: true,
      value: {
        groupBy: "project",
        ids: ["app", "portal"],
        since: "2026-10-01",
        until: "2026-10-31",
        comparePeriod: "previous",
        basis: "preferred",
        pricing: "as-of-use",
        currency: "native",
      },
    });
    expect(parseCostCompareQuery({ ...base, comparePeriod: "last-year" })).toMatchObject({ ok: true, value: { comparePeriod: "last-year" } });
  });

  it.each([
    [{ ...base, groupBy: "vendor" }],
    [{ ...base, ids: "app" }],
    [{ ...base, ids: Array.from({ length: 21 }, (_, i) => `p${i}`).join(",") }],
    [{ ...base, since: undefined }],
    [{ ...base, until: undefined }],
    [{ ...base, comparePeriod: "last-week" }],
  ])("rejects %j", (query) => {
    expect(parseCostCompareQuery(query).ok).toBe(false);
  });
});
