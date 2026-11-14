// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPromptEchoTitle, readFirstUserPrompt } from "./agent-host-prompt-title.js";

const PROMPT = "Please refactor the billing module so that retries are idempotent and add tests for every failure path";

describe("isPromptEchoTitle", () => {
  it("is true when the title is the start of the first prompt", () => {
    expect(isPromptEchoTitle("Please refactor the billing module", PROMPT)).toBe(true);
  });

  it("is true when the title is the whole prompt", () => {
    expect(isPromptEchoTitle("Fix the build", "Fix the build")).toBe(true);
  });

  it.each(["...", "\u2026"])("is true for a truncated prompt ending in the ellipsis %j", (ellipsis) => {
    expect(isPromptEchoTitle(`Please refactor the billing module so that ${ellipsis}`, PROMPT)).toBe(true);
  });

  it("is true when the title ends with an ellipsis after the whole (short) prompt", () => {
    expect(isPromptEchoTitle("Fix the build...", "Fix the build")).toBe(true);
  });

  it("ignores surrounding whitespace and line-break style", () => {
    expect(isPromptEchoTitle("  Fix the build\r\nand the lint  ", "Fix the build\nand the lint\n\nthen deploy")).toBe(true);
    expect(isPromptEchoTitle("Fix the build and the lint", "Fix the build\nand the lint")).toBe(true);
    expect(isPromptEchoTitle("Fix the build", "Fix the build\u2028and more")).toBe(true);
  });

  it("is false for a title the user set", () => {
    expect(isPromptEchoTitle("Billing retries", PROMPT)).toBe(false);
    expect(isPromptEchoTitle("Refactor billing", PROMPT)).toBe(false);
  });

  it("is false when the prompt is only the start of a longer, different title", () => {
    expect(isPromptEchoTitle("Fix the build and then some other work", "Fix the build")).toBe(false);
  });

  it("is false for an empty title, an empty prompt or a title that is only an ellipsis", () => {
    expect(isPromptEchoTitle("", PROMPT)).toBe(false);
    expect(isPromptEchoTitle("Fix", "  ")).toBe(false);
    expect(isPromptEchoTitle("...", PROMPT)).toBe(false);
    expect(isPromptEchoTitle("\u2026", PROMPT)).toBe(false);
  });
});

describe("readFirstUserPrompt", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "first-prompt-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeLog = (lines: unknown[]): string => {
    const file = path.join(dir, "events.jsonl");
    writeFileSync(file, lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n");
    return file;
  };

  it("returns the content of the first user.message and ignores later ones", async () => {
    const file = writeLog([
      { id: "1", type: "session.start", data: {} },
      { id: "2", type: "user.message", data: { content: "first" } },
      { id: "3", type: "user.message", data: { content: "second" } },
    ]);

    await expect(readFirstUserPrompt(file)).resolves.toBe("first");
  });

  it("skips malformed lines and a user.message without text content", async () => {
    const file = writeLog([
      '{"type":"user.message" oops',
      { id: "2", type: "user.message", data: { content: 5 } },
      { id: "3", type: "user.message", data: { content: "real" } },
    ]);

    await expect(readFirstUserPrompt(file)).resolves.toBe("real");
  });

  it("returns null for a missing file or a log without a user message", async () => {
    await expect(readFirstUserPrompt(path.join(dir, "nope.jsonl"))).resolves.toBeNull();
    await expect(readFirstUserPrompt(writeLog([{ id: "1", type: "session.start", data: {} }]))).resolves.toBeNull();
  });
});
