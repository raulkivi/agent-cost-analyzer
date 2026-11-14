// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The ledger theme's fonts (dense-ledger-ui.md D3), bundled with the app
// (vscode-extension.md G12, constraint 1: no network call, so no Google
// Fonts): Commit Mono for the UI, Source Serif 4 for prose. Only the
// weights theme.css uses and the Latin subset, to keep the bundle small;
// other scripts fall back to the system fonts in each stack. Licences in
// THIRD-PARTY-NOTICES.md. The extension build leaves these out
// (vite-plugins/omit-modules.ts), since the webview uses the editor's font.
import "@fontsource/commit-mono/latin-400.css";
import "@fontsource/commit-mono/latin-700.css";
import "@fontsource/source-serif-4/latin-400.css";
import "@fontsource/source-serif-4/latin-600.css";
