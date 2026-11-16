// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { monthlyAllowanceAnswerSchema, type Session, type TokenCount } from "@agent-cost-analyzer/domain";
import { createApp } from "./app.js";
import type { LogProvider } from "./data-sources/log-providers/log-provider.js";

// MS4 (monthly-allowance-standalone.md §4.3, §4.6): GET and PUT
// /api/monthly-allowance over the real composition. The VS Code provider is
// replaced by a fake with the same id (the registry keeps the last one), so
// the sessions and their costs are exact.

const NOW = new Date("2026-11-12T12:00:00.000Z");
const HOSTILE = "SECRET-TITLE <img src=x onerror=alert(1)> /home/u/private-repo";

function session(id: string, startedAt: string, cost: number | null, extra: Partial<Session> = {}): Session {
  const costAiCredits: TokenCount = cost === null ? { known: false, reason: "no data" } : { known: true, value: cost };
  return { id, mode: "analyze", providerId: "vscode", title: HOSTILE, model: "m", turns: [], turnCount: 1, costAiCredits, usageDataAvailable: true, startedAt, ...extra };
}

function fakeVscode(sessions: Session[], available = true): LogProvider {
  return {
    id: "vscode",
    label: "VS Code",
    async checkAvailability() {
      return available ? { available } : { available, unavailableReason: "No logs on this machine." };
    },
    async listSessions() {
      return sessions;
    },
    async readSession() {
      return null;
    },
    async readTurnDetail() {
      return null;
    },
  };
}

describe("monthly allowance API", () => {
  let dir: string;
  let settingsDir: string;
  const settingsFile = () => path.join(settingsDir, "settings.json");
  const seed = (settings: object) => writeFileSync(settingsFile(), JSON.stringify(settings));

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-allowance-test-"));
    settingsDir = path.join(dir, "settings");
    mkdirSync(settingsDir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp(sessions: Session[] = [], available = true) {
    return createApp({
      sessionStoreDbPath: path.join(dir, "missing.db"),
      debugLogsDirPaths: [],
      vscodeSettingsPath: null,
      agentTracesDbPath: null,
      agentHostUserDataDir: null,
      appSettingsDir: settingsDir,
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: null,
      additionalLogProviders: [fakeVscode(sessions, available)],
      now: () => NOW,
      timeZone: "UTC",
    });
  }

  const get = async (app: ReturnType<typeof buildApp>) => {
    const response = await request(app).get("/api/monthly-allowance");
    expect(response.status).toBe(200);
    return monthlyAllowanceAnswerSchema.parse(response.body);
  };

  it("not-set: no allowance stored", async () => {
    const answer = await get(buildApp([session("a", "2026-11-03T09:00:00Z", 5)]));
    expect(answer).toMatchObject({ state: "not-set", settings: { aiCredits: null, resetDay: 1, warnAtPercent: 80 }, asOf: NOW.toISOString() });
    expect(answer.figures).toBeUndefined();
  });

  it("no-source: the Copilot logs are unavailable", async () => {
    seed({ monthlyAllowance: { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 } });
    const answer = await get(buildApp([], false));
    expect(answer).toMatchObject({ state: "no-source", source: { available: false, reason: "No logs on this machine.", byHarness: [] } });
  });

  it("no-sessions, unknown and known follow the sessions of the period", async () => {
    seed({ monthlyAllowance: { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 } });
    expect((await get(buildApp([session("old", "2026-10-03T09:00:00Z", 5)]))).state).toBe("no-sessions");
    const unknown = await get(buildApp([session("u", "2026-11-03T09:00:00Z", null)]));
    expect(unknown).toMatchObject({ state: "unknown", figures: { coverage: { known: 0, total: 1 }, countedSinceKey: "2026-11-03" } });
    const known = await get(buildApp([session("k", "2026-11-03T09:00:00Z", 850), session("p", "2026-11-04T09:00:00Z", null, { copilotHarness: "agent-host" })]));
    expect(known).toMatchObject({
      state: "known",
      figures: { level: "near", used: 850, atLeast: true, percent: 85, remaining: 150, coverage: { known: 1, total: 2 } },
      source: { available: true, variant: null, byHarness: [{ harness: "local", known: 1, total: 1, used: 850 }, { harness: "agent-host", known: 0, total: 1, used: null }] },
    });
  });

  it("a harness with no session in the period is not listed", async () => {
    seed({ monthlyAllowance: { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 } });
    const answer = await get(buildApp([session("k", "2026-11-03T09:00:00Z", 10), session("old", "2026-09-03T09:00:00Z", 10, { copilotHarness: "agent-host" })]));
    expect(answer.source.byHarness.map((row) => row.harness)).toEqual(["local"]);
  });

  it("still counts the VS Code sessions when pi is the active provider", async () => {
    seed({ activeProviderId: "pi-agent", monthlyAllowance: { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 } });
    const answer = await get(buildApp([session("k", "2026-11-03T09:00:00Z", 100)]));
    expect(answer).toMatchObject({ state: "known", figures: { used: 100 } });
  });

  it("never puts a title, id or path in the answer", async () => {
    seed({ monthlyAllowance: { aiCredits: 1000, resetDay: 1, warnAtPercent: 80 } });
    const response = await request(buildApp([session("secret-session-id", "2026-11-03T09:00:00Z", 100)])).get("/api/monthly-allowance");
    expect(response.text).not.toMatch(/SECRET|onerror|private-repo|secret-session-id/);
  });

  describe("PUT", () => {
    const put = (app: ReturnType<typeof buildApp>, body: unknown) => request(app).put("/api/monthly-allowance").send(body as object);
    const valid = { aiCredits: 1000, resetDay: 5, warnAtPercent: 90 };

    it("writes the settings, keeps other keys and answers the fresh figures", async () => {
      seed({ activeProviderId: "pi-agent" });
      const app = buildApp([session("k", "2026-11-06T09:00:00Z", 950)]);
      const response = await put(app, valid);
      expect(response.status).toBe(200);
      expect(monthlyAllowanceAnswerSchema.parse(response.body)).toMatchObject({ state: "known", settings: valid, period: { startKey: "2026-11-05" }, figures: { level: "near", percent: 95 } });
      expect(JSON.parse(readFileSync(settingsFile(), "utf8"))).toEqual({ activeProviderId: "pi-agent", monthlyAllowance: valid });
      expect(await get(app)).toMatchObject({ settings: valid });
    });

    it("null removes the allowance and keeps the other two", async () => {
      seed({ monthlyAllowance: valid });
      const response = await put(buildApp(), { ...valid, aiCredits: null });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ state: "not-set", settings: { aiCredits: null, resetDay: 5, warnAtPercent: 90 } });
      expect(JSON.parse(readFileSync(settingsFile(), "utf8")).monthlyAllowance).toEqual({ ...valid, aiCredits: null });
    });

    const bad: [string, unknown][] = [
      ["zero", { ...valid, aiCredits: 0 }],
      ["negative", { ...valid, aiCredits: -1 }],
      ["NaN as a string", { ...valid, aiCredits: "NaN" }],
      ["above the cap", { ...valid, aiCredits: 1_000_000_001 }],
      ["reset day 29", { ...valid, resetDay: 29 }],
      ["warn 101", { ...valid, warnAtPercent: 101 }],
      ["a fractional reset day", { ...valid, resetDay: 1.5 }],
      ["an unknown key", { ...valid, extra: 1 }],
      ["a missing field", { aiCredits: 5 }],
    ];
    it.each(bad)("400 and writes nothing: %s", async (_name, body) => {
      const response = await put(buildApp(), body);
      expect(response.status).toBe(400);
      expect(response.body.error).toEqual(expect.any(String));
      expect(existsSync(settingsFile())).toBe(false);
    });

    it("400 and leaves the stored value for a form body", async () => {
      seed({ monthlyAllowance: valid });
      const before = readFileSync(settingsFile(), "utf8");
      const response = await request(buildApp()).put("/api/monthly-allowance").type("form").send("aiCredits=5&resetDay=1&warnAtPercent=80");
      expect(response.status).toBe(400);
      expect(readFileSync(settingsFile(), "utf8")).toBe(before);
    });

    it("names the field in the 400 message", async () => {
      const response = await put(buildApp(), { ...valid, resetDay: 29 });
      expect(response.body.error).toMatch(/resetDay/);
    });
  });

  it("the product profile says the standalone app has the gauge", async () => {
    const response = await request(buildApp()).get("/api/product");
    expect(response.body.features.monthlyAllowance).toBe(true);
  });
});
