// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { costVarianceRequestSchema, parseCostCompareQuery, parseCostSeriesQuery, parseCostVarianceQuery, parsePriceChangesQuery } from "./cost-query-params.js";

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

// Step 15.10 (plan §10, §10.1.1 explain_cost_change, get_price_changes).
describe("parseCostVarianceQuery", () => {
  it("reads two months as periods A and B, in native currencies by default", () => {
    expect(parseCostVarianceQuery({ groupBy: "project", id: "app", periodA: "2026-08", periodB: "2026-10" })).toEqual({
      ok: true,
      value: {
        groupBy: "project",
        id: "app",
        periodA: { label: "2026-08", since: "2026-08-01", until: "2026-08-31" },
        periodB: { label: "2026-10", since: "2026-10-01", until: "2026-10-31" },
        currency: "native",
      },
    });
  });

  it("reads a since..until pair as a period, plus provider, limit and currency", () => {
    const parsed = parseCostVarianceQuery({ groupBy: "repository", id: "github.com/acme/app", periodA: "2026-09-01..2026-09-15", periodB: "2026-02", currency: "usd", provider: "vscode", limit: "50" });
    expect(parsed).toMatchObject({
      ok: true,
      value: { periodA: { label: "2026-09-01 – 2026-09-15", since: "2026-09-01", until: "2026-09-15" }, periodB: { since: "2026-02-01", until: "2026-02-28" }, currency: "usd", providerId: "vscode", limit: 50 },
    });
  });

  it("accepts a period object in the MCP form", () => {
    expect(costVarianceRequestSchema.parse({ groupBy: "project", id: "a", periodA: { since: "2026-08-01", until: "2026-08-10" }, periodB: "2026-10" }).periodA).toEqual({
      label: "2026-08-01 – 2026-08-10",
      since: "2026-08-01",
      until: "2026-08-10",
    });
  });

  it("refuses a missing id, a bad period and a reversed range", () => {
    expect(parseCostVarianceQuery({ groupBy: "project", periodA: "2026-08", periodB: "2026-10" }).ok).toBe(false);
    expect(parseCostVarianceQuery({ groupBy: "project", id: "a", periodA: "August", periodB: "2026-10" }).ok).toBe(false);
    expect(parseCostVarianceQuery({ groupBy: "project", id: "a", periodA: "2026-08-20..2026-08-01", periodB: "2026-10" }).ok).toBe(false);
    expect(parseCostVarianceQuery({ groupBy: "vendor", id: "a", periodA: "2026-08", periodB: "2026-10" }).ok).toBe(false);
  });
});

describe("parsePriceChangesQuery", () => {
  it("reads the range, channel, model and kind (both kinds by default)", () => {
    expect(parsePriceChangesQuery({})).toEqual({ ok: true, value: {} });
    expect(parsePriceChangesQuery({ since: "2026-10-01", until: "2026-10-31", channel: "github-copilot", model: "claude-sonnet-5.5", kind: "observed", provider: "vscode" })).toEqual({
      ok: true,
      value: { since: "2026-10-01", until: "2026-10-31", channel: "github-copilot", model: "claude-sonnet-5.5", kind: "observed", providerId: "vscode" },
    });
    expect(parsePriceChangesQuery({ kind: "rumoured" }).ok).toBe(false);
  });
});
