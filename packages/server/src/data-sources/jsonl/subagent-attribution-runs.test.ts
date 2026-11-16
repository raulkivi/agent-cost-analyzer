// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectChildSessionRefs } from "./child-session-refs.js";
import { readMainJsonlFile } from "./main-jsonl-reader.js";
import {
  attributeSubagentRuns,
  logTurnStartTimes,
  SUBAGENT_LOG_MISSING_REASON,
  SUBAGENT_LOG_NAME_REJECTED_REASON,
  SUBAGENT_REF_BEFORE_FIRST_TURN_REASON,
  SUBAGENT_RUN_UNPLACEABLE_REASON,
} from "./subagent-attribution.js";
import { folderSubagentLogSource } from "./subagent-log-source.js";

// Step 10.20 (ST7): the attribution also says which file and identity each run
// has, so the audit reads the file 10.19 found instead of finding it again.
const here = path.dirname(fileURLToPath(import.meta.url));
const usageFixtures = path.resolve(here, "../../../fixtures/jsonl/subagents");
const auditFixtures = path.resolve(here, "../../../fixtures/jsonl/subagent-audit");

async function attribute(dir: string) {
  const { envelopes } = await readMainJsonlFile(path.join(dir, "main.jsonl"));
  return attributeSubagentRuns({
    folderId: path.basename(dir),
    refs: collectChildSessionRefs(envelopes),
    logTurnStarts: logTurnStartTimes(envelopes),
    source: folderSubagentLogSource(dir),
  });
}

describe("attributeSubagentRuns: the run list for the audit", () => {
  it("a read run names its file, identity, placement and its ref's call link", async () => {
    const { runs } = await attribute(path.join(auditFixtures, "shared-span-id"));

    expect(runs).toEqual([
      {
        logTurn: 0,
        runId: "call_auditshared1",
        label: "runSubagent-Explore",
        attribution: "child-session-ref",
        refTs: 1791000001000,
        parentSpanId: "span-tool-run",
        log: { status: "read", childLogFile: "runSubagent-Explore-call_auditshared1.jsonl", nestedRefs: [] },
      },
    ]);
  });

  it("a read run carries the nested refs its log holds", async () => {
    const { runs } = await attribute(path.join(auditFixtures, "nested-ref"));

    expect(runs).toHaveLength(1);
    expect(runs[0].log).toMatchObject({
      status: "read",
      nestedRefs: [expect.objectContaining({ childSessionId: "call_auditinner1", label: "runSubagent-Plan" })],
    });
  });

  it("a missing log is an unread run with the ref's identity and 10.19's reason", async () => {
    const { runs } = await attribute(path.join(auditFixtures, "missing-log"));

    expect(runs).toEqual([
      expect.objectContaining({ logTurn: 0, log: { status: "unread", reason: SUBAGENT_LOG_MISSING_REASON } }),
    ]);
    expect(runs[0].runId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  });

  it("a rejected name is an unread run with a safe stand-in identity", async () => {
    const { runs } = await attribute(path.join(usageFixtures, "traversal-ref"));

    expect(runs).toHaveLength(1);
    expect(runs[0].log).toEqual({ status: "unread", reason: SUBAGENT_LOG_NAME_REJECTED_REASON });
    expect(runs[0].runId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
    expect(runs[0].label).toMatch(/^runSubagent-[A-Za-z0-9_ -]{1,64}$|^searchSubagent$/);
  });

  it("an orphan matched by time is a run with no ref data", async () => {
    const { runs } = await attribute(path.join(usageFixtures, "orphan-by-time"));

    expect(runs).toEqual([
      expect.objectContaining({
        logTurn: 1,
        runId: "call_fixtureorphan1",
        attribution: "timestamp",
        refTs: null,
        parentSpanId: null,
        log: expect.objectContaining({ status: "read", childLogFile: expect.stringMatching(/\.jsonl$/) }),
      }),
    ]);
  });

  it("an orphan that cannot be placed is listed as an unplaced file with its reason", async () => {
    const { runs, unplaced } = await attribute(path.join(usageFixtures, "orphan-unplaceable"));

    expect(runs).toEqual([]);
    expect(unplaced).toEqual([{ childLogFile: expect.stringMatching(/\.jsonl$/), reason: SUBAGENT_RUN_UNPLACEABLE_REASON }]);
  });

  it("a ref before the first prompt is an unplaced file", async () => {
    const { runs, unplaced } = await attribute(path.join(usageFixtures, "ref-before-first-turn"));

    expect(runs).toEqual([]);
    expect(unplaced).toEqual([{ childLogFile: expect.stringMatching(/\.jsonl$/), reason: SUBAGENT_REF_BEFORE_FIRST_TURN_REASON }]);
  });
});
