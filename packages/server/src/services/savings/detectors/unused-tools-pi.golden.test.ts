// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// V27 (savings-increment-3.md §7.1, §15): the unused-tools detector over a
// two-session pi window of V14's real captures (pi-linear and pi-compaction,
// qwen3.8-flash-next on a local server). The model has no vendor, so no price
// channel: the row carries tokens and requests, the money is Not priced with
// the channel's reason (§7 honesty rules). Session ids hash the file path, so
// the golden names each session by its fixture instead.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { savingsOpportunitySchema } from "@agent-cost-analyzer/domain";
import { PiAgentLogProvider } from "../../../data-sources/pi-agent/pi-agent-log-provider.js";
import { computePiFileHash } from "../../../data-sources/pi-agent/session-id.js";
import { savingsInput, sessionInput } from "../../../test-support/savings-fakes.js";
import { UnusedToolsDetector } from "./unused-tools-detector.js";

const generatedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/pi-agent/generated");
const provider = new PiAgentLogProvider({ sessionsDirPath: generatedDir });
const STEMS = ["pi-linear", "pi-compaction"] as const;
// The attribution's own sentence for a model no vendor profile lists.
const NO_CHANNEL = { known: false, reason: 'This provider calls the model vendor\'s own API, but the vendor is unknown: No vendor profile lists the model "qwen3.8-flash-next:setup6" or its model family, so its vendor is unknown.' } as const;

async function piWindow() {
  const sessions = await Promise.all(STEMS.map((stem) => provider.readSession(computePiFileHash(path.join(generatedDir, `${stem}.jsonl`)))));
  return sessions.map((session) => sessionInput(session!, { channel: NO_CHANNEL }));
}

const byStem = (id: string, window: Awaited<ReturnType<typeof piWindow>>) => STEMS[window.findIndex((entry) => entry.session.id === id)] ?? id;

describe("UnusedToolsDetector over pi's real fixtures", () => {
  it("lists write (declared in both sessions, never invoked) with tokens per request and Not priced; pi sessions are no longer under 'no tool inventory'", async () => {
    const window = await piWindow();

    const { opportunities, notAnalysed } = new UnusedToolsDetector().detect(savingsInput(window));

    expect(notAnalysed).toEqual([]);
    expect(opportunities).toHaveLength(1);
    const [row] = opportunities;
    expect(row).toMatchObject({
      key: "unused-tools:write:unpriced",
      subject: "write",
      // 8 requests in pi-linear, 6 in pi-compaction.
      evidence: { sessions: 2, requests: 14, tokens: { known: true, value: 127, estimated: true } },
      perWindow: { known: false, reason: NO_CHANNEL.reason },
      coverage: { sessionsInWindow: 2, sessionsAnalysed: 2, notAnalysed: [] },
      tools: [{ name: "write", tokens: { known: true, value: 127, estimated: true }, sessions: 2 }],
      toolsTotal: 1,
    });
    expect(savingsOpportunitySchema.safeParse(row).success).toBe(true);
  });

  it("golden: the whole result, sessions named by fixture (update with `vitest -u` after checking the diff by hand)", async () => {
    const window = await piWindow();

    const result = new UnusedToolsDetector().detect(savingsInput(window));
    const named = {
      ...result,
      opportunities: result.opportunities.map((row) => ({
        ...row,
        sessions: row.sessions.map((ref) => ({ ...ref, sessionId: byStem(ref.sessionId, window) })),
      })),
    };

    await expect(`${JSON.stringify(named, null, 2)}\n`).toMatchFileSnapshot("../__golden__/savings-unused-tools-pi-report.json");
  });
});
