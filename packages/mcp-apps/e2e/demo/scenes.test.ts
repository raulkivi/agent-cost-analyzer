// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { assertScene } from "../../../vscode-extension/scripts/demo/scene-timeline.mts";
import { DEMO_MAX_SECONDS, estimatedSeconds, F1, F2, F3, F4, type DemoContext } from "./scenes.js";

const context = { host: {}, view: {}, session: { sessionId: "s", provider: "claude-code" } } as unknown as DemoContext;
const scenes = [F1(context), F2(context), F3(context), F4(context)];

describe("the F scenes", () => {
  it("are F1 to F4 with valid, distinct slugs", () => {
    expect(scenes.map((scene) => scene.id)).toEqual(["F1", "F2", "F3", "F4"]);
    expect(new Set(scenes.map((scene) => scene.slug)).size).toBe(4);
    for (const scene of scenes) assertScene(scene);
  });

  it("fit the 20 s budget with the pointer's glide counted", () => {
    for (const scene of scenes) expect(estimatedSeconds(scene), scene.id).toBeLessThanOrEqual(DEMO_MAX_SECONDS - 2);
  });

  it("F4 runs 14 to 16 s, as docs/plans/demo-recordings-1.0.md §3.2 plans", () => {
    const seconds = estimatedSeconds(scenes[3]!);
    expect(seconds).toBeGreaterThanOrEqual(14);
    expect(seconds).toBeLessThanOrEqual(16);
  });

  it("label every step", () => {
    for (const scene of scenes) expect(scene.steps.every((step) => step.label.length > 0)).toBe(true);
  });
});
