// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The view's gateway to the clipboard (DIP, like AppHostPort): a component
// asks for "copy this text" and tests inject a fake. A host that blocks the
// clipboard gets no port, and the affordance is hidden.
export interface ClipboardPort {
  writeText(text: string): Promise<void>;
}

interface NavigatorLike {
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

export function browserClipboard(nav: NavigatorLike | undefined = typeof navigator === "undefined" ? undefined : navigator): ClipboardPort | undefined {
  const clipboard = nav?.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return undefined;
  const writeText = clipboard.writeText.bind(clipboard);
  return { writeText: (text) => writeText(text) };
}
