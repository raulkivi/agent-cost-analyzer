// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// A0 found both hosts refuse vscode:// links (plan §4.4), so the view copies
// this Command Palette text instead of opening a link. Only the id goes in.
export function openSessionCommand(sessionId: string): string {
  return `AI Credits Analyzer: Open Session ${sessionId}`;
}
