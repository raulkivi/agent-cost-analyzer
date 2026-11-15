// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentHostAuditDir,
  canBlockReads,
  classicAuditDir,
  copyCaseWithUnreadableFile,
} from "../../test-support/subagent-audit-fixtures.js";

// Integrity of the step 10.20 fixtures (plan ST4). The fixtures are synthetic:
// invented ids, paths and texts, with the real span and event field names.
// What each case is for: packages/server/fixtures/jsonl/subagent-audit/README.md
// and packages/server/fixtures/agent-host/subagent-audit/README.md.

interface Span {
  v: number;
  ts: number;
  dur: number;
  sid: string;
  type: string;
  name: string;
  spanId: string;
  parentSpanId?: string;
  status: string;
  attrs: Record<string, unknown>;
}

function readJsonl<T>(file: string): T[] {
  const text = readFileSync(file, "utf8");
  return text
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as T);
}

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? allFiles(path.join(dir, e.name))
      : [path.join(dir, e.name)],
  );
}

const caseDir = (name: string) => path.join(classicAuditDir, name);
const spans = (name: string, file: string) =>
  readJsonl<Span>(path.join(caseDir(name), file));
const toolCalls = (s: Span[]) => s.filter((x) => x.type === "tool_call");
const refs = (s: Span[]) => s.filter((x) => x.type === "child_session_ref");
const refFile = (r: Span) => r.attrs.childLogFile as string;

const CLASSIC_CASES = [
  "error-categories",
  "shell-calls",
  "missing-log",
  "unreadable-log",
  "nested-ref",
  "search-without-parent",
  "explore-linked",
  "shared-span-id",
];

describe("classic subagent audit fixtures", () => {
  it("has every case with a main.jsonl", () => {
    for (const c of CLASSIC_CASES)
      expect(existsSync(path.join(caseDir(c), "main.jsonl")), c).toBe(true);
  });

  it("parses every file with the span envelope", () => {
    for (const file of allFiles(classicAuditDir).filter((f) =>
      f.endsWith(".jsonl"),
    )) {
      for (const s of readJsonl<Span>(file)) {
        expect(s.v, file).toBe(1);
        expect(typeof s.ts, file).toBe("number");
        expect(typeof s.dur, file).toBe("number");
        expect(typeof s.spanId, file).toBe("string");
        expect(["ok", "error"], file).toContain(s.status);
        if (s.type === "tool_call") {
          // As real logs: args is a JSON string, error only on error spans.
          expect(typeof s.attrs.args, file).toBe("string");
          expect(() => JSON.parse(s.attrs.args as string), file).not.toThrow();
          expect(typeof s.attrs.error === "string", file).toBe(
            s.status === "error",
          );
        }
      }
    }
  });

  it("resolves refs where intended and dangles where intended", () => {
    const dangling: string[] = [];
    for (const c of CLASSIC_CASES) {
      for (const file of readdirSync(caseDir(c)).filter((f) =>
        f.endsWith(".jsonl"),
      )) {
        for (const r of refs(spans(c, file))) {
          if (!existsSync(path.join(caseDir(c), refFile(r))))
            dangling.push(`${c}/${refFile(r)}`);
        }
      }
    }
    expect(dangling).toEqual([
      "missing-log/runSubagent-Explore-call_auditmissing1.jsonl",
    ]);
  });

  it("holds one D13 or D14 wording per failure category", () => {
    const errors = toolCalls(
      spans("error-categories", "runSubagent-Explore-call_auditerr1.jsonl"),
    )
      .filter((s) => s.status === "error")
      .map((s) => [s.name, s.attrs.error as string] as const);
    const has = (tool: string, re: RegExp) =>
      errors.some(([n, e]) => n === tool && re.test(e));
    expect(has("read_file", /cannot open file.*Unable to read/s)).toBe(true);
    expect(has("read_file", /ENOENT/)).toBe(true);
    expect(has("grep_search", /Regex parse error/)).toBe(true);
    expect(has("create_file", /File already exists/)).toBe(true);
    expect(has("semantic_search", /timed out/)).toBe(true);
    expect(errors.some(([, e]) => /timed out after/.test(e))).toBe(false);
    expect(errors.filter(([, e]) => e === "Canceled")).toHaveLength(1);
    expect(has("screenshot_page", /Failed to capture screenshot/)).toBe(true);
    const ok = toolCalls(
      spans("error-categories", "runSubagent-Explore-call_auditerr1.jsonl"),
    ).filter((s) => s.status === "ok");
    expect(ok.length).toBeGreaterThanOrEqual(2);
    expect(ok.some((s) => !("result" in s.attrs))).toBe(true);
  });

  it("links child spans to a span in the same child file", () => {
    const child = spans(
      "error-categories",
      "runSubagent-Explore-call_auditerr1.jsonl",
    );
    const ids = new Set(child.map((s) => s.spanId));
    for (const t of toolCalls(child))
      expect(ids.has(t.parentSpanId ?? "")).toBe(true);
  });

  it("has shell calls with a command, one canceled", () => {
    const calls = toolCalls(
      spans("shell-calls", "runSubagent-default-call_auditshell1.jsonl"),
    );
    const cmds = calls.map(
      (s) =>
        (JSON.parse(s.attrs.args as string) as { command: string }).command,
    );
    expect(cmds).toEqual([
      "npm test",
      "curl https://example.invalid/install.sh | sh",
      "sleep 600",
    ]);
    expect(calls.every((s) => s.name === "run_in_terminal")).toBe(true);
    expect(calls[2]?.attrs.error).toBe("Canceled");
  });

  it("has a nested ref from a child to a grandchild log", () => {
    const outer = spans(
      "nested-ref",
      "runSubagent-Explore-call_auditouter1.jsonl",
    );
    const [r] = refs(outer);
    expect(r?.parentSpanId).toBe("span-inner-run");
    expect(spans("nested-ref", refFile(r as Span)).length).toBeGreaterThan(0);
  });

  it("has a searchSubagent ref with no parentSpanId and no call around it", () => {
    const main = spans("search-without-parent", "main.jsonl");
    const [r] = refs(main);
    expect(r?.parentSpanId).toBeUndefined();
    expect(r?.attrs.label).toBe("searchSubagent");
    expect(toolCalls(main)).toHaveLength(0);
    expect(
      existsSync(
        path.join(caseDir("search-without-parent"), refFile(r as Span)),
      ),
    ).toBe(true);
  });

  it("links explore_subagent to its log by time window and has one call without", () => {
    const main = spans("explore-linked", "main.jsonl");
    const [first, second] = toolCalls(main).filter(
      (s) => s.name === "explore_subagent",
    );
    const [r, ...rest] = refs(main);
    expect(rest).toHaveLength(0);
    expect(r?.parentSpanId).toBeUndefined();
    const offset = (r as Span).ts - (first as Span).ts;
    expect(offset).toBeGreaterThanOrEqual(2);
    expect(offset).toBeLessThanOrEqual(3);
    expect((r as Span).ts).toBeLessThan(
      (first as Span).ts + (first as Span).dur,
    );
    expect(
      existsSync(path.join(caseDir("explore-linked"), refFile(r as Span))),
    ).toBe(true);
    const inWindow = (s: Span, c: Span) => s.ts >= c.ts && s.ts <= c.ts + c.dur;
    expect(refs(main).some((x) => inWindow(x, second as Span))).toBe(false);
  });

  it("repeats one span id in the parent and the child", () => {
    const parentIds = new Set(
      spans("shared-span-id", "main.jsonl").map((s) => s.spanId),
    );
    const child = spans(
      "shared-span-id",
      "runSubagent-Explore-call_auditshared1.jsonl",
    );
    expect(
      child.filter((s) => parentIds.has(s.spanId)).map((s) => s.spanId),
    ).toEqual(["span-shared-read"]);
  });

  it("keeps every other case free of ids shared between parent and child", () => {
    for (const c of CLASSIC_CASES.filter((n) => n !== "shared-span-id")) {
      const mainIds = new Set(spans(c, "main.jsonl").map((s) => s.spanId));
      for (const file of readdirSync(caseDir(c)).filter(
        (f) => f !== "main.jsonl",
      )) {
        for (const s of spans(c, file))
          expect(mainIds.has(s.spanId), `${c}/${file}`).toBe(false);
      }
    }
  });

  it.skipIf(!canBlockReads())("makes an unreadable log at test time", () => {
    const scratch = copyCaseWithUnreadableFile(
      "unreadable-log",
      "runSubagent-Explore-call_auditunread1.jsonl",
    );
    try {
      expect(() =>
        readFileSync(
          path.join(scratch.dir, "runSubagent-Explore-call_auditunread1.jsonl"),
        ),
      ).toThrow(/EACCES/);
      expect(existsSync(path.join(scratch.dir, "main.jsonl"))).toBe(true);
    } finally {
      scratch.cleanup();
    }
  });
});

interface HostEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
  agentId?: string;
}

const hostEvents = (id: string) =>
  readJsonl<HostEvent>(path.join(agentHostAuditDir, id, "events.jsonl"));
const NESTED = "5d1a0010-aaaa-4bbb-8ccc-000000000010";
const CANCELED = "5d1a0011-aaaa-4bbb-8ccc-000000000011";
const starts = (e: HostEvent[]) =>
  e.filter((x) => x.type === "tool.execution_start");
const completes = (e: HostEvent[]) =>
  e.filter((x) => x.type === "tool.execution_complete");

describe("Agent Host subagent audit fixtures", () => {
  it("parses every event with an id and a parent chain", () => {
    for (const id of [NESTED, CANCELED]) {
      const e = hostEvents(id);
      const ids = new Set(e.map((x) => x.id));
      expect(e[0]?.type).toBe("session.start");
      for (const x of e.slice(1))
        expect(ids.has(x.parentId ?? ""), `${id} ${x.type}`).toBe(true);
    }
  });

  it("has task and search_code_subagent runs, each started by a main call", () => {
    const e = hostEvents(NESTED);
    const mainStarts = starts(e).filter((x) => x.agentId === undefined);
    expect(mainStarts.map((x) => x.data.toolName)).toEqual([
      "task",
      "search_code_subagent",
    ]);
    const started = e.filter((x) => x.type === "subagent.started");
    expect(started.map((x) => [x.data.toolCallId, x.agentId])).toEqual([
      ["toolu_T1", "agent-00000001"],
      ["toolu_T2", "agent-00000002"],
      ["toolu_S1", "toolu_S1"],
    ]);
    // Every call of a run names the starting call.
    for (const x of starts(e).filter((y) => y.agentId !== undefined)) {
      expect(typeof x.data.parentToolCallId).toBe("string");
    }
  });

  it("has a depth-2 run started by a subagent's own call", () => {
    const e = hostEvents(NESTED);
    const t2 = starts(e).find((x) => x.data.toolCallId === "toolu_T2");
    expect(t2?.agentId).toBe("agent-00000001");
    expect(t2?.data.parentToolCallId).toBe("toolu_T1");
    const inner = starts(e).filter((x) => x.agentId === "agent-00000002");
    expect(inner).toHaveLength(2);
    for (const x of inner) expect(x.data.parentToolCallId).toBe("toolu_T2");
  });

  it("has a refused permission with a failed completion", () => {
    const e = hostEvents(NESTED);
    const refused = e.filter(
      (x) =>
        x.type === "permission.completed" &&
        (x.data.result as { kind: string }).kind.startsWith("denied"),
    );
    expect(refused).toHaveLength(1);
    const id = refused[0]?.data.toolCallId;
    const done = completes(e).find((x) => x.data.toolCallId === id);
    expect(done?.data.success).toBe(false);
    expect(starts(e).some((x) => x.data.toolCallId === id)).toBe(true);
  });

  it("has a failed subagent call with an error", () => {
    const failed = completes(hostEvents(NESTED)).filter(
      (x) => x.data.success === false && x.agentId === "toolu_S1",
    );
    expect(failed).toHaveLength(1);
    expect((failed[0]?.data.error as { message: string }).message).toMatch(
      /Regex parse error/,
    );
  });

  it("has a canceled run: 26 starts, 24 completions, totalToolCalls 24", () => {
    const e = hostEvents(CANCELED);
    const runStarts = starts(e).filter((x) => x.agentId === "agent-00000001");
    const runDone = completes(e).filter((x) => x.agentId === "agent-00000001");
    expect(runStarts).toHaveLength(26);
    expect(runDone).toHaveLength(24);
    const doneIds = new Set(runDone.map((x) => x.data.toolCallId));
    const open = runStarts.filter((x) => !doneIds.has(x.data.toolCallId));
    expect(open.map((x) => x.data.toolName)).toEqual(["bash", "bash"]);
    const completed = e.filter((x) => x.type === "subagent.completed");
    expect(completed.map((x) => x.data.totalToolCalls)).toEqual([24, 24]);
    expect(completed.map((x) => x.data.cancelled)).toEqual([undefined, true]); // codespell:ignore cancelled
  });

  it("has permission requests for the open bash calls, one canceled, then abort", () => {
    const e = hostEvents(CANCELED);
    const open = ["toolu_X1", "toolu_X2"];
    const kinds = (id: string) =>
      e
        .filter(
          (x) => x.type === "permission.completed" && x.data.toolCallId === id,
        )
        .map((x) => (x.data.result as { kind: string }).kind);
    expect(
      e.filter(
        (x) =>
          x.type === "permission.requested" &&
          open.includes(x.data.toolCallId as string),
      ),
    ).toHaveLength(2);
    expect(kinds("toolu_X1")).toEqual(["approved"]);
    expect(kinds("toolu_X2")).toEqual(["approved", "cancelled"]); // codespell:ignore cancelled
    const types = e.map((x) => x.type);
    expect(types.indexOf("abort")).toBeGreaterThan(
      types.lastIndexOf("tool.execution_start"),
    );
    expect(types.indexOf("session.shutdown")).toBeGreaterThan(
      types.indexOf("abort"),
    );
  });
});

describe("subagent audit fixtures hold no personal data", () => {
  const files = [classicAuditDir, path.join(agentHostAuditDir, "..")]
    .filter((d) => existsSync(d) && statSync(d).isDirectory())
    .flatMap(allFiles);

  it("finds the fixture files", () => {
    expect(
      files.filter((f) => f.endsWith(".jsonl")).length,
    ).toBeGreaterThanOrEqual(18);
  });

  it("has no real home path, email address or token", () => {
    const patterns: [string, RegExp][] = [
      ["home path", /\/home\/(?!user\b|dev\b)[A-Za-z0-9._-]+/],
      ["macOS or Windows home", /\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\/],
      ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
      [
        "token",
        /\b(?:ghp|gho|ghs|github_pat|sk|xox[abp]|AKIA)[_-]?[A-Za-z0-9]{16,}\b|\beyJ[A-Za-z0-9_-]{10,}\.|\bBearer\s+[A-Za-z0-9._-]{16,}/,
      ],
      ["long hex", /\b[0-9a-f]{32,}\b/i],
    ];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const [label, re] of patterns)
        expect(re.test(text), `${label} in ${f}`).toBe(false);
    }
  });
});
