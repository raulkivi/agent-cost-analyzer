import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // dist/ and media/ are build output, never test sources.
    exclude: [...configDefaults.exclude, "**/dist/**", "**/media/**"],
  },
});
