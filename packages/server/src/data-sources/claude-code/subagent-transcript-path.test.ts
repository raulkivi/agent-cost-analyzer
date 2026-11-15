// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copySubagentFixtureCase,
  makeSubagentCapFolder,
  makeSymlinkedSubagentTranscript,
} from "./subagent-fixture-builders.js";
import {
  listSubagentTranscripts,
  MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION,
  SUBAGENT_META_NAME,
  SUBAGENT_TRANSCRIPT_NAME,
  subagentsDirOf,
  type SubagentFs,
} from "./subagent-transcript-path.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "subagent-transcript-path-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const LINKED_ID = "a111111111111111a";

describe("subagentsDirOf", () => {
  it("is the session's folder plus subagents, from the session file path", () => {
    expect(subagentsDirOf("/p/-home-dev/abc-123.jsonl")).toBe("/p/-home-dev/abc-123/subagents");
  });
});

describe("name patterns", () => {
  it.each(["agent-a111111111111111a.jsonl", `agent-${"a".repeat(64)}.jsonl`])("accepts transcript %s", (name) => {
    expect(SUBAGENT_TRANSCRIPT_NAME.test(name)).toBe(true);
  });

  it.each([
    "agent-.jsonl",
    `agent-${"a".repeat(65)}.jsonl`,
    "agent-../x.jsonl",
    "agent-a/b.jsonl",
    "agent-a..b.jsonl",
    "agent-a.jsonl.bak",
    "agent-a.jsonl\n",
    "agent-a.forked-skill.json",
    "agent-a.meta.json",
    "xagent-a.jsonl",
    "agent-a_b.jsonl",
  ])("rejects transcript %j", (name) => {
    expect(SUBAGENT_TRANSCRIPT_NAME.test(name)).toBe(false);
  });

  it.each(["agent-a111111111111111a.meta.json", "agent-Ab1.meta.json"])("accepts meta %s", (name) => {
    expect(SUBAGENT_META_NAME.test(name)).toBe(true);
  });

  it.each(["agent-a.forked-skill.meta.json", "agent-a/../b.meta.json", "agent-.meta.json", "agent-a.meta.json\n"])(
    "rejects meta %j",
    (name) => expect(SUBAGENT_META_NAME.test(name)).toBe(false),
  );
});

describe("listSubagentTranscripts over the fixtures", () => {
  it("finds the linked run's transcript and meta and ignores the forked-skill files", () => {
    const copy = copySubagentFixtureCase("linked-run", root);

    const listing = listSubagentTranscripts(copy.subagentsDir);

    expect(listing.status).toBe("ok");
    if (listing.status !== "ok") return;
    expect(listing.runs).toHaveLength(1);
    expect(listing.runs[0]).toMatchObject({
      agentId: LINKED_ID,
      transcript: { path: path.join(copy.subagentsDir, `agent-${LINKED_ID}.jsonl`) },
      meta: { path: path.join(copy.subagentsDir, `agent-${LINKED_ID}.meta.json`) },
    });
    expect(listing.runs[0]?.transcript?.size).toBeGreaterThan(0);
    expect(listing.refusedFiles).toEqual([]);
  });

  it("lists a run with a meta and no transcript", () => {
    const copy = copySubagentFixtureCase("missing-transcript", root);

    const listing = listSubagentTranscripts(copy.subagentsDir);

    expect(listing.status).toBe("ok");
    if (listing.status !== "ok") return;
    expect(listing.runs.map((run) => run.agentId)).toEqual(["a611111111111111a"]);
    expect(listing.runs[0]?.transcript).toBeUndefined();
    expect(listing.runs[0]?.meta?.path).toBe(path.join(copy.subagentsDir, "agent-a611111111111111a.meta.json"));
  });

  it("lists an unlinked transcript like any other", () => {
    const copy = copySubagentFixtureCase("unlinked-transcript", root);

    const listing = listSubagentTranscripts(copy.subagentsDir);

    expect(listing.status === "ok" && listing.runs.map((run) => run.agentId)).toEqual(["a711111111111111a"]);
  });

  it("lists nested runs sorted by id", () => {
    const copy = copySubagentFixtureCase("nested-run", root);

    const listing = listSubagentTranscripts(copy.subagentsDir);

    expect(listing.status === "ok" && listing.runs.map((run) => run.agentId)).toEqual([
      "a211111111111111a",
      "a222222222222222b",
    ]);
  });

  it("reports no folder for a session without subagents", () => {
    const copy = copySubagentFixtureCase("failed-launch", root);

    expect(listSubagentTranscripts(copy.subagentsDir)).toEqual({ status: "no-folder" });
  });
});

describe("listSubagentTranscripts refuses unsafe paths", () => {
  it("refuses a symlinked transcript and does not list it", () => {
    const copy = copySubagentFixtureCase("linked-run", root);
    const link = makeSymlinkedSubagentTranscript(copy, root);

    const listing = listSubagentTranscripts(copy.subagentsDir);

    expect(listing.status).toBe("ok");
    if (listing.status !== "ok") return;
    expect(listing.refusedFiles).toEqual([path.basename(link)]);
    expect(listing.runs[0]?.transcript).toBeUndefined();
    expect(listing.runs[0]?.meta).toBeDefined();
  });

  it("refuses a symlinked meta", () => {
    const copy = copySubagentFixtureCase("linked-run", root);
    const meta = path.join(copy.subagentsDir, `agent-${LINKED_ID}.meta.json`);
    const outside = path.join(root, "outside.json");
    writeFileSync(outside, "{}");
    rmSync(meta);
    symlinkSync(outside, meta);

    const listing = listSubagentTranscripts(copy.subagentsDir);

    expect(listing.status === "ok" && listing.refusedFiles).toEqual([`agent-${LINKED_ID}.meta.json`]);
  });

  it("refuses a directory with a transcript name", () => {
    const copy = copySubagentFixtureCase("linked-run", root);
    mkdirSync(path.join(copy.subagentsDir, "agent-adir.jsonl"));

    const listing = listSubagentTranscripts(copy.subagentsDir);

    expect(listing.status === "ok" && listing.refusedFiles).toEqual(["agent-adir.jsonl"]);
    expect(listing.status === "ok" && listing.runs.map((run) => run.agentId)).toEqual([LINKED_ID]);
  });

  it("refuses a symlinked subagents folder", () => {
    const copy = copySubagentFixtureCase("linked-run", root);
    const elsewhere = path.join(root, "elsewhere");
    mkdirSync(elsewhere);
    writeFileSync(path.join(elsewhere, "agent-aoutside.jsonl"), "{}\n");
    rmSync(copy.subagentsDir, { recursive: true });
    symlinkSync(elsewhere, copy.subagentsDir);

    expect(listSubagentTranscripts(copy.subagentsDir)).toEqual({ status: "unsafe", reason: "not a regular folder" });
  });

  it("refuses a symlinked session folder", () => {
    const copy = copySubagentFixtureCase("linked-run", root);
    const moved = path.join(root, "moved-session");
    rmSync(copy.sessionDir, { recursive: true });
    mkdirSync(path.join(moved, "subagents"), { recursive: true });
    writeFileSync(path.join(moved, "subagents", "agent-aoutside.jsonl"), "{}\n");
    symlinkSync(moved, copy.sessionDir);

    expect(listSubagentTranscripts(copy.subagentsDir)).toEqual({ status: "unsafe", reason: "not a regular folder" });
  });

  it("refuses a subagents path that is a regular file", () => {
    const copy = copySubagentFixtureCase("linked-run", root);
    rmSync(copy.subagentsDir, { recursive: true });
    writeFileSync(copy.subagentsDir, "x");

    expect(listSubagentTranscripts(copy.subagentsDir)).toEqual({ status: "unsafe", reason: "not a regular folder" });
  });

  it("ignores traversal-shaped names an injected fs reports, and never touches them", () => {
    const touched: string[] = [];
    const isFolder = (p: string) => p.endsWith("subagents") || p.endsWith("session");
    const fs: SubagentFs = {
      lstat: (p) => {
        touched.push(p);
        return {
          isFile: () => !isFolder(p),
          isDirectory: () => isFolder(p),
          isSymbolicLink: () => false,
          size: 3,
        };
      },
      readdir: () => [
        "agent-../../etc/passwd.jsonl",
        "agent-..jsonl",
        "../agent-a.jsonl",
        "agent-a%2f.jsonl",
        "agent-ok1.jsonl",
      ],
    };

    const listing = listSubagentTranscripts("/p/session/subagents", fs);

    expect(listing.status === "ok" && listing.runs.map((run) => run.agentId)).toEqual(["ok1"]);
    expect(touched.filter((p) => p.includes(".."))).toEqual([]);
  });
});

describe("listSubagentTranscripts caps", () => {
  it("reads a folder at the cap", () => {
    const copy = makeSubagentCapFolder(root, MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION);

    const listing = listSubagentTranscripts(copy.subagentsDir);

    expect(listing.status === "ok" && listing.runs).toHaveLength(MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION);
  });

  it("returns too-many above the cap and lists nothing", () => {
    const copy = makeSubagentCapFolder(root, MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION + 1);

    expect(listSubagentTranscripts(copy.subagentsDir)).toEqual({
      status: "too-many",
      count: MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION + 1,
    });
  });

  it("proposes 500 files per session", () => {
    expect(MAX_CLAUDE_CODE_SUBAGENT_FILES_PER_SESSION).toBe(500);
  });
});

describe("listSubagentTranscripts with an unreadable folder", () => {
  it("reports unreadable, not empty, when the listing fails", () => {
    const fs: SubagentFs = {
      lstat: () => ({ isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0 }),
      readdir: () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      },
    };

    expect(listSubagentTranscripts("/p/s/subagents", fs)).toEqual({ status: "unreadable" });
  });
});
