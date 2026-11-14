// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Turns a template-match result into the pixel to click.
export interface Match {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}
export interface Point {
  x: number;
  y: number;
}

export const MIN_SCORE = 0.9;

export function clickPoint(match: Match, minScore = MIN_SCORE): Point | undefined {
  if (match.score < minScore) return undefined;
  return { x: match.x + Math.floor(match.width / 2), y: match.y + Math.floor(match.height / 2) };
}
