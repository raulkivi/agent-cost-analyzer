---
name: uninstall-extension
description: Uninstall the AI Credits Analyzer VS Code extension (raulkivi.ai-credits-analyzer) from the local VS Code. Use when asked to uninstall or remove the extension locally.
---

# Uninstall the extension locally

1. Check it is installed:
   `code-insiders --list-extensions | grep raulkivi.ai-credits-analyzer`
   - If nothing matches, report that it isn't installed and stop.
2. Uninstall:
   `code-insiders --uninstall-extension raulkivi.ai-credits-analyzer`
   - The ID is `<publisher>.<name>` from `packages/vscode-extension/package.json`.
   - This machine has only VS Code Insiders (`/snap/bin/code-insiders`); use `code` if `code-insiders` is missing.

Leave the built `.vsix` and `dist/` in place; reinstall with the `install-extension` skill.

Afterwards, tell the user to reload the VS Code window (Developer: Reload Window) to unload it.
