import { describe, expect, it, vi } from "vitest";
import { migrateLegacyAppSettingsDir } from "./migrate-legacy-app-settings-dir.js";

function fakeFs(existingPaths: Set<string>) {
  const existsSync = vi.fn((p: import("node:fs").PathLike) => existingPaths.has(String(p)));
  const renameSync = vi.fn(
    (from: import("node:fs").PathLike, to: import("node:fs").PathLike) => {
      existingPaths.delete(String(from));
      existingPaths.add(String(to));
    },
  );
  return { existsSync, renameSync };
}

describe("migrateLegacyAppSettingsDir", () => {
  const options = { platform: "linux" as const, homeDir: "/home/dev", env: {} };
  const currentDir = "/home/dev/.config/agent-cost-analyzer";
  const copilotDir = "/home/dev/.config/copilot-cost-analyzer";
  const oldestDir = "/home/dev/.config/gh-cp-chat-analyser";

  it("renames copilot-cost-analyzer to the current directory when only it exists", () => {
    const { existsSync, renameSync } = fakeFs(new Set([copilotDir]));

    migrateLegacyAppSettingsDir({ ...options, existsSync, renameSync });

    expect(renameSync).toHaveBeenCalledTimes(1);
    expect(renameSync).toHaveBeenCalledWith(copilotDir, currentDir);
  });

  it("renames gh-cp-chat-analyser to the current directory when only it exists", () => {
    const { existsSync, renameSync } = fakeFs(new Set([oldestDir]));

    migrateLegacyAppSettingsDir({ ...options, existsSync, renameSync });

    expect(renameSync).toHaveBeenCalledTimes(1);
    expect(renameSync).toHaveBeenCalledWith(oldestDir, currentDir);
  });

  it("renames only the newest legacy directory when both exist", () => {
    const { existsSync, renameSync } = fakeFs(new Set([copilotDir, oldestDir]));

    migrateLegacyAppSettingsDir({ ...options, existsSync, renameSync });

    expect(renameSync).toHaveBeenCalledTimes(1);
    expect(renameSync).toHaveBeenCalledWith(copilotDir, currentDir);
  });

  it("does nothing when the current directory already exists", () => {
    const { existsSync, renameSync } = fakeFs(new Set([currentDir, copilotDir, oldestDir]));

    migrateLegacyAppSettingsDir({ ...options, existsSync, renameSync });

    expect(renameSync).not.toHaveBeenCalled();
  });

  it("does nothing when no directory exists", () => {
    const { existsSync, renameSync } = fakeFs(new Set());

    migrateLegacyAppSettingsDir({ ...options, existsSync, renameSync });

    expect(renameSync).not.toHaveBeenCalled();
  });
});
