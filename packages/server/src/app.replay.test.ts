// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_COMPARED_MODELS,
  sessionReplayComparisonSchema,
  sessionReplaySchema,
} from "@agent-cost-analyzer/domain";
import { createApp } from "./app.js";
import { computeClaudeCodeFileHash } from "./data-sources/claude-code/session-id.js";

// Phase 14 step 14.5 (docs/plans/analyze-session-replay.md §9,
// threat-model.md §4): GET /api/sessions/:id/replay and /replay/compare over
// the real standalone composition. Read-only, bounded (model ids from a
// vendor profile, at most 10 models) and redacted (no file path leaves).
const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/claude-code",
);
const sessionId = computeClaudeCodeFileHash(
  path.join(fixturesDir, "-home-dev-project", "normal-session.jsonl"),
);
const replayPath = `/api/sessions/${sessionId}/replay`;
const comparePath = `${replayPath}/compare`;

describe("session replay API", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "app-replay-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function buildApp() {
    return createApp({
      sessionStoreDbPath: path.join(dir, "missing.db"),
      debugLogsDirPaths: [],
      vscodeSettingsPath: null,
      agentTracesDbPath: null,
      agentHostUserDataDir: null,
      appSettingsDir: path.join(dir, "settings"),
      mitmproxyCapturesDirPath: null,
      piAgentSessionsDirPath: null,
      systemPromptLogPath: null,
      claudeCodeProjectsDirPath: fixturesDir,
      now: () => new Date("2026-11-07T12:00:00.000Z"),
    });
  }

  function expectNoPaths(text: string) {
    expect(text).not.toContain(fixturesDir);
    expect(text).not.toContain(dir);
    expect(text).not.toContain(homedir());
    expect(text).not.toMatch(/\.jsonl/);
  }

  it("replays a Claude Code session on another model, labelled simulated", async () => {
    const response = await request(buildApp())
      .get(replayPath)
      .query({ model: "claude-haiku-5.5", provider: "claude-code" });
    expect(response.status).toBe(200);
    const replay = sessionReplaySchema.parse(response.body);
    expect(replay).toMatchObject({
      simulated: true,
      sessionId,
      providerId: "claude-code",
      model: "claude-haiku-5.5",
      vendorId: "anthropic",
      pricing: { requested: "session-channel" },
    });
    expectNoPaths(response.text);
  });

  it("reads through the active provider when none is named, and takes a pricing", async () => {
    const app = buildApp();
    await request(app)
      .put("/api/log-providers/active")
      .send({ id: "claude-code" });
    const response = await request(app)
      .get(replayPath)
      .query({ model: "claude-haiku-5.5", pricing: "api" });
    expect(response.status).toBe(200);
    expect(sessionReplaySchema.parse(response.body).pricing.requested).toBe(
      "api",
    );
  });

  it("compares the session's models, its own included", async () => {
    const response = await request(buildApp()).get(comparePath).query({
      models: "claude-haiku-5.5,claude-haiku-5.5",
      provider: "claude-code",
    });
    expect(response.status).toBe(200);
    const comparison = sessionReplayComparisonSchema.parse(response.body);
    expect(comparison.simulated).toBe(true);
    expect(comparison.entries.map((entry) => entry.model)).toContain(
      "claude-haiku-5.5",
    );
    expect(comparison.entries.some((entry) => entry.isMeasuredModel)).toBe(
      true,
    );
    expectNoPaths(response.text);
  });

  it("answers 404 for an unknown session, with no path in the error", async () => {
    const response = await request(buildApp())
      .get("/api/sessions/nope/replay")
      .query({ model: "claude-haiku-5.5", provider: "claude-code" });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'Unknown session id "nope"' });
    const compare = await request(buildApp())
      .get("/api/sessions/nope/replay/compare")
      .query({ models: "claude-haiku-5.5", provider: "claude-code" });
    expect(compare.status).toBe(404);
  });

  it("answers 400 for a model no vendor profile lists, a bad query or an unknown provider", async () => {
    const app = buildApp();
    const unknown = await request(app)
      .get(replayPath)
      .query({ model: "not-a-model", provider: "claude-code" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toEqual(expect.any(String));
    expectNoPaths(unknown.text);
    const cases = [
      request(app).get(replayPath).query({ provider: "claude-code" }),
      request(app).get(replayPath).query({
        model: "claude-haiku-5.5",
        pricing: "contract",
        provider: "claude-code",
      }),
      request(app)
        .get(replayPath)
        .query({ model: "claude-haiku-5.5", provider: "nope" }),
      request(app)
        .get(comparePath)
        .query({ models: "", provider: "claude-code" }),
      request(app)
        .get(comparePath)
        .query({ models: "not-a-model", provider: "claude-code" }),
      request(app)
        .get(comparePath)
        .query({
          models: Array.from(
            { length: MAX_COMPARED_MODELS + 1 },
            (_, i) => `model-${i}`,
          ).join(","),
          provider: "claude-code",
        }),
    ];
    for (const response of await Promise.all(cases)) {
      expect(response.status, response.text).toBe(400);
    }
  });

  it("is read-only: nothing but GET is routed", async () => {
    const app = buildApp();
    for (const target of [replayPath, comparePath]) {
      expect((await request(app).post(target).send({})).status).toBe(404);
      expect((await request(app).put(target).send({})).status).toBe(404);
      expect((await request(app).delete(target)).status).toBe(404);
    }
  });

  it("is behind the loopback Host guard (DNS rebinding)", async () => {
    const response = await request(buildApp())
      .get(replayPath)
      .query({ model: "claude-haiku-5.5", provider: "claude-code" })
      .set("Host", "evil.example.com");
    expect(response.status).toBe(403);
  });
});
