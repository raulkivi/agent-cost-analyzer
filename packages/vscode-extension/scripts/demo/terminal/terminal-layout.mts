// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Where the two xterm windows go. There is no window manager, so each window sits at 0,0 and
// raising one (xdotool windowraise) is how a take switches between the terminals and the browser.
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type TerminalName = "A" | "B";

// Large enough to read in a 12 fps GIF at 1:1.
export const XTERM_FONT = "DejaVu Sans Mono";
const FONT_SIZE = "24";
// Pixels per cell at that size; only sizes the initial -geometry, the adapter resizes to the exact rect afterwards.
const CELL = { width: 14, height: 30 };

export function terminalLayout(frame: { width: number; height: number }): Record<TerminalName, Rect> {
  if (!(frame.width > 0) || !(frame.height > 0)) throw new Error(`The frame must have a positive size, got ${frame.width}x${frame.height}`);
  const full = { x: 0, y: 0, width: frame.width, height: frame.height };
  return { A: { ...full }, B: { ...full } };
}

// bash without rc files: the prompt is exactly the PS1 the environment sets, whatever the host's dotfiles hold.
export function xtermArgs(name: TerminalName, rect: Rect): string[] {
  const cols = Math.floor(rect.width / CELL.width);
  const rows = Math.floor(rect.height / CELL.height);
  return [
    "-name", `aica-terminal-${name.toLowerCase()}`,
    "-class", "AicaDemoTerminal",
    "-fa", XTERM_FONT, "-fs", FONT_SIZE,
    "+sb",
    "-bg", "#0d1117", "-fg", "#e6edf3", "-cr", "#e6edf3",
    "-geometry", `${cols}x${rows}+${rect.x}+${rect.y}`,
    "-e", "bash", "--norc", "--noprofile",
  ];
}
