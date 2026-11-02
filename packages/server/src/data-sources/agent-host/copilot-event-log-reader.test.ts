import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_EVENT_LINE_CHARS,
  parseCopilotEventLine,
  readCopilotEventLog,
} from "./copilot-event-log-reader.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../fixtures/agent-host/copilot-cli/session-state",
);
const fixture = (id: string): string => path.join(FIXTURES, id, "events.jsonl");

const ev = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ id: "e1", type: "user.message", data: {}, ...over });

describe("parseCopilotEventLine", () => {
  it("normalizes a well-formed event", () => {
    expect(
      parseCopilotEventLine(
        ev({ parentId: "p", timestamp: "t", agentId: "a", data: { x: 1 } }),
      ),
    ).toEqual({
      id: "e1",
      type: "user.message",
      parentId: "p",
      timestamp: "t",
      agentId: "a",
      data: { x: 1 },
    });
  });

  it.each([
    ["non-JSON", "not json {"],
    ["array", "[1,2]"],
    ["string", '"s"'],
    ["null", "null"],
    ["missing id", JSON.stringify({ type: "x" })],
    ["empty id", JSON.stringify({ id: "", type: "x" })],
    ["numeric id", JSON.stringify({ id: 1, type: "x" })],
    ["missing type", JSON.stringify({ id: "a" })],
    ["empty type", JSON.stringify({ id: "a", type: "" })],
  ])("returns null for %s", (_n, line) => {
    expect(parseCopilotEventLine(line)).toBeNull();
  });

  it("nulls non-string parentId/timestamp/agentId and defaults data", () => {
    const e = parseCopilotEventLine(
      ev({ parentId: 5, timestamp: 7, agentId: { x: 1 }, data: [1] }),
    );
    expect(e).toMatchObject({
      parentId: null,
      timestamp: null,
      agentId: null,
      data: {},
    });
  });

  it("defaults data to {} when absent or a string", () => {
    expect(parseCopilotEventLine(JSON.stringify({ id: "a", type: "t" }))?.data).toEqual({});
    expect(parseCopilotEventLine(ev({ data: "s" }))?.data).toEqual({});
  });

  it("drops the base64 payload of session.binary_asset only", () => {
    const asset = parseCopilotEventLine(
      ev({ type: "session.binary_asset", data: { data: "AAAA", mimeType: "image/png" } }),
    );
    expect(asset?.data).toEqual({ mimeType: "image/png" });
    const other = parseCopilotEventLine(ev({ data: { data: "keep" } }));
    expect(other?.data).toEqual({ data: "keep" });
  });
});

describe("readCopilotEventLog", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "copilot-reader-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a normal fixture in file order with nothing skipped", async () => {
    const log = await readCopilotEventLog(fixture("5d1a0001-aaaa-4bbb-8ccc-000000000001"));
    expect(log?.skippedLines).toBe(0);
    expect(log?.events.length).toBe(38);
    expect(log?.events[0]?.type).toBe("session.start");
  });

  it("keeps the last event when there is no trailing newline and reads agentId", async () => {
    const log = await readCopilotEventLog(fixture("5d1a0002-aaaa-4bbb-8ccc-000000000002"));
    expect(log?.skippedLines).toBe(0);
    expect(log?.events.length).toBe(50);
    expect(log?.events.some((e) => e.agentId !== null)).toBe(true);
  });

  it("counts malformed lines: 8 events, 6 skipped, blank lines uncounted", async () => {
    const log = await readCopilotEventLog(fixture("5d1a0004-aaaa-4bbb-8ccc-000000000004"));
    expect(log?.events.length).toBe(8);
    expect(log?.skippedLines).toBe(6);
    expect(log?.events.some((e) => e.type === "future.event_type")).toBe(true);
  });

  it("returns null for ENOENT and ENOTDIR", async () => {
    expect(await readCopilotEventLog(path.join(dir, "missing.jsonl"))).toBeNull();
    writeFileSync(path.join(dir, "f"), "x");
    expect(await readCopilotEventLog(path.join(dir, "f", "events.jsonl"))).toBeNull();
  });

  it("rejects when the path is a directory", async () => {
    mkdirSync(path.join(dir, "d"));
    await expect(readCopilotEventLog(path.join(dir, "d"))).rejects.toBeDefined();
  });

  it("handles CRLF line endings", async () => {
    const f = path.join(dir, "crlf.jsonl");
    writeFileSync(f, `${ev({ id: "a" })}\r\n${ev({ id: "b" })}\r\n`);
    const log = await readCopilotEventLog(f);
    expect(log?.events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(log?.skippedLines).toBe(0);
  });

  it("counts a truncated last line as skipped", async () => {
    const f = path.join(dir, "trunc.jsonl");
    writeFileSync(f, `${ev({ id: "a" })}\n{"id":"b","type":"x","da`);
    const log = await readCopilotEventLog(f);
    expect(log?.events.length).toBe(1);
    expect(log?.skippedLines).toBe(1);
  });

  it("drops events include rejects without counting them", async () => {
    const f = path.join(dir, "inc.jsonl");
    writeFileSync(f, [ev({ id: "a", type: "keep" }), ev({ id: "b", type: "drop" }), "garbage"].join("\n"));
    const log = await readCopilotEventLog(f, { include: (t) => t === "keep" });
    expect(log?.events.map((e) => e.id)).toEqual(["a"]);
    expect(log?.skippedLines).toBe(1);
  });

  it("counts a line over maxLineChars without parsing it", async () => {
    const f = path.join(dir, "cap.jsonl");
    writeFileSync(f, [ev({ id: "a" }), ev({ id: "big", data: { p: "x".repeat(200) } })].join("\n"));
    const log = await readCopilotEventLog(f, { maxLineChars: 100 });
    expect(log?.events.map((e) => e.id)).toEqual(["a"]);
    expect(log?.skippedLines).toBe(1);
  });

  it("streams a 20 MB+ file with one line over the default cap", async () => {
    const f = path.join(dir, "large.jsonl");
    const filler = ev({ data: { p: "y".repeat(10_000) } });
    const chunks: string[] = [];
    let expected = 0;
    for (let i = 0; i < 2_000; i++) {
      chunks.push(filler.replace('"e1"', `"e${i}"`));
      expected++;
    }
    chunks.splice(1000, 0, ev({ id: "huge", data: { p: "z".repeat(MAX_EVENT_LINE_CHARS + 1) } }));
    writeFileSync(f, chunks.join("\n") + "\n");
    const log = await readCopilotEventLog(f);
    expect(log?.events.length).toBe(expected);
    expect(log?.skippedLines).toBe(1);
    expect(log?.events.some((e) => e.id === "huge")).toBe(false);
  });
});
