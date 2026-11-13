// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RequestTrace } from "@agent-cost-analyzer/domain";
import { AgentHostSessionSource } from "../../data-sources/agent-host/agent-host-session-source.js";
import { ClaudeCodeLogProvider } from "../../data-sources/claude-code/claude-code-log-provider.js";
import { computeClaudeCodeFileHash } from "../../data-sources/claude-code/session-id.js";
import { VscodeLogProvider } from "../../data-sources/log-providers/vscode/vscode-log-provider.js";
import { loadVendorProfiles } from "../../data-sources/vendor-profiles/loader.js";
import { COPILOT_CLI_FIXTURE_HOME, COPILOT_CLI_FIXTURE_SESSION_IDS, writeCopilotCliAgentHostStores } from "../../test-support/copilot-cli-fixtures.js";
import { seedCopilotSessionStore, USAGE_SESSION_ID, writeUsageDebugLog } from "../../test-support/copilot-session-store.js";
import { calibrationCaptureSchema } from "../learn-simulation/calibration/capture.js";
import { traceFromCapture } from "../learn-simulation/calibration/replay.js";
import { classifyCacheBreaks, type CacheBreakClassification } from "./cache-break-classifier.js";
import { cacheRulesFromProfiles } from "./cache-rules.js";

// Phase 16 SR4 exit criterion (docs/plans/savings-report.md §10): the
// cache-break classification of every request-trace fixture that
// session-replay.golden.test.ts replays, over the real vendor profiles,
// committed as JSON under __golden__/ (update with `vitest -u` after
// checking the diff by hand). No fixture records prompt-change signals yet
// (SR6 wires them), so every unexplained break's cause is "not recorded".

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../../../fixtures");
const rules = cacheRulesFromProfiles(loadVendorProfiles(path.join(fixtures, "vendor-profiles")));

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const golden = (name: string) => `./__golden__/cache-breaks-${name}.json`;

// Claude Code's session ids hash the file's path, so the golden names the fixture.
async function classified(trace: RequestTrace | null, name: string): Promise<CacheBreakClassification> {
  if (trace === null) throw new Error(`${name}: no request trace`);
  const result = { ...classifyCacheBreaks({ trace, rules }), sessionId: name };
  await expect(json(result)).toMatchFileSnapshot(golden(name));
  return result;
}

describe("golden cache breaks: Claude Code fixtures", () => {
  const projectDir = path.join(fixtures, "claude-code", "-home-dev-project");
  const provider = new ClaudeCodeLogProvider({ projectsDirPath: path.join(fixtures, "claude-code") });
  const traceOf = (name: string) => provider.readRequestTrace(computeClaudeCodeFileHash(path.join(projectDir, `${name}.jsonl`)));

  it("normal-session: every request read the previous prompt from cache, so no break", async () => {
    const result = await classified(await traceOf("normal-session"), "claude-code-normal-session");
    expect(result).toMatchObject({ breaks: [], intended: [], unchecked: [] });
  });

  it("compacted-session: the rebuild after the compaction is intended, not a break", async () => {
    const result = await classified(await traceOf("compacted-session"), "claude-code-compacted-session");
    expect(result.breaks).toEqual([]);
    expect(result.intended).toEqual([expect.objectContaining({ event: "compaction", requestIndex: 2, lostTokens: 1800 })]);
  });

  it.each(["forked-session", "tool-results-and-image-session", "meta-and-synthetic-session"])("%s", async (name) => {
    await classified(await traceOf(name), `claude-code-${name}`);
  });
});

describe("golden cache breaks: Copilot fixtures", () => {
  let dir: string;
  let userDataDir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cache-breaks-golden-"));
    userDataDir = mkdtempSync(path.join(tmpdir(), "cache-breaks-golden-ah-"));
    seedCopilotSessionStore(path.join(dir, "session-store.db"), "2026-08-08T10:00:00.000Z");
    writeUsageDebugLog(path.join(dir, "debug-logs"));
    writeCopilotCliAgentHostStores(userDataDir);
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(userDataDir, { recursive: true, force: true });
  });

  it("local harness (debug log, no agent-traces.db)", async () => {
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: path.join(dir, "session-store.db"),
      debugLogsDirPaths: [path.join(dir, "debug-logs")],
      agentTracesDbPath: null,
    });
    await classified(await provider.readRequestTrace(USAGE_SESSION_ID), "copilot-local-usage-session");
  });

  it("Agent Host (Copilot CLI event log)", async () => {
    const provider = new VscodeLogProvider({
      sessionStoreDbPath: null,
      debugLogsDirPaths: [],
      agentTracesDbPath: null,
      agentHostSessions: new AgentHostSessionSource({ userDataDir, copilotHome: COPILOT_CLI_FIXTURE_HOME }),
    });
    await classified(await provider.readRequestTrace(COPILOT_CLI_FIXTURE_SESSION_IDS.usageRecords), "copilot-agent-host-usage-records");
  });
});

// The Phase 13.5a calibration captures: real sessions' request figures,
// which session-replay.golden.test.ts self-checks through the service.
describe("golden cache breaks: calibration captures", () => {
  const dir = path.join(fixtures, "learn-calibration");
  const captures = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => calibrationCaptureSchema.parse(JSON.parse(readFileSync(path.join(dir, file), "utf-8"))));

  const results = new Map<string, CacheBreakClassification>();
  it.each(captures.map((capture) => [capture.id, capture] as const))("%s", async (id, capture) => {
    results.set(id, await classified(traceFromCapture(capture), `calibration-${id}`));
  });

  // The replay's two known self-check disagreements (session-replay.golden
  // .test.ts KNOWN_DISAGREEMENTS) are exactly these sessions' cache breaks:
  // a 100-minute gap past the 1-hour lifetime, and a break with no gap.
  it("breaks exactly where the replay's self-check disagrees with the log", () => {
    const breaks = [...results].flatMap(([id, result]) => result.breaks.map((b) => [id, b.requestIndex, b.class]));
    expect(breaks).toEqual([
      ["claude-code-2e4ad1d9", 20, "idle-expiry"],
      ["claude-code-39e87ae3", 14, "unexplained"],
    ]);
  });
});
