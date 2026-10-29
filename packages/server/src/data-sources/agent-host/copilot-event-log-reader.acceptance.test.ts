import { chmodSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MAX_EVENT_LINE_CHARS,
  parseCopilotEventLine,
  readCopilotEventLog,
  type CopilotEvent,
} from "./copilot-event-log-reader.js";

const FIXTURES = new URL("../../../fixtures/agent-host/copilot-cli/", import.meta.url);
const rows = JSON.parse(readFileSync(new URL("rows.json", FIXTURES), "utf8")) as {
  sdkSessionIds: Record<string, string>;
  expected: { malformed: { events: number; skippedLines: number; hasUnknownType: boolean } };
};
const logOf = (id: string): string => path.join(new URL(`session-state/${id}/events.jsonl`, FIXTURES).pathname);

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "event-log-"));
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("parseCopilotEventLine", () => {
  const line = (o: unknown) => JSON.stringify(o);

  it("parses a full event", () => {
    expect(
      parseCopilotEventLine(
        line({ type: "user.message", id: "e1", parentId: "e0", timestamp: "2026-10-20T09:00:00.000Z", agentId: "agent-1", data: { content: "hi" } }),
      ),
    ).toEqual({ id: "e1", type: "user.message", parentId: "e0", timestamp: "2026-10-20T09:00:00.000Z", agentId: "agent-1", data: { content: "hi" } });
  });

  it("nulls parentId, timestamp and agentId unless strings", () => {
    expect(parseCopilotEventLine(line({ type: "t", id: "e", parentId: 5, timestamp: 7, agentId: { x: 1 }, data: {} }))).toEqual({
      id: "e", type: "t", parentId: null, timestamp: null, agentId: null, data: {},
    });
    expect(parseCopilotEventLine(line({ type: "t", id: "e", data: {} }))).toMatchObject({ parentId: null, timestamp: null, agentId: null });
    expect(parseCopilotEventLine(line({ type: "t", id: "e", parentId: null, data: {} }))!.parentId).toBeNull();
  });

  it("uses {} unless data is a non-array object", () => {
    for (const data of [undefined, null, [1], "s", 3, true]) {
      expect(parseCopilotEventLine(line({ type: "t", id: "e", data }))!.data).toEqual({});
    }
  });

  it.each([
    ["not json", "{nope"],
    ["empty", ""],
    ["an array", "[1,2]"],
    ["a string", '"x"'],
    ["a number", "7"],
    ["null", "null"],
    ["no id", JSON.stringify({ type: "t", data: {} })],
    ["empty id", JSON.stringify({ type: "t", id: "", data: {} })],
    ["non-string id", JSON.stringify({ type: "t", id: 1, data: {} })],
    ["no type", JSON.stringify({ id: "e", data: {} })],
    ["empty type", JSON.stringify({ id: "e", type: "", data: {} })],
    ["non-string type", JSON.stringify({ id: "e", type: {}, data: {} })],
  ])("returns null for %s", (_n, l) => {
    expect(parseCopilotEventLine(l)).toBeNull();
  });

  it("keeps unknown event types", () => {
    expect(parseCopilotEventLine(line({ type: "future.thing", id: "e", data: { a: 1 } }))).toMatchObject({ type: "future.thing", data: { a: 1 } });
  });

  it("drops the base64 payload of session.binary_asset only", () => {
    const e = parseCopilotEventLine(
      line({ type: "session.binary_asset", id: "e", data: { assetId: "a", mimeType: "image/png", byteLength: 12, data: "UExBQ0VIT0xERVI=" } }),
    )!;
    expect(e.data).toEqual({ assetId: "a", mimeType: "image/png", byteLength: 12 });
    expect("data" in e.data).toBe(false);
    const other = parseCopilotEventLine(line({ type: "user.message", id: "e", data: { data: "keep" } }))!;
    expect(other.data).toEqual({ data: "keep" });
  });
});

describe("MAX_EVENT_LINE_CHARS", () => {
  it("is 8 MiB", () => expect(MAX_EVENT_LINE_CHARS).toBe(8 * 1024 * 1024));
});

describe("readCopilotEventLog on fixtures", () => {
  it("reads a normal log in file order with no skipped lines", async () => {
    const file = logOf(rows.sdkSessionIds.normal!);
    const log = await readCopilotEventLog(file);
    expect(log).not.toBeNull();
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
    expect(log!.skippedLines).toBe(0);
    expect(log!.events.map((e) => e.id)).toEqual(lines.map((l) => (JSON.parse(l) as { id: string }).id));
    expect(log!.events[0]).toMatchObject({ type: "session.start", parentId: null });
    expect(log!.events.filter((e) => e.type === "user.message")).toHaveLength(2);
  });

  it("drops binary asset payloads", async () => {
    const log = await readCopilotEventLog(logOf(rows.sdkSessionIds.normal!));
    const asset = log!.events.find((e) => e.type === "session.binary_asset")!;
    expect(asset.data.assetId).toBeTypeOf("string");
    expect("data" in asset.data).toBe(false);
  });

  it("keeps agentId on subagent events and handles a last line without a newline", async () => {
    const file = logOf(rows.sdkSessionIds.steeringAbortSubagent!);
    expect(readFileSync(file, "utf8").endsWith("\n")).toBe(false);
    const log = await readCopilotEventLog(file);
    expect(log!.skippedLines).toBe(0);
    const lines = readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
    expect(log!.events).toHaveLength(lines.length);
    expect(log!.events.at(-1)!.type).toBe("assistant.turn_end");
    const agent = log!.events.filter((e) => e.agentId !== null);
    expect(agent.length).toBeGreaterThan(0);
    expect(agent.every((e) => e.agentId === "agent-00000001")).toBe(true);
    expect(log!.events.filter((e) => e.type === "user.message" && e.data.delivery === "steering")).toHaveLength(1);
    expect(log!.events.filter((e) => e.type === "abort")).toHaveLength(1);
  });

  it("reads every system.message of a re-emitting log", async () => {
    const log = await readCopilotEventLog(logOf(rows.sdkSessionIds.systemPromptReemit!));
    expect(log!.events.filter((e) => e.type === "system.message")).toHaveLength(3);
  });

  it("skips and counts malformed lines, keeps odd-but-valid and unknown-type events, ignores blanks", async () => {
    const log = await readCopilotEventLog(logOf(rows.sdkSessionIds.malformed!));
    const exp = rows.expected.malformed;
    expect(log!.skippedLines).toBe(exp.skippedLines);
    expect(log!.events).toHaveLength(exp.events);
    expect(log!.events.some((e) => e.type === "future.event_type")).toBe(exp.hasUnknownType);
    const odd = log!.events.find((e) => e.type === "odd.shapes")!;
    expect(odd).toMatchObject({ parentId: null, timestamp: null, agentId: null, data: {} });
    // the truncated last line is the one that is not counted as an event
    expect(log!.events.at(-1)!.type).not.toBe("assistant.turn_start");
  });

  it("filters with include without counting the filtered events as skipped", async () => {
    const log = await readCopilotEventLog(logOf(rows.sdkSessionIds.malformed!), { include: (t) => t === "user.message" });
    expect(log!.events.map((e) => e.type)).toEqual(["user.message"]);
    expect(log!.skippedLines).toBe(rows.expected.malformed.skippedLines);
  });

  it("include sees only parsed events' types", async () => {
    const seen: string[] = [];
    await readCopilotEventLog(logOf(rows.sdkSessionIds.malformed!), { include: (t) => (seen.push(t), true) });
    expect(seen).toHaveLength(rows.expected.malformed.events);
    expect(seen.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
  });
});

describe("readCopilotEventLog errors", () => {
  it("is null for a missing file", async () => {
    expect(await readCopilotEventLog(path.join(tmp, "nope", "events.jsonl"))).toBeNull();
  });

  it("is null when a parent is a file (ENOTDIR)", async () => {
    const f = path.join(tmp, "plain-file");
    writeFileSync(f, "x");
    expect(await readCopilotEventLog(path.join(f, "events.jsonl"))).toBeNull();
  });

  it("rejects for a directory at the path", async () => {
    const d = path.join(tmp, "dir-as-file");
    mkdirSync(d);
    await expect(readCopilotEventLog(d)).rejects.toThrow();
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("rejects on EACCES", async () => {
    const f = path.join(tmp, "locked.jsonl");
    writeFileSync(f, '{"id":"a","type":"t","data":{}}\n');
    chmodSync(f, 0o000);
    await expect(readCopilotEventLog(f)).rejects.toThrow();
    chmodSync(f, 0o600);
  });

  it("returns an empty log for an empty file", async () => {
    const f = path.join(tmp, "empty.jsonl");
    writeFileSync(f, "");
    expect(await readCopilotEventLog(f)).toEqual({ events: [], skippedLines: 0 });
  });
});

describe("readCopilotEventLog line handling", () => {
  const ev = (id: string, type = "t", extra: object = {}) => JSON.stringify({ id, type, data: {}, ...extra });

  it("handles CRLF line endings", async () => {
    const f = path.join(tmp, "crlf.jsonl");
    writeFileSync(f, [ev("a"), ev("b")].join("\r\n") + "\r\n");
    const log = await readCopilotEventLog(f);
    expect(log!.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(log!.skippedLines).toBe(0);
  });

  it("skips blank and whitespace-only lines without counting them", async () => {
    const f = path.join(tmp, "blank.jsonl");
    writeFileSync(f, ["", ev("a"), "   ", "\t", ev("b"), ""].join("\n"));
    expect(await readCopilotEventLog(f)).toMatchObject({ skippedLines: 0, events: [{ id: "a" }, { id: "b" }] });
  });

  it("counts a line over maxLineChars without parsing it", async () => {
    const f = path.join(tmp, "cap.jsonl");
    const big = ev("big", "t", { pad: "x".repeat(200) });
    writeFileSync(f, [ev("a"), big, ev("b")].join("\n") + "\n");
    const log = await readCopilotEventLog(f, { maxLineChars: 100 });
    expect(log!.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(log!.skippedLines).toBe(1);
  });

  it("keeps a line of exactly maxLineChars", async () => {
    const f = path.join(tmp, "cap-edge.jsonl");
    const line = ev("edge");
    writeFileSync(f, line + "\n");
    expect((await readCopilotEventLog(f, { maxLineChars: line.length }))!.events).toHaveLength(1);
    expect((await readCopilotEventLog(f, { maxLineChars: line.length - 1 }))!.skippedLines).toBe(1);
  });

  it("treats a truncated last line without a newline as skipped", async () => {
    const f = path.join(tmp, "partial.jsonl");
    writeFileSync(f, ev("a") + "\n" + ev("b").slice(0, 20));
    expect(await readCopilotEventLog(f)).toMatchObject({ skippedLines: 1, events: [{ id: "a" }] });
  });

  it("is typed as CopilotEvent[]", async () => {
    const f = path.join(tmp, "typed.jsonl");
    writeFileSync(f, ev("a"));
    const log = await readCopilotEventLog(f);
    const first: CopilotEvent = log!.events[0]!;
    expect(first.id).toBe("a");
  });
});

describe("readCopilotEventLog on a file of 20 MB or more", () => {
  it("streams it, skips the over-cap line and keeps every other event", async () => {
    const f = path.join(tmp, "large.jsonl");
    const out = createWriteStream(f);
    const write = (s: string) =>
      new Promise<void>((resolve, reject) => {
        out.write(s, (err) => (err ? reject(err) : resolve()));
      });
    const pad = "p".repeat(1000);
    const N = 21_000; // ~21 MB of normal lines
    for (let i = 0; i < N; i++) {
      await write(JSON.stringify({ id: `e${i}`, type: i % 2 ? "assistant.message" : "tool.execution_start", data: { pad } }) + "\n");
      if (i === 10_000) {
        // one line over the default cap (8 Mi chars)
        await write(JSON.stringify({ id: "huge", type: "permission.requested", data: { blob: "z".repeat(MAX_EVENT_LINE_CHARS + 10) } }) + "\n");
      }
    }
    await new Promise<void>((resolve) => out.end(resolve));
    expect(statSync(f).size).toBeGreaterThanOrEqual(20 * 1024 * 1024);

    const log = await readCopilotEventLog(f);
    expect(log!.skippedLines).toBe(1);
    expect(log!.events).toHaveLength(N);
    expect(log!.events[0]!.id).toBe("e0");
    expect(log!.events.at(-1)!.id).toBe(`e${N - 1}`);
    expect(log!.events.some((e) => e.id === "huge")).toBe(false);

    const filtered = await readCopilotEventLog(f, { include: (t) => t === "assistant.message" });
    expect(filtered!.events).toHaveLength(N / 2);
    expect(filtered!.skippedLines).toBe(1);
  }, 120_000);
});
