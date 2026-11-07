import { describe, expect, it } from "vitest";
import { isTreeRow } from "./tree-row.js";

// Step 15.14, S9's first CI run: VS Code draws a tree row's label and
// description in separate elements, so the row's innerText has them with no
// space between ("github.com/example/portal-web9.65 · 1 unknown").
describe("isTreeRow", () => {
  it("matches a row whose label and description run together, as VS Code draws them", () => {
    expect(isTreeRow("github.com/example/portal-web9.65 · 1 unknown", "github.com/example/portal-web", "9.65 · 1 unknown")).toBe(true);
  });

  it("matches a row with a space or line break between them", () => {
    expect(isTreeRow("github.com/example/portal-web 9.65 · 1 unknown", "github.com/example/portal-web", "9.65 · 1 unknown")).toBe(true);
    expect(isTreeRow("github.com/example/portal-web\n9.65 · 1 unknown", "github.com/example/portal-web", "9.65 · 1 unknown")).toBe(true);
  });

  it("does not match another description, or a row that only starts with the label", () => {
    expect(isTreeRow("github.com/example/portal-web9.66 · 1 unknown", "github.com/example/portal-web", "9.65 · 1 unknown")).toBe(false);
    expect(isTreeRow("github.com/example/portal-web-old9.65 · 1 unknown", "github.com/example/portal-web", "9.65 · 1 unknown")).toBe(false);
  });
});
