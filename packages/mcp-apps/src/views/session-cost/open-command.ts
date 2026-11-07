// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// A0 found both hosts refuse vscode:// links, and the Command Palette can't
// take an argument (plan §4.4). Owner decision A: the extension's palette
// command "Open Session…" opens a picker, and the view copies the session
// title for the user to paste into it. The clipboard goes to the user, never
// to the model (§6).

/** The palette title the extension contributes (package.nls.json). */
export const OPEN_SESSION_COMMAND_TITLE = "AI Credits Analyzer: Open Session…";

const MAX_LENGTH = 120;

/** What the button copies: the title on one line, or the id when there is no title. */
export function sessionSearchText(sessionId: string, title: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const oneLine = title.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return oneLine === "" ? sessionId : oneLine.slice(0, MAX_LENGTH);
}
