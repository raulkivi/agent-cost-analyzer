// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { freeDisplay, lockHolderPid } from "./desktop-session.mts";

describe("lockHolderPid", () => {
  it("reads the pid after the host name", () => {
    expect(lockHolderPid("my-host-1234")).toBe(1234);
  });
  it("returns undefined for a missing or malformed target", () => {
    expect(lockHolderPid(undefined)).toBeUndefined();
    expect(lockHolderPid("garbage")).toBeUndefined();
  });
});

describe("freeDisplay", () => {
  it("skips displays with a socket or lock file", () => {
    const taken = new Set(["/tmp/.X11-unix/X90", "/tmp/.X91-lock"]);
    expect(freeDisplay((f) => taken.has(f))).toBe(":92");
  });
  it("fails when every display is taken", () => {
    expect(() => freeDisplay(() => true)).toThrow(/No free X display/);
  });
});
