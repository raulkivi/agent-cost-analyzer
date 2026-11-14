// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRecordLines } from "./read-record-lines.js";

async function collect(filePath: string, options?: { highWaterMark?: number }): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of readRecordLines(filePath, options)) lines.push(line);
  return lines;
}

describe("readRecordLines", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "record-lines-"));
    file = path.join(dir, "log.jsonl");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("splits at line feeds and includes a final line without one", async () => {
    writeFileSync(file, "a\nb\nc");
    expect(await collect(file)).toEqual(["a", "b", "c"]);
  });

  it("does not yield an empty line after a trailing line feed", async () => {
    writeFileSync(file, "a\nb\n");
    expect(await collect(file)).toEqual(["a", "b"]);
  });

  it("keeps blank lines in the middle for the caller to skip", async () => {
    writeFileSync(file, "a\n\nb\n");
    expect(await collect(file)).toEqual(["a", "", "b"]);
  });

  it("removes the carriage return of CRLF endings", async () => {
    writeFileSync(file, "a\r\nb\r\n");
    expect(await collect(file)).toEqual(["a", "b"]);
  });

  it("does not split at U+2028, U+2029 or a lone carriage return", async () => {
    const record = "x\u2028y\u2029z\rw";
    writeFileSync(file, `${record}\nnext\n`);
    expect(await collect(file)).toEqual([record, "next"]);
  });

  it("reassembles records and multi-byte characters across chunk boundaries", async () => {
    const records = ["héllo € \u{1F600} one", "two \u2028 中文", "three"];
    writeFileSync(file, records.join("\n") + "\n");
    for (const highWaterMark of [1, 2, 3, 5, 7]) {
      expect(await collect(file, { highWaterMark })).toEqual(records);
    }
  });

  it("rejects with ENOENT for a missing file", async () => {
    await expect(collect(path.join(dir, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops cleanly when the consumer breaks out early", async () => {
    writeFileSync(file, "a\nb\nc\n");
    for await (const line of readRecordLines(file)) {
      expect(line).toBe("a");
      break;
    }
  });
});
