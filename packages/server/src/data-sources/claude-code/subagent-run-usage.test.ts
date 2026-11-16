// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { subagentLabelSchema, subagentRunIdSchema } from "@agent-cost-analyzer/domain";
import { readClaudeCodeSessionFile, type ClaudeCodeRawEntry } from "./claude-code-jsonl-reader.js";
import { extractClaudeCodeRunUsage } from "./subagent-run-usage.js";

const FIXTURES = fileURLToPath(new URL("../../../fixtures/claude-code/subagents/", import.meta.url));
const SESSION_DIRS: Record<string, string> = {
  "fork-copy": "c3c3c3c3-0003-4000-8000-000000000003",
  "nested-fork-copy": "c3c3c3c3-0004-4000-8000-000000000004",
  "partial-last-line": "c3c3c3c3-0008-4000-8000-000000000008",
  "synthetic-round": "c3c3c3c3-000a-4000-8000-00000000000a",
  "one-hour-cache": "c3c3c3c3-000b-4000-8000-00000000000b",
};

async function transcript(fixture: string, agentId: string): Promise<ClaudeCodeRawEntry[]> {
  const path = join(FIXTURES, fixture, "-home-dev-project", SESSION_DIRS[fixture], "subagents", `agent-${agentId}.jsonl`);
  return (await readClaudeCodeSessionFile(path)).entries;
}

const known = (value: number) => ({ known: true, value });

function assistant(messageId: string, usage: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}): ClaudeCodeRawEntry {
  return {
    type: "assistant",
    agentId: "a0000000000000001",
    requestId: `req_${messageId}`,
    message: { id: messageId, model: "claude-sonnet-5-5", content: [], usage },
    ...extra,
  };
}

describe("extractClaudeCodeRunUsage", () => {
  it("sums a run's rounds once per message.id and names it from the meta", async () => {
    const entries = await transcript("nested-fork-copy", "a411111111111111a");

    const { usage, requestIds } = extractClaudeCodeRunUsage(entries, { agentType: "general-purpose" }, new Set());

    expect(usage.label).toBe("Agent-general-purpose");
    expect(usage.roundsCount).toBe(3);
    expect(usage.uncachedInput).toEqual(known(300 + 320 + 340));
    expect(usage.output).toEqual(known(40 + 55 + 30));
    expect(usage.cacheRead).toEqual(known(0 + 600 + 650));
    expect(usage.model).toBe("claude-sonnet-5-5");
    expect(usage.costAiCredits.known).toBe(false);
    expect(requestIds).toEqual(new Set(["msg_nf_a1", "req_msg_nf_a1", "msg_nf_a2", "req_msg_nf_a2", "msg_nf_a3", "req_msg_nf_a3"]));
  });

  it("uses the bare label and the run id from agentId", async () => {
    const entries = await transcript("fork-copy", "a311111111111111a");

    const { usage } = extractClaudeCodeRunUsage(entries, {}, new Set());

    expect(usage.label).toBe("Agent");
    expect(usage.id).toBe("a311111111111111a");
    expect(subagentRunIdSchema.safeParse(usage.id).success).toBe(true);
    expect(subagentLabelSchema.safeParse(usage.label).success).toBe(true);
  });

  it("keeps the 1-hour cache-write split", async () => {
    const entries = await transcript("one-hour-cache", "ab11111111111111a");

    const { usage } = extractClaudeCodeRunUsage(entries, { agentType: "general-purpose" }, new Set());

    expect(usage.cacheWrite).toEqual(known(900));
    expect(usage.extendedCacheWrite?.known).toBe(true);
    const extended = usage.extendedCacheWrite as { value: number };
    expect(extended.value).toBeGreaterThan(0);
    expect(extended.value).toBeLessThanOrEqual(900);
    expect(usage.model).toBe("claude-opus-5-5");
  });

  it("skips rounds copied from the parent by requestId or message.id (depth-1 fork)", async () => {
    const entries = await transcript("fork-copy", "a311111111111111a");

    const { usage, requestIds } = extractClaudeCodeRunUsage(entries, { isFork: true }, new Set(["req_msg_fork-copy_s1"]));

    expect(usage.roundsCount).toBe(2);
    expect(usage.uncachedInput).toEqual(known(500 + 520));
    expect(requestIds.has("msg_fork-copy_s1")).toBe(false);

    const byMessageId = extractClaudeCodeRunUsage(entries, { isFork: true }, new Set(["msg_fork-copy_s1"]));
    expect(byMessageId.usage.roundsCount).toBe(2);
  });

  it("skips the parent run's rounds for a nested fork", async () => {
    const parent = extractClaudeCodeRunUsage(await transcript("nested-fork-copy", "a411111111111111a"), {}, new Set());
    const entries = await transcript("nested-fork-copy", "a422222222222222b");

    const { usage } = extractClaudeCodeRunUsage(entries, { isFork: true, spawnDepth: 2 }, parent.requestIds);

    expect(usage.roundsCount).toBe(1);
    expect(usage.uncachedInput).toEqual(known(360));
    expect(usage.output).toEqual(known(45));
  });

  it("leaves a <synthetic> round out of the sums, the count and the model", async () => {
    const entries = await transcript("synthetic-round", "aa11111111111111a");

    const { usage } = extractClaudeCodeRunUsage(entries, {}, new Set());

    expect(usage.roundsCount).toBe(1);
    expect(usage.uncachedInput).toEqual(known(300));
    expect(usage.model).toBe("claude-sonnet-5-5");
  });

  it("marks a figure unknown when a round has no usage figure", () => {
    const entries = [assistant("m1", { input_tokens: 10, output_tokens: 1 }), assistant("m2", undefined)];

    const { usage } = extractClaudeCodeRunUsage(entries, {}, new Set());

    expect(usage.roundsCount).toBe(2);
    expect(usage.uncachedInput.known).toBe(false);
    expect(usage.output.known).toBe(false);
  });

  it("reads the lines before a truncated last line", async () => {
    const entries = await transcript("partial-last-line", "a811111111111111a");

    const { usage } = extractClaudeCodeRunUsage(entries, {}, new Set());

    expect(usage.roundsCount).toBe(1);
    expect(usage.uncachedInput).toEqual(known(300));
  });

  it("has no rounds and an unknown model for an empty transcript", () => {
    const { usage } = extractClaudeCodeRunUsage([], {}, new Set());

    expect(usage.roundsCount).toBe(0);
    expect(usage.model).toBe("unknown");
    expect(usage.uncachedInput).toEqual(known(0));
  });

  it("keeps a valid first timestamp as startedAt and drops an invalid one", () => {
    const good = extractClaudeCodeRunUsage([assistant("m1", {}, { timestamp: "2026-10-03T10:00:03.000Z" })], {}, new Set());
    const bad = extractClaudeCodeRunUsage([assistant("m1", {}, { timestamp: "yesterday" })], {}, new Set());

    expect(good.usage.startedAt).toBe("2026-10-03T10:00:03.000Z");
    expect(bad.usage.startedAt).toBeUndefined();
  });

  it("sets parentRunId from meta.parentAgentId", async () => {
    const entries = await transcript("nested-fork-copy", "a422222222222222b");

    const { usage } = extractClaudeCodeRunUsage(entries, { parentAgentId: "a411111111111111a" }, new Set());

    expect(usage.parentRunId).toBe("a411111111111111a");
  });
});
