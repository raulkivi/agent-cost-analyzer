// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { terminalLayout, xtermArgs, XTERM_FONT } from "./terminal-layout.mts";

const frame = { width: 1600, height: 1000 };

describe("terminalLayout", () => {
  it("docks both terminals in a 300 px strip along the bottom, full width, so the CLI's lines do not wrap", () => {
    const layout = terminalLayout(frame);
    expect(layout.A).toEqual({ x: 0, y: 700, width: 1600, height: 300 });
    expect(layout.B).toEqual(layout.A);
  });
  it("gives the browser the rest of the frame, above the terminals", () => {
    const { A, browser } = terminalLayout(frame);
    expect(browser).toEqual({ x: 0, y: 0, width: 1600, height: 700 });
    expect(browser.y + browser.height).toBe(A.y);
  });
  it("rejects a frame that is not a positive size", () => {
    expect(() => terminalLayout({ width: 0, height: 1000 })).toThrow(/frame/i);
  });
});

describe("xtermArgs", () => {
  it("starts a scrollbar-free xterm with a large mono font and a class the adapter can find", () => {
    const args = xtermArgs("A", { x: 0, y: 0, width: 1600, height: 1000 });
    expect(args[args.indexOf("-name") + 1]).toBe("aica-terminal-a");
    expect(args[args.indexOf("-class") + 1]).toBe("AicaDemoTerminal");
    expect(args).toContain("+sb");
    expect(args).toContain(XTERM_FONT);
    expect(args[args.indexOf("-geometry") + 1]).toMatch(/^\d+x\d+\+0\+0$/);
  });
  it("runs a shell with no rc files, so the prompt is the bare PS1", () => {
    const args = xtermArgs("B", { x: 0, y: 0, width: 1600, height: 1000 });
    expect(args.slice(args.indexOf("-e"))).toEqual(["-e", "bash", "--norc", "--noprofile"]);
  });
});
