import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeHarSessionId, computeSegmentSessionId, parseSegmentSessionId } from "./session-id.js";

function makeTempHarFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "session-id-test-"));
  const filePath = path.join(dir, "capture.har");
  writeFileSync(filePath, JSON.stringify({ log: { entries: [] } }));
  return filePath;
}

describe("computeSegmentSessionId", () => {
  it("appends the segment index to computeHarSessionId's hash separated by a dash", () => {
    const filePath = makeTempHarFile();

    expect(computeSegmentSessionId(filePath, 0)).toBe(`${computeHarSessionId(filePath)}-0`);
    expect(computeSegmentSessionId(filePath, 3)).toBe(`${computeHarSessionId(filePath)}-3`);
  });
});

describe("parseSegmentSessionId", () => {
  it("round-trips computeSegmentSessionId's output back into fileHash/segmentIndex", () => {
    const filePath = makeTempHarFile();
    const fileHash = computeHarSessionId(filePath);

    expect(parseSegmentSessionId(computeSegmentSessionId(filePath, 0))).toEqual({
      fileHash,
      segmentIndex: 0,
    });
    expect(parseSegmentSessionId(computeSegmentSessionId(filePath, 12))).toEqual({
      fileHash,
      segmentIndex: 12,
    });
  });

  it("returns null when there is no dash", () => {
    expect(parseSegmentSessionId("abc123")).toBeNull();
  });

  it("returns null for a non-numeric suffix, including the sentinel unknown id used in tests", () => {
    expect(parseSegmentSessionId("does-not-exist")).toBeNull();
  });

  it("returns null when the segment suffix contains non-digit characters", () => {
    expect(parseSegmentSessionId("abc123-1x")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseSegmentSessionId("")).toBeNull();
  });
});
