// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  buildManifest,
  buildTempModelsJson,
  buildTempSettings,
  countSession,
  dashedPath,
  lastAssistantContextTokens,
  parseGeneratorArgs,
  refusalReason,
  resolvePiCommand,
  SCENARIOS,
} from "./generate-pi-fixtures-lib.mjs";

const line = (value: unknown): string => JSON.stringify(value);

const ownerModels = {
  providers: {
    ollama: { api: "openai-completions", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "x", models: [{ id: "other" }] },
    llamacpp: {
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:38080/v1",
      apiKey: "!secret-command",
      models: [
        { id: "a:setup1", contextWindow: 262144, _launch: true },
        { id: "b:setup6", contextWindow: 262144, reasoning: true, _launch: true },
      ],
    },
  },
};

describe("parseGeneratorArgs", () => {
  it("defaults to every scenario, a 310 s idle gap, no Gondolin", () => {
    const args = parseGeneratorArgs([]);
    expect(args.scenarios).toEqual(["s1", "s2", "s3", "s4"]);
    expect(args.idleSeconds).toBe(310);
    expect(args.gondolin).toBe(false);
    expect(args.keepTemp).toBe(false);
    expect(args.piCommand).toBeUndefined();
  });

  it("--quick drops the idle gap; --idle-seconds sets it", () => {
    expect(parseGeneratorArgs(["--quick"]).idleSeconds).toBe(0);
    expect(parseGeneratorArgs(["--idle-seconds", "12"]).idleSeconds).toBe(12);
  });

  it("reads --scenarios, --gondolin, --provider, --model, --out, --pi, --timeout-seconds and --keep-temp", () => {
    const args = parseGeneratorArgs([
      "--scenarios", "s1,s3", "--gondolin", "--provider", "llamacpp", "--model", "b:setup6",
      "--out", "/tmp/x", "--pi", "/opt/pi", "--timeout-seconds", "60", "--keep-temp",
    ]);
    expect(args).toMatchObject({
      scenarios: ["s1", "s3"], gondolin: true, provider: "llamacpp", model: "b:setup6",
      out: "/tmp/x", piCommand: "/opt/pi", timeoutSeconds: 60, keepTemp: true,
    });
  });

  it("rejects unknown flags and unknown scenarios", () => {
    expect(() => parseGeneratorArgs(["--nope"])).toThrow(/Unknown argument/);
    expect(() => parseGeneratorArgs(["--scenarios", "s9"])).toThrow(/Unknown scenario/);
  });
});

describe("resolvePiCommand", () => {
  it("finds the owner's pi on PATH, skipping node_modules/.bin (the repo's vendored pi is older)", () => {
    const executables = new Set(["/repo/node_modules/.bin/pi", "/home/u/bin/pi"]);
    const found = resolvePiCommand("/repo/node_modules/.bin:/home/u/bin:/usr/bin", (p) => executables.has(p));
    expect(found).toBe("/home/u/bin/pi");
  });

  it("returns null when only a vendored pi exists", () => {
    expect(resolvePiCommand("/repo/node_modules/.bin", () => true)).toBeNull();
  });
});

describe("refusalReason", () => {
  it("refuses in CI, where no model runs", () => {
    expect(refusalReason({ CI: "true" })).toMatch(/CI/);
    expect(refusalReason({ GITHUB_ACTIONS: "true" })).toMatch(/CI/);
  });

  it("allows a local run", () => {
    expect(refusalReason({})).toBeNull();
    expect(refusalReason({ CI: "false" })).toBeNull();
  });
});

describe("buildTempModelsJson", () => {
  it("keeps only the chosen provider and model, dropping launcher-only keys", () => {
    const models = buildTempModelsJson(ownerModels, "llamacpp", "b:setup6");
    expect(Object.keys(models.providers)).toEqual(["llamacpp"]);
    expect(models.providers.llamacpp.baseUrl).toBe("http://127.0.0.1:38080/v1");
    expect(models.providers.llamacpp.apiKey).toBe("!secret-command");
    expect(models.providers.llamacpp.models).toEqual([{ id: "b:setup6", contextWindow: 262144, reasoning: true }]);
  });

  it("applies contextWindow and maxTokens overrides to that model only", () => {
    const models = buildTempModelsJson(ownerModels, "llamacpp", "b:setup6", { contextWindow: 9000, maxTokens: 16384 });
    expect(models.providers.llamacpp.models[0]).toMatchObject({ contextWindow: 9000, maxTokens: 16384 });
  });

  it("fails with a clear message when the provider or model is not configured", () => {
    expect(() => buildTempModelsJson(ownerModels, "nope", "b:setup6")).toThrow(/provider "nope"/);
    expect(() => buildTempModelsJson(ownerModels, "llamacpp", "nope")).toThrow(/model "nope"/);
  });
});

describe("buildTempSettings", () => {
  it("selects the model and turns compaction on with the given budgets", () => {
    expect(buildTempSettings("llamacpp", "b:setup6", { reserveTokens: 100, keepRecentTokens: 200 })).toEqual({
      defaultProvider: "llamacpp",
      defaultModel: "b:setup6",
      quietStartup: true,
      compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 200 },
    });
  });
});

describe("dashedPath", () => {
  it("matches pi's session folder naming: no leading separator, separators as dashes", () => {
    expect(dashedPath("/tmp/pi-fixtures-abc/home")).toBe("tmp-pi-fixtures-abc-home");
  });
});

describe("lastAssistantContextTokens", () => {
  it("uses the last assistant usage's totalTokens, else the sum, as pi's calculateContextTokens does", () => {
    const text = [
      line({ type: "session", version: 3, id: "s", timestamp: "t", cwd: "/w" }),
      line({ type: "message", id: "1", message: { role: "assistant", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 } } }),
      line({ type: "message", id: "2", message: { role: "assistant", usage: { input: 100, output: 7, cacheRead: 3, cacheWrite: 0 } } }),
      "",
    ].join("\n");
    expect(lastAssistantContextTokens(text)).toBe(110);
  });

  it("returns null when no assistant usage exists", () => {
    expect(lastAssistantContextTokens(line({ type: "session" }))).toBeNull();
  });
});

describe("countSession", () => {
  it("counts entry types, turns, tool calls, compactions, context edits and assistant stop reasons", () => {
    const text = [
      line({ type: "session", version: 3, id: "s", timestamp: "t", cwd: "/w" }),
      line({ type: "message", id: "1", message: { role: "user", content: "x" } }),
      line({ type: "message", id: "2", message: { role: "assistant", stopReason: "toolUse", content: [] } }),
      line({ type: "message", id: "3", message: { role: "toolResult", toolName: "read" } }),
      line({ type: "message", id: "4", message: { role: "assistant", stopReason: "length", content: [] } }),
      line({ type: "context_edit", id: "5", targetId: "4", replacement: null }),
      line({ type: "compaction", id: "6" }),
      "not json",
      "",
    ].join("\n");
    expect(countSession(text)).toEqual({
      entryTypes: { session: 1, message: 4, context_edit: 1, compaction: 1 },
      messageRoles: { user: 1, assistant: 2, toolResult: 1 },
      stopReasons: { toolUse: 1, length: 1 },
      turns: 1,
      toolCalls: 1,
      compactions: 1,
      contextEdits: 1,
      malformedLines: 1,
    });
  });
});

describe("SCENARIOS", () => {
  it("defines S1 linear with 3-5 prompts and the idle gap between two of them", () => {
    const s1 = SCENARIOS.s1;
    expect(s1.stem).toBe("pi-linear");
    const prompts = s1.steps.filter((s) => s.kind === "prompt");
    expect(prompts.length).toBeGreaterThanOrEqual(3);
    expect(prompts.length).toBeLessThanOrEqual(5);
    expect(s1.steps.some((s) => s.kind === "idle")).toBe(true);
  });

  it("gives every scenario a deterministic, distinct file stem", () => {
    const stems = Object.values(SCENARIOS).map((s) => s.stem);
    expect(stems).toEqual(["pi-linear", "pi-compaction", "pi-context-edit", "pi-fork"]);
  });

  it("S2 compacts manually and then on threshold; S3 forces length recovery; S4 forks", () => {
    expect(SCENARIOS.s2.steps.some((s) => s.kind === "compact")).toBe(true);
    expect(SCENARIOS.s2.steps.some((s) => s.kind === "restart" && s.window === "threshold")).toBe(true);
    expect(SCENARIOS.s3.steps.some((s) => s.kind === "restart" && s.window === "length")).toBe(true);
    expect(SCENARIOS.s4.steps.some((s) => s.kind === "fork")).toBe(true);
  });
});

describe("buildManifest", () => {
  it("records pi version, model, variant, date and per-file counts, with no paths or usernames", () => {
    const manifest = buildManifest({
      piVersion: "1.5.2",
      provider: "llamacpp",
      model: "b:setup6",
      variant: "default",
      generatedOn: "2026-11-14",
      idleSeconds: 310,
      scenarios: [
        {
          id: "s1",
          stem: "pi-linear",
          status: "ok",
          files: [{ file: "pi-linear.jsonl", sidecar: "pi-linear.system-prompts.jsonl", sidecarRecords: 1, counts: {
            entryTypes: { session: 1 }, messageRoles: {}, stopReasons: {}, turns: 0, toolCalls: 0, compactions: 0, contextEdits: 0, malformedLines: 0,
          } }],
          durationSeconds: 12.3,
        },
      ],
    });
    expect(manifest).toMatchObject({
      generator: "packages/server/scripts/generate-pi-fixtures.mts",
      piVersion: "1.5.2",
      model: { provider: "llamacpp", id: "b:setup6" },
      variant: "default",
      generatedOn: "2026-11-14",
    });
    expect(JSON.stringify(manifest)).not.toMatch(/\/home\/|\/tmp\//);
  });
});
