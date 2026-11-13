// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Maths for the drawn demo pointer (wdio clicks through the DOM and never moves the X pointer).

export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };

// Offsets are the iframe/webview origins between the element's document and the screen.
export function targetPoint(element: Rect, frameOffsets: Point[]): Point {
  const base = { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  return frameOffsets.reduce((p, o) => ({ x: p.x + o.x, y: p.y + o.y }), base);
}

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

export function glidePath(from: Point, to: Point, steps: number): Point[] {
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`steps must be an integer >= 1, got ${steps}`);
  const path: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const e = smoothstep(i / steps);
    path.push({ x: Math.round(from.x + (to.x - from.x) * e), y: Math.round(from.y + (to.y - from.y) * e) });
  }
  // Rounding could leave the last point off by one when `to` is fractional; land exactly.
  path[steps - 1] = { x: Math.round(to.x), y: Math.round(to.y) };
  return path;
}
