import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      ".design-sync/previews/**",
      "ds-bundle/**",
      ".ds-sync/**",
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
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
