// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The xdotool argv that types a prompt. An argv array, never a shell string, so quotes and `$` stay literal.
export function promptKeystrokes(text: string, delayMs: number): string[] {
  if (text.length === 0) throw new Error("Prompt text is empty");
  if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error(`Typing delay must be a whole number of ms >= 0, got ${delayMs}`);
  return ["type", "--delay", String(delayMs), "--clearmodifiers", "--", text];
}
