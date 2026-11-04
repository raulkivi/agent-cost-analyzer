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
            "packages/*/vitest.config.ts",
            "packages/*/vite.config.ts",
            "packages/vscode-extension/.vscode-test.mjs",
            "packages/vscode-extension/wdio.conf.mts", "packages/vscode-extension/wdio.copilot.conf.mts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
