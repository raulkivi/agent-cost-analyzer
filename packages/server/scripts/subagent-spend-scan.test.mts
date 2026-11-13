// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { measureUserDataDirs } from "./subagent-spend-scan.mjs";

const line = (o: unknown) => JSON.stringify(o);
const req = (nano: number, model = "m1") =>
  line({
    type: "llm_request",
    ts: Date.UTC(2026, 8, 5),
    attrs: { inputTokens: 1, outputTokens: 1, copilotUsageNanoAiu: nano, model },
  });

describe("measureUserDataDirs", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "sa-scan-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const session = (userData: string, rel: string[], id: string, files: Record<string, string>) => {
    const dir = path.join(userData, "User", ...rel, id);
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  };
  const ws = (hash: string) => ["workspaceStorage", hash, "GitHub.copilot-chat", "debug-logs"];
  const global = ["globalStorage", "github.copilot-chat", "debug-logs"];

  it("returns one row per session with main.jsonl, across workspace and global storage", () => {
    const ud = path.join(root, "Code - Insiders");
    session(ud, ws("h1"), "s1", {
      "main.jsonl": req(2_000_000_000),
      "runSubagent-A-c1.jsonl": req(3_000_000_000, "mx"),
    });
    session(ud, global, "s2", { "main.jsonl": req(1_000_000_000) });
    session(ud, ws("h2"), "no-main", { "other.jsonl": "{}" });

    const r = measureUserDataDirs([ud]);

    expect(r.rows.map((x) => [x.edition, x.folder, x.sessionId]).sort()).toEqual([
      ["Code - Insiders", "globalStorage", "s2"],
      ["Code - Insiders", "workspaceStorage", "s1"],
    ]);
    const s1 = r.rows.find((x) => x.sessionId === "s1")!.summary;
    expect(s1.mainAiCredits).toBe(2);
    expect(s1.missingAiCredits).toBe(3);
    expect(s1.startDate).toBe("2026-09-05");
    expect(s1.subagentAiCreditsByModel).toEqual({ mx: 3 });
    expect(r.rootsByKind).toEqual({ "Code - Insiders/workspaceStorage": 2, "Code - Insiders/globalStorage": 1 });
  });

  it("scans several user-data dirs and counts unrelated jsonl names", () => {
    const a = path.join(root, "Code");
    const b = path.join(root, "Code - Insiders");
    session(a, ws("h"), "sa", { "main.jsonl": req(1), "stray.jsonl": "" });
    session(b, ws("h"), "sb", { "main.jsonl": req(1) });

    const r = measureUserDataDirs([a, b]);

    expect(r.rows.map((x) => x.edition).sort()).toEqual(["Code", "Code - Insiders"]);
    expect(r.otherJsonlFiles).toBe(1);
  });

  it("returns nothing for a dir without debug logs", () => {
    expect(measureUserDataDirs([path.join(root, "absent")])).toEqual({ rows: [], rootsByKind: {}, otherJsonlFiles: 0 });
  });
});
