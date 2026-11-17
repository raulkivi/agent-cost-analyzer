// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Where the windows go. There is no window manager: the two xterm windows share a strip along the bottom and the
// browser takes the rest above it, so both stay readable (D47). Raising a terminal (xdotool windowraise) switches
// A to B and never hides the browser.
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

// The terminal strip is full width and 10 rows tall at that font: the CLI's lines (up to 76 characters) do not wrap,
// and the browser keeps 1600x700, wide enough for the app's header.
const TERMINAL_HEIGHT = 300;

export function terminalLayout(frame: { width: number; height: number }): Record<TerminalName | "browser", Rect> {
  if (!(frame.width > 0) || !(frame.height > 0)) throw new Error(`The frame must have a positive size, got ${frame.width}x${frame.height}`);
  if (frame.height <= TERMINAL_HEIGHT) throw new Error(`The frame must be taller than the ${TERMINAL_HEIGHT} px terminal strip, got ${frame.height}`);
  const top = frame.height - TERMINAL_HEIGHT;
  const terminal = { x: 0, y: top, width: frame.width, height: TERMINAL_HEIGHT };
  return { A: { ...terminal }, B: { ...terminal }, browser: { x: 0, y: 0, width: frame.width, height: top } };
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
