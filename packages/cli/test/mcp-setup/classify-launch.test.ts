// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { classifyLaunch } from "../../src/mcp-setup/classify-launch.js";

const rest = ["-y", "--prefer-offline"];

describe("classifyLaunch", () => {
  it("recognizes the unpinned package as latest", () => {
    expect(
      classifyLaunch({
        command: "npx",
        args: [...rest, "agent-cost-analyzer", "mcp"],
      }),
    ).toBe("latest");
  });

  it("recognizes a pinned package and returns its version", () => {
    expect(
      classifyLaunch({
        command: "npx",
        args: [...rest, "agent-cost-analyzer@1.2.3-rc.1", "mcp"],
      }),
    ).toEqual({ pinned: "1.2.3-rc.1" });
  });

  it("looks through a cmd /c npx wrapper", () => {
    expect(
      classifyLaunch({
        command: "cmd",
        args: ["/c", "npx", ...rest, "agent-cost-analyzer@0.9.0", "mcp"],
      }),
    ).toEqual({ pinned: "0.9.0" });
  });

  it("ignores extra keys such as type and env", () => {
    expect(
      classifyLaunch({
        type: "stdio",
        command: "npx",
        args: ["agent-cost-analyzer", "mcp"],
        env: {},
      }),
    ).toBe("latest");
  });

  it("does not take another package that merely starts with the name", () => {
    expect(
      classifyLaunch({
        command: "npx",
        args: ["agent-cost-analyzer-x", "mcp"],
      }),
    ).toBe("custom");
  });

  it.each([
    ["no args", { command: "npx" }],
    ["args that are not strings", { command: "npx", args: [1, 2] }],
    ["not an object", "npx agent-cost-analyzer"],
    ["a local script", { command: "node", args: ["/x/server.js"] }],
  ])("calls %s custom", (_label, entry) => {
    expect(classifyLaunch(entry)).toBe("custom");
  });
});
