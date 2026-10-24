import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeBranchSessionId, computePiFileHash, parseBranchSessionId } from "./session-id.js";

describe("computePiFileHash / computeBranchSessionId / parseBranchSessionId", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "pi-session-id-"));
    filePath = path.join(dir, "session.jsonl");
    writeFileSync(filePath, "content");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("computes a stable hash for the same unmodified file", () => {
    expect(computePiFileHash(filePath)).toBe(computePiFileHash(filePath));
  });

  it("round-trips a branch session id back to its file hash and leaf id, even when the leaf id contains hyphens (uuids)", () => {
    const leafId = "a1b2c3d4-e5f6-47a8-9abc-def012345678";
    const id = computeBranchSessionId(filePath, leafId);
    const fileHash = computePiFileHash(filePath);

    const parsed = parseBranchSessionId(id);

    expect(parsed).toEqual({ fileHash, leafId });
  });

  it("returns null for an id with no branch marker", () => {
    expect(parseBranchSessionId("not-a-branch-id")).toBeNull();
  });

  it("returns null for an id with an empty leaf id", () => {
    const fileHash = computePiFileHash(filePath);
    expect(parseBranchSessionId(`${fileHash}__branch__`)).toBeNull();
  });
});
