// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseSavingsQuery } from "./savings-query-params.js";

// Phase 16 SR12 (docs/plans/savings-report.md §5.3, threat-model §11): the
// savings routes' options, shared by HTTP, the webview RPC and (SR16) MCP.

describe("parseSavingsQuery", () => {
  it("takes no input as the defaults: no simulated replays, everything else left to the service", () => {
    expect(parseSavingsQuery({})).toEqual({ ok: true, value: { includeSimulated: false } });
  });

  it("takes a window, a provider, a pricing mode and the simulated flag", () => {
    const parsed = parseSavingsQuery({ since: "2026-10-01", until: "2026-10-31", provider: "claude-code", pricing: "today", includeSimulated: "true" });

    expect(parsed).toEqual({ ok: true, value: { since: "2026-10-01", until: "2026-10-31", providerId: "claude-code", pricing: "today", includeSimulated: true } });
  });

  it("takes providerId (MCP) as well as provider (HTTP) and a real boolean (RPC, MCP)", () => {
    expect(parseSavingsQuery({ providerId: "pi-agent", includeSimulated: true })).toEqual({ ok: true, value: { providerId: "pi-agent", includeSimulated: true } });
  });

  it("counts empty strings as absent, as the other routes do", () => {
    expect(parseSavingsQuery({ since: "", provider: "", pricing: "", includeSimulated: "" })).toEqual({ ok: true, value: { includeSimulated: false } });
  });

  it.each([
    [{ since: "2026-1-1" }, "since"],
    [{ since: "yesterday" }, "since"],
    [{ until: "2026-02-30" }, "until"],
    [{ until: "2026-13-45" }, "until"],
    [{ since: ["2026-10-01", "2026-10-02"] }, "since"],
    [{ pricing: "cheapest" }, "pricing"],
    [{ includeSimulated: "yes" }, "includeSimulated"],
    [{ includeSimulated: 1 }, "includeSimulated"],
    [{ provider: 7 }, "providerId"],
  ])("rejects %j, naming %s", (query, field) => {
    const parsed = parseSavingsQuery(query);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error).toContain(field);
  });

  it("has no public limit: the session cap is the service's alone", () => {
    const parsed = parseSavingsQuery({ limit: "1000000" });

    expect(parsed).toEqual({ ok: true, value: { includeSimulated: false } });
  });
});
