// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { Xdotool } from "./xdotool.mts";

function setup() {
  const calls: { command: string; args: string[]; env: Record<string, string | undefined> }[] = [];
  const xdo = new Xdotool(":93", async (command, args, env) => {
    calls.push({ command, args, env });
    return "";
  });
  return { xdo, calls };
}

describe("Xdotool", () => {
  it("clicks at a point with the mouse", async () => {
    const { xdo, calls } = setup();
    await xdo.click({ x: 10, y: 20 });
    expect(calls[0]).toMatchObject({ command: "xdotool", args: ["mousemove", "10", "20", "click", "1"] });
    expect(calls[0].env.DISPLAY).toBe(":93");
  });
  it("presses a key chord", async () => {
    const { xdo, calls } = setup();
    await xdo.key("ctrl+n");
    expect(calls[0].args).toEqual(["key", "--clearmodifiers", "ctrl+n"]);
  });
  it("types through promptKeystrokes", async () => {
    const { xdo, calls } = setup();
    await xdo.type("hi there", 60);
    expect(calls[0].args).toEqual(["type", "--delay", "60", "--clearmodifiers", "--", "hi there"]);
  });
  it("fits a window to the frame", async () => {
    const { xdo, calls } = setup();
    await xdo.fitWindow("12345", { width: 1600, height: 1000 });
    expect(calls[0].args).toEqual(["windowmove", "12345", "0", "0", "windowsize", "12345", "1600", "1000"]);
  });
  it("finds the window id by class", async () => {
    const calls: string[][] = [];
    const xdo = new Xdotool(":93", async (_c, args) => {
      calls.push(args);
      return "111\n222\n";
    });
    await expect(xdo.findWindow("claude")).resolves.toBe("111");
    expect(calls[0]).toEqual(["search", "--onlyvisible", "--class", "claude"]);
  });
  it("returns undefined when no window matches", async () => {
    const xdo = new Xdotool(":93", async () => "");
    await expect(xdo.findWindow("claude")).resolves.toBeUndefined();
  });
});
