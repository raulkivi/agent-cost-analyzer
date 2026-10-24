import { describe, expect, it } from "vitest";
import { omitModulesPlugin } from "./omit-modules.js";

type Hook = (...args: unknown[]) => unknown;

function hooksOf(pattern: RegExp) {
  const plugin = omitModulesPlugin(pattern);
  return { resolveId: plugin.resolveId as Hook, load: plugin.load as Hook };
}

describe("omitModulesPlugin", () => {
  it("resolves a matching import to an empty module", () => {
    const { resolveId, load } = hooksOf(/^@fontsource\//);

    const id = resolveId("@fontsource/barlow/400.css", "/src/fonts.ts");

    expect(typeof id).toBe("string");
    expect(load(id)).toBe("");
  });

  it("keeps a matching stylesheet a stylesheet, so Vite's CSS pipeline handles it", () => {
    const { resolveId } = hooksOf(/^@fontsource\//);

    expect(resolveId("@fontsource/barlow/400.css", "/src/fonts.ts")).toMatch(/\.css$/);
  });

  it("leaves every other import and module alone", () => {
    const { resolveId, load } = hooksOf(/^@fontsource\//);

    expect(resolveId("react", "/src/main.tsx")).toBeNull();
    expect(resolveId("./theme.css", "/src/main.tsx")).toBeNull();
    expect(load("/src/theme.css")).toBeNull();
  });
});
