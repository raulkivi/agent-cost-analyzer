// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "packages/vscode-extension/media/**",
      "packages/vscode-extension/out/**",
      "packages/vscode-extension/.vscode-test/**",
      // The UI automation's VS Code download and failure artefacts (step 10.16).
      "packages/vscode-extension/.wdio-vscode-service/**",
      "packages/vscode-extension/test/ui/out/**",
      "**/node_modules/**",
      "**/coverage/**",
      ".design-sync/previews/**",
      "ds-bundle/**",
      ".ds-sync/**",
      ".claude/worktrees/**",
      "packages/web/ds-sync-entry.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "*.js",
            "scripts/*.mjs",
            // The npm-package smoke's entry; its steps type-check in packages/cli.
            "scripts/npm-package-smoke.mts",
            "scripts/third-party-notices.mts",
            "packages/*/vitest.config.ts",
            "packages/*/vite.config.ts",
            "packages/vscode-extension/.vscode-test.mjs",
            "packages/server/scripts/*.mts",
            "packages/vscode-extension/wdio.conf.mts",
            "packages/vscode-extension/wdio.copilot.conf.mts",
            "packages/vscode-extension/wdio.record.conf.mts",
            "packages/vscode-extension/wdio.demo.conf.mts",
            "packages/vscode-extension/wdio.demo-copilot.conf.mts",
          ],
          // Config and script files outside any tsconfig, by design; the SA18
          // real-data suite and the SA0 scan raised the count past 24, the pi redaction CLI past 32,
          // the replay exit check (oracle, its tests, the suite) past 40, the Phase 15 exit check
          // with its oracle past 48, the pi fixture generator (script, lib, tests) past 56, the tool-audit check (oracle, its tests, the suite) past 60,
          // the Claude Code subagent check (oracle, scan, their tests, the suite) past 66.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 72,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
