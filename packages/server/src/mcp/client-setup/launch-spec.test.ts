// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

import { describe, expect, it } from "vitest";
import { MCP_SERVER_NAME, buildLaunchSpec } from "./launch-spec.js";

const base = {
  version: "1.2.3",
  pin: false,
  projectBillingDetails: false,
  platform: "linux" as NodeJS.Platform,
  windowsCmdWrap: false,
};

describe("buildLaunchSpec", () => {
  it("names the server agent-cost-analyzer", () => {
    expect(MCP_SERVER_NAME).toBe("agent-cost-analyzer");
  });

  it("defaults to the unpinned npx launch", () => {
    expect(buildLaunchSpec(base)).toEqual({
      command: "npx",
      args: ["-y", "--prefer-offline", "agent-cost-analyzer", "mcp"],
    });
  });

  it("pins the package version", () => {
    expect(buildLaunchSpec({ ...base, pin: true }).args).toEqual([
      "-y",
      "--prefer-offline",
      "agent-cost-analyzer@1.2.3",
      "mcp",
    ]);
  });

  it("appends the billing flag after mcp", () => {
    expect(buildLaunchSpec({ ...base, projectBillingDetails: true }).args).toEqual([
      "-y",
      "--prefer-offline",
      "agent-cost-analyzer",
      "mcp",
      "--project-billing-details",
    ]);
  });

  it.each([
    [{ windowsCmdWrap: true, platform: "win32" as const }, true],
    [{ windowsCmdWrap: true, platform: "linux" as const }, false],
    [{ windowsCmdWrap: false, platform: "win32" as const }, false],
  ])("wraps in cmd /c only on win32 with the flag: %j", (o, wrapped) => {
    const spec = buildLaunchSpec({ ...base, ...o, pin: true, projectBillingDetails: true });
    const rest = [
      "-y",
      "--prefer-offline",
      "agent-cost-analyzer@1.2.3",
      "mcp",
      "--project-billing-details",
    ];
    expect(spec).toEqual(
      wrapped ? { command: "cmd", args: ["/c", "npx", ...rest] } : { command: "npx", args: rest },
    );
  });

  it.each(["1.2.3", "0.0.1", "1.0.0-rc.1", "2.0.0+build.5", "1.0.0-beta.2+x"])(
    "accepts version %s",
    (version) => {
      expect(() => buildLaunchSpec({ ...base, pin: true, version })).not.toThrow();
    },
  );

  it.each(["", "latest", "1.2", "1.2.3 --evil", "^1.2.3", "1.2.3;rm", "../x", "1.2.3\n"])(
    "rejects version %j when pinning",
    (version) => {
      expect(() => buildLaunchSpec({ ...base, pin: true, version })).toThrow(/version/i);
    },
  );

  it("ignores the version when not pinning", () => {
    expect(() => buildLaunchSpec({ ...base, version: "weird" })).not.toThrow();
  });
});
