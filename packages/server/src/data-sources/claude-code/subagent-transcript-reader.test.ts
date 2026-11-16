// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSubagentTranscript, slimRunEntry } from "./subagent-transcript-reader.js";
import { groupTurnRequestRounds } from "./round-grouper.js";
import { sumRoundUsage } from "./round-usage.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const assistant = (id: string, text: string) => ({
  type: "assistant",
  uuid: `u-${id}`,
  parentUuid: null,
  requestId: `req-${id}`,
  timestamp: "2026-10-01T09:00:01.000Z",
  agentId: "a0000000000000001",
  message: {
    id,
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [{ type: "text", text }],
    usage: { input_tokens: 3, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 },
  },
});

describe("slimRunEntry", () => {
  it("keeps the ids, model, usage and timestamps of an assistant line and drops its content", () => {
    const slim = slimRunEntry(assistant("m1", "a long private answer"));

    expect(JSON.stringify(slim)).not.toContain("private");
    expect(slim).toMatchObject({
      type: "assistant",
      requestId: "req-m1",
      timestamp: "2026-10-01T09:00:01.000Z",
      agentId: "a0000000000000001",
      message: { id: "m1", model: "claude-sonnet-5-5", usage: { input_tokens: 3, output_tokens: 4 } },
    });
    expect(slim).not.toHaveProperty("uuid");
  });

  it("gives the same sums as the full line", () => {
    const full = [assistant("m1", "x"), assistant("m2", "y")];
    const sums = (entries: unknown[]) => sumRoundUsage(groupTurnRequestRounds(entries as never));

    expect(sums(full.map((entry) => slimRunEntry(entry)))).toEqual(sums(full));
  });
});

describe("readSubagentTranscript", () => {
  it("streams the file, slims each line and skips unparsable ones", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "run-reader-"));
    temps.push(dir);
    const file = path.join(dir, "agent-a1.jsonl");
    writeFileSync(
      file,
      [
        JSON.stringify({ type: "user", message: { content: "private prompt" }, timestamp: "2026-10-01T09:00:00.000Z" }),
        JSON.stringify(assistant("m1", "x")),
        '{"type":"assis',
      ].join("\n"),
    );

    const entries = await readSubagentTranscript(file);

    expect(JSON.stringify(entries)).not.toContain("private");
    expect(entries.filter((entry) => entry.type === "assistant")).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "user", timestamp: "2026-10-01T09:00:00.000Z" });
  });

  it("keeps a non-assistant line only while it can still supply the first timestamp or agent id", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "run-reader-"));
    temps.push(dir);
    const file = path.join(dir, "agent-a1.jsonl");
    const user = (n: number) =>
      JSON.stringify({ type: "user", timestamp: "2026-10-01T09:00:00.000Z", agentId: "a0000000000000001", message: { content: `p${n}` } });
    writeFileSync(file, [user(1), user(2), user(3), JSON.stringify(assistant("m1", "x"))].join("\n"));

    const entries = await readSubagentTranscript(file);

    expect(entries.map((entry) => entry.type)).toEqual(["user", "assistant"]);
  });
});
