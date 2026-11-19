// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from "vitest";
import { LAST_CLIENT_STORAGE_KEY, readLastClient, writeLastClient } from "./last-client.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

describe("the remembered client", () => {
  it("is namespaced like the color mode", () => {
    expect(LAST_CLIENT_STORAGE_KEY).toBe("aca.mcpSetupClient");
  });

  it("is Claude Code the first time", () => {
    expect(readLastClient(memoryStorage())).toBe("claude-code");
  });

  it("returns the last client written", () => {
    const storage = memoryStorage();
    writeLastClient(storage, "codex");
    expect(readLastClient(storage)).toBe("codex");
  });

  it("ignores a stored value that is not a client", () => {
    expect(readLastClient(memoryStorage({ [LAST_CLIENT_STORAGE_KEY]: "emacs" }))).toBe("claude-code");
  });

  it("works without storage", () => {
    expect(readLastClient(null)).toBe("claude-code");
    expect(() => writeLastClient(null, "cursor")).not.toThrow();
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    expect(readLastClient(broken)).toBe("claude-code");
    expect(() => writeLastClient(broken, "cursor")).not.toThrow();
  });
});
