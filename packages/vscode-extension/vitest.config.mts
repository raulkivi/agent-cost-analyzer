import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // dist/, media/ and out/ are build output, never test sources; the
    // real-VS Code integration suite runs under @vscode/test-cli instead
    // (`npm run test:integration`).
    exclude: [...configDefaults.exclude, "**/dist/**", "**/media/**", "**/out/**", "src/test/integration/**"],
  },
});
