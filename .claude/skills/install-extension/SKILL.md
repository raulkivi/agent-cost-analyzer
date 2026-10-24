---
name: install-extension
description: Rebuild, package and install the AI Credits Analyzer VS Code extension (packages/vscode-extension) into the local VS Code. Use when asked to recompile, rebuild, repackage, reinstall or install the extension locally.
---

# Install the extension locally

Run from `packages/vscode-extension`:

1. Build (web bundle into `media/`, then the extension into `dist/`):
   `npm run build`
2. Package into `ai-credits-analyzer-<version>.vsix`:
   `npm run package`
3. Install, replacing any copy with the same version:
   `code-insiders --install-extension ai-credits-analyzer-<version>.vsix --force`
   - `<version>` is the `version` field of `packages/vscode-extension/package.json`.
   - This machine has only VS Code Insiders (`/snap/bin/code-insiders`); use `code` if `code-insiders` is missing.

Stop and report the output if any step fails; don't install a stale `.vsix`.

Afterwards, tell the user to reload the VS Code window (Developer: Reload Window) to load the new build.
