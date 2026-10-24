import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePiJsonlLine, readPiSessionFile } from "./pi-jsonl-reader.js";

describe("parsePiJsonlLine", () => {
  it("parses a session header line", () => {
    const line = JSON.stringify({
      type: "session",
      version: 3,
      id: "session-1",
      timestamp: "2026-08-01T00:00:00.000Z",
      cwd: "/home/user/project",
    });

    expect(parsePiJsonlLine(line)).toEqual({
      type: "session",
      version: 3,
      id: "session-1",
      timestamp: "2026-08-01T00:00:00.000Z",
      cwd: "/home/user/project",
    });
  });

  it("parses a message entry, keeping the nested message payload intact", () => {
    const line = JSON.stringify({
      type: "message",
      id: "e1",
      parentId: "session-1",
      message: { role: "user", content: "hello", timestamp: 1234 },
    });

    const parsed = parsePiJsonlLine(line);

    expect(parsed?.type).toBe("message");
    expect((parsed as unknown as { message: { role: string } }).message.role).toBe("user");
  });

  it("returns null for a malformed line rather than throwing", () => {
    expect(parsePiJsonlLine("{not json")).toBeNull();
  });

  it("returns null for a line without a string type field", () => {
    expect(parsePiJsonlLine(JSON.stringify({ id: "e1" }))).toBeNull();
  });

  it("returns null for a blank line", () => {
    expect(parsePiJsonlLine("   ")).toBeNull();
  });
});

describe("readPiSessionFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pi-jsonl-reader-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an empty header/entries result for a missing file", async () => {
    const result = await readPiSessionFile(path.join(dir, "missing.jsonl"));

    expect(result).toEqual({ header: null, entries: [], rawLineCount: 0 });
  });

  it("separates the header line from later entries and skips malformed lines", async () => {
    const filePath = path.join(dir, "session.jsonl");
    writeFileSync(
      filePath,
      [
        JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "t", cwd: "/x" }),
        JSON.stringify({ type: "message", id: "e1", parentId: "s1", message: { role: "user" } }),
        "{not json at all",
        JSON.stringify({ type: "model_change", id: "e2", parentId: "e1", provider: "anthropic", modelId: "claude" }),
        "",
      ].join("\n"),
    );

    const result = await readPiSessionFile(filePath);

    expect(result.header?.id).toBe("s1");
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].id).toBe("e1");
    expect(result.entries[1].type).toBe("model_change");
    expect(result.rawLineCount).toBe(4);
  });

  it("treats a file whose first line is not a session header as having no header, but still collects entries", async () => {
    const filePath = path.join(dir, "no-header.jsonl");
    writeFileSync(
      filePath,
      [JSON.stringify({ type: "message", id: "e1", message: { role: "user" } })].join("\n"),
    );

    const result = await readPiSessionFile(filePath);

    expect(result.header).toBeNull();
    expect(result.entries).toHaveLength(1);
  });
});
