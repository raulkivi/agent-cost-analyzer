// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { assertScene } from "../scene-timeline.mts";
import { DESKTOP_SCENES, sceneTemplates } from "./desktop-scenes.mts";

const M1 = DESKTOP_SCENES.M1;

describe("M1", () => {
  it("is a valid scene", () => {
    expect(() => assertScene(M1)).not.toThrow();
  });
  it("sends the prompt before the recording starts (D17)", () => {
    const kinds = M1.steps.map((s) => s.action.kind);
    expect(kinds.indexOf("prompt")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("startRecording")).toBeGreaterThan(kinds.indexOf("prompt"));
    expect(kinds.filter((k) => k === "startRecording")).toHaveLength(1);
  });
  it("types nothing after the recording starts", () => {
    const start = M1.steps.findIndex((s) => s.action.kind === "startRecording");
    expect(M1.steps.slice(start).some((s) => s.action.kind === "prompt")).toBe(false);
  });
  it("asks the October question", () => {
    const prompt = M1.steps.find((s) => s.action.kind === "prompt")?.action;
    expect(prompt).toMatchObject({ text: "What did my coding agents cost in October?" });
  });
  it("never clicks fullscreen (D18)", () => {
    expect(sceneTemplates(M1)).not.toContain("fullscreen");
    expect(M1.steps.some((s) => /fullscreen/i.test(s.label))).toBe(false);
  });
  it("opens the side pane through the host's expand icon", () => {
    expect(sceneTemplates(M1)).toContain("expand");
  });
});

describe("sceneTemplates", () => {
  it("lists each template once, in first-use order", () => {
    expect(
      sceneTemplates({
        id: "M9",
        slug: "x",
        title: "x",
        steps: [
          { label: "a", action: { kind: "click", template: "b" }, beatMs: 0 },
          { label: "b", action: { kind: "waitFor", template: "a" }, beatMs: 0 },
          { label: "c", action: { kind: "click", template: "b" }, beatMs: 0 },
        ],
      }),
    ).toEqual(["b", "a"]);
  });
});
