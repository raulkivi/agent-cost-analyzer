import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSystemPromptSidecarIndex } from "./system-prompt-sidecar-reader.js";

function record(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sessionId: "session-1",
    sessionFile: "/home/dev/.pi/agent/sessions/session-1.jsonl",
    capturedAt: "2026-09-03T10:00:00.000Z",
    cwd: "/home/dev/project",
    systemPromptChars: 4,
    systemPrompt: "test",
    ...overrides,
  };
}

describe("readSystemPromptSidecarIndex", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pi-system-prompt-sidecar-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty index when the path is null", async () => {
    await expect(readSystemPromptSidecarIndex(null)).resolves.toEqual(
      new Map(),
    );
  });

  it("returns an empty index when the file does not exist", async () => {
    const filePath = path.join(dir, "does-not-exist.jsonl");

    await expect(readSystemPromptSidecarIndex(filePath)).resolves.toEqual(
      new Map(),
    );
  });

  it("indexes a record keyed by its resolved sessionFile path", async () => {
    const sessionFile = path.join(dir, "sessions", "s1.jsonl");
    const filePath = path.join(dir, "system-prompts.jsonl");
    writeFileSync(filePath, `${JSON.stringify(record({ sessionFile }))}\n`);

    const index = await readSystemPromptSidecarIndex(filePath);

    expect(index.get(path.resolve(sessionFile))?.systemPrompt).toBe("test");
  });

  it("keeps the earliest record when two lines share the same resolved sessionFile", async () => {
    const sessionFile = path.join(dir, "sessions", "s1.jsonl");
    const filePath = path.join(dir, "system-prompts.jsonl");
    const first = record({
      sessionFile,
      capturedAt: "2026-09-03T10:00:00.000Z",
      systemPrompt: "first",
    });
    const second = record({
      sessionFile,
      capturedAt: "2026-09-03T11:00:00.000Z",
      systemPrompt: "second",
    });
    writeFileSync(
      filePath,
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    );

    const index = await readSystemPromptSidecarIndex(filePath);

    expect(index.get(path.resolve(sessionFile))?.systemPrompt).toBe("first");
  });

  it("skips a record with no sessionFile", async () => {
    const filePath = path.join(dir, "system-prompts.jsonl");
    const noFile = record();
    delete (noFile as { sessionFile?: string }).sessionFile;
    writeFileSync(filePath, `${JSON.stringify(noFile)}\n`);

    const index = await readSystemPromptSidecarIndex(filePath);

    expect(index.size).toBe(0);
  });

  it("skips a malformed JSON line and a line missing required fields, keeping valid lines around them", async () => {
    const sessionFile = path.join(dir, "sessions", "s1.jsonl");
    const filePath = path.join(dir, "system-prompts.jsonl");
    const lines = [
      "not json at all {",
      JSON.stringify({ sessionFile, cwd: "/repo" }), // missing required fields
      JSON.stringify(record({ sessionFile })),
    ];
    writeFileSync(filePath, `${lines.join("\n")}\n`);

    const index = await readSystemPromptSidecarIndex(filePath);

    expect(index.size).toBe(1);
    expect(index.get(path.resolve(sessionFile))?.systemPrompt).toBe("test");
  });
});
