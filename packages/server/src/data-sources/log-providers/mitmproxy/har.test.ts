import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { harEntryToRawExchange, readHarFile } from "./har.js";

describe("readHarFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "har-reader-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("parses a well-formed HAR file's entries", () => {
    const filePath = path.join(dir, "capture.har");
    writeFileSync(
      filePath,
      JSON.stringify({
        log: {
          version: "1.2",
          entries: [
            {
              startedDateTime: "2026-08-01T12:00:00.000Z",
              request: { method: "POST", url: "https://api.anthropic.com/v1/messages", headers: [] },
              response: { status: 200, headers: [], content: {} },
            },
          ],
        },
      }),
    );

    const har = readHarFile(filePath);

    expect(har.log.entries).toHaveLength(1);
    expect(har.log.entries[0].request.method).toBe("POST");
  });

  it("throws on a file that isn't shaped like a HAR", () => {
    const filePath = path.join(dir, "not-a-har.json");
    writeFileSync(filePath, JSON.stringify({ hello: "world" }));

    expect(() => readHarFile(filePath)).toThrow(/not a valid HAR file/);
  });
});

describe("harEntryToRawExchange", () => {
  it("redacts credential headers and defaults missing bodies to empty strings", () => {
    const exchange = harEntryToRawExchange({
      startedDateTime: "2026-08-01T12:00:00.000Z",
      request: {
        method: "POST",
        url: "https://api.anthropic.com/v1/messages",
        headers: [
          { name: "authorization", value: "Bearer sk-ant-live-FAKE" },
          { name: "anthropic-version", value: "2023-06-01" },
        ],
      },
      response: {
        status: 200,
        headers: [{ name: "content-type", value: "application/json" }],
        content: { mimeType: "application/json", text: '{"type":"message"}' },
      },
    });

    expect(exchange.requestHeaders).toEqual({ "anthropic-version": "2023-06-01" });
    expect(exchange.requestBody).toBe("");
    expect(exchange.responseHeaders).toEqual({ "content-type": "application/json" });
    expect(exchange.responseBody).toBe('{"type":"message"}');
    expect(exchange.responseMimeType).toBe("application/json");
    expect(exchange.timestamp).toBe("2026-08-01T12:00:00.000Z");
  });
});
