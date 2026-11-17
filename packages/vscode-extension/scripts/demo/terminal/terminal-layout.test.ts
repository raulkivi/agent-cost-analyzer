// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { terminalLayout, xtermArgs, XTERM_FONT } from "./terminal-layout.mts";

const frame = { width: 1600, height: 1000 };

describe("terminalLayout", () => {
  it("gives Terminal A and Terminal B the whole frame, so whichever is raised fills the recording", () => {
    const layout = terminalLayout(frame);
    expect(layout.A).toEqual({ x: 0, y: 0, width: 1600, height: 1000 });
    expect(layout.B).toEqual(layout.A);
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
