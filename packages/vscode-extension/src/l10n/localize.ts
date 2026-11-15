// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The seam between the host's user-visible strings and `vscode.l10n`
// (vscode-extension.md §3.5 Localization). The pure models take a Translate
// instead of importing `vscode`; extension.ts passes `vscode.l10n.t`, which
// has this shape: the English message is the key, `{0}`, `{1}` are
// replaced by the arguments, and a translation bundle (none yet: English
// only) would replace the message first. The type and the English default
// live in the domain, whose shared wording (the monthly allowance) takes the
// same seam.
export { formatMessage, identityTranslate, type Translate } from "@agent-cost-analyzer/domain";
