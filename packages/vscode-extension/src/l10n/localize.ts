// The seam between the host's user-visible strings and `vscode.l10n`
// (vscode-extension.md §3.5 Localization). The pure models take a Translate
// instead of importing `vscode`; extension.ts passes `vscode.l10n.t`, which
// has this shape: the English message is the key, `{0}`, `{1}` are
// replaced by the arguments, and a translation bundle (none yet: English
// only) would replace the message first.
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

// English as written: the default of the models, and what tests use.
export const identityTranslate: Translate = (message, ...args) => formatMessage(message, args);
