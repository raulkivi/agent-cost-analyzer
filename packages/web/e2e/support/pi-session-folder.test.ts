// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { piSessionFolder } from "./pi-session-folder.mts";

describe("piSessionFolder", () => {
  it("turns a POSIX cwd into pi's --<cwd-with-dashes>-- folder name", () => {
    expect(piSessionFolder("/home/dev/portal-api")).toBe("--home-dev-portal-api--");
  });

  it("does the same for a Windows cwd, with no colon or backslash left in the name", () => {
    expect(piSessionFolder("C:\\Users\\RUNNER~1\\home\\dev\\portal-api")).toBe("--C--Users-RUNNER~1-home-dev-portal-api--");
  });

  it("makes a folder name a single path segment on every OS", () => {
    for (const cwd of ["/a/b", "C:\\a\\b", "D:/a/b"]) expect(piSessionFolder(cwd)).toMatch(/^--[^/\\:]+--$/);
  });
});
