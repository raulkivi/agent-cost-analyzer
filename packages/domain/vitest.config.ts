import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // vitest's default exclude only skips node_modules/.git, so a local
    // `tsc` build's dist/ (compiled .test.js alongside the .ts sources)
    // would otherwise be discovered and run a second time.
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
});
