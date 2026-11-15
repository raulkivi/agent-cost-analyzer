// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// The seam between wording and localization. The English message is the key
// and `{0}`, `{1}` take the arguments, the shape of `vscode.l10n.t`, so the
// extension passes it straight in and a translation bundle replaces the
// message first. The standalone app is English only and uses the identity.
export type Translate = (message: string, ...args: Array<string | number>) => string;

// Fills the `{n}` placeholders in one pass, so an argument that itself
// contains "{1}" is not expanded again. A placeholder without an argument
// stays as written.
export function formatMessage(message: string, args: ReadonlyArray<string | number>): string {
  return message.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const arg = args[Number(index)];
    return arg === undefined ? placeholder : String(arg);
  });
}

export const identityTranslate: Translate = (message, ...args) => formatMessage(message, args);
