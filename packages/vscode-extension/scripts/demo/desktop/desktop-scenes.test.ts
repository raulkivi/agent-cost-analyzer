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
  it("opens the side pane before any drill-down: the pane mounts a fresh view, losing the chat view's state", () => {
    const clicks = M1.steps.flatMap((s) => (s.action.kind === "click" ? [s.action.template] : []));
    expect(clicks[0]).toBe("expand");
  });
});

const ALL = Object.values(DESKTOP_SCENES);
const prompts: Record<string, RegExp> = {
  M2: /Customer portal.*1-6 October.*7-31 October/,
  M3: /^Show me the Customer portal project.s statement for October\.$/,
  M4: /Claude Code sessions.*analyse/i,
  M5: /risky.*October/,
  M6: /scratch.*30 October.*Haiku.*Luna/,
  M7: /ten more active days.*Mobile app/,
};
// Chromium wheel notches are not exact, so a scroll is never the only way to a click target: the target
// is within the last screenful, and the scene overshoots to the bottom of the view.
const MAX_SECONDS_AFTER_RECORDING_STARTS = 25;

describe.each(ALL)("scene $id ($slug)", (scene) => {
  it("is a valid scene", () => {
    expect(() => assertScene(scene)).not.toThrow();
  });
  it("opens a new chat and sends the prompt before the recording starts (D17)", () => {
    const kinds = scene.steps.map((s) => s.action.kind);
    expect(kinds.indexOf("newChat")).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf("prompt")).toBeGreaterThan(kinds.indexOf("newChat"));
    expect(kinds.filter((k) => k === "prompt")).toHaveLength(1);
    expect(kinds.filter((k) => k === "startRecording")).toHaveLength(1);
    expect(kinds.indexOf("startRecording")).toBeGreaterThan(kinds.indexOf("prompt"));
  });
  it("types nothing after the recording starts", () => {
    const start = scene.steps.findIndex((s) => s.action.kind === "startRecording");
    expect(scene.steps.slice(start).some((s) => s.action.kind === "prompt")).toBe(false);
  });
  it("names a period inside the fixture, never 'this week'", () => {
    const prompt = scene.steps.find((s) => s.action.kind === "prompt")!.action as { text: string };
    expect(prompt.text).not.toMatch(/this (week|month)|today|yesterday/i);
    if (scene.id !== "M7") expect(prompt.text).toMatch(/October|30 October/);
  });
  it("marks the click that opens the pane, so later clicks search the pane only", () => {
    const open = scene.steps.find((s) => s.label === "Open the host side pane")!.action;
    expect(open).toMatchObject({ kind: "click", opensPane: true });
  });
  it("types only ASCII: xdotool dropped the en dash of \"1–6 October\"", () => {
    const prompt = scene.steps.find((s) => s.action.kind === "prompt")!.action as { text: string };
    expect(prompt.text).toMatch(/^[\x20-\x7e]+$/);
  });
  it("never clicks fullscreen (D18)", () => {
    expect(sceneTemplates(scene).some((t) => /fullscreen/i.test(t))).toBe(false);
    expect(scene.steps.some((s) => /fullscreen/i.test(s.label))).toBe(false);
  });
  it("waits for the view, then for the answer, before the first click", () => {
    const kinds = scene.steps.map((s) => s.action.kind);
    const firstClick = kinds.indexOf("click");
    expect(kinds.indexOf("waitFor", kinds.indexOf("startRecording"))).toBeGreaterThan(kinds.indexOf("startRecording"));
    expect(kinds.indexOf("waitAnswerDone")).toBeLessThan(firstClick);
  });
  it("opens the side pane before any in-view click: the pane mounts a fresh view", () => {
    const clicks = scene.steps.filter((s) => s.action.kind === "click");
    expect(clicks[0]!.label).toBe("Open the host side pane");
  });
  it("lists the templates it needs, each cut or deliberately missing", () => {
    for (const t of sceneTemplates(scene)) expect(t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it("keeps the beats after the recording starts within 25 s", () => {
    const start = scene.steps.findIndex((s) => s.action.kind === "startRecording");
    const beats = scene.steps.slice(start).reduce((sum, s) => sum + s.beatMs, 0);
    expect(beats / 1000).toBeLessThanOrEqual(MAX_SECONDS_AFTER_RECORDING_STARTS);
  });
});

describe("prompts", () => {
  it.each(Object.entries(prompts))("%s asks its question", (id, pattern) => {
    const prompt = DESKTOP_SCENES[id]!.steps.find((s) => s.action.kind === "prompt")!.action as { text: string };
    expect(prompt.text).toMatch(pattern);
  });
  it("covers M1 to M7", () => {
    expect(Object.keys(DESKTOP_SCENES)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6", "M7"]);
  });
});

const order = (scene: string) => DESKTOP_SCENES[scene]!.steps.map((s) => (s.action.kind === "click" || s.action.kind === "waitFor" ? `${s.action.kind}:${s.action.template}` : s.action.kind));

describe("scene specifics", () => {
  it("M2 scrolls the pane to the bottom before it clicks Price changes, then goes Back", () => {
    const steps = order("M2");
    expect(steps.indexOf("scrollPane")).toBeLessThan(steps.indexOf("click:price-changes-button"));
    expect(steps.indexOf("click:back-to-cost-change")).toBeGreaterThan(steps.indexOf("click:price-changes-button"));
  });
  it("M4 waits for the session audit after Analyse, which sends a new model turn", () => {
    const steps = order("M4");
    const analyse = steps.indexOf("click:analyse-button");
    expect(steps.indexOf("waitFor:audit-kicker")).toBeGreaterThan(analyse);
    expect(steps.lastIndexOf("waitAnswerDone")).toBeGreaterThan(steps.indexOf("waitFor:audit-kicker"));
  });
  it("M4 sends the message Analyse put in the composer with the send button: keyboard focus stays in the view", () => {
    const steps = DESKTOP_SCENES.M4!.steps.map((s) => s.action);
    const analyse = steps.findIndex((a) => a.kind === "click" && a.template === "analyse-button");
    expect(steps[analyse + 1]).toEqual({ kind: "click", template: "composer-send" });
  });
  it.each(["M2", "M3", "M4", "M5", "M6", "M7"])("%s opens the pane of its own view, found by its kicker: Claude may show other views", (id) => {
    const open = DESKTOP_SCENES[id]!.steps.find((s) => s.label === "Open the host side pane")!.action;
    expect(open).toMatchObject({ kind: "click", template: expect.stringMatching(/-kicker$/), at: { x: 1086, dy: -54 } });
  });
  it("M5 filters before it opens an evidence", () => {
    const steps = order("M5");
    expect(steps.indexOf("click:kind-anomaly")).toBeLessThan(steps.indexOf("click:why-flagged"));
  });
  it("M6 opens the pane of the model comparison, not of the session picker Claude may show above it", () => {
    const open = DESKTOP_SCENES.M6!.steps.find((s) => s.label === "Open the host side pane")!.action;
    expect(open).toMatchObject({ kind: "click", template: "replay-kicker", at: { x: 1086, dy: -54 } });
  });
  it("M6 replays a model after the pane is open, then goes Back", () => {
    const steps = order("M6");
    const open = DESKTOP_SCENES.M6!.steps.findIndex((s) => s.label === "Open the host side pane");
    expect(steps.indexOf("click:model-haiku")).toBeGreaterThan(open);
    expect(steps.at(-1)).toBe("click:back-to-model-comparison");
  });
});

describe("scroll steps", () => {
  it("only scroll the pane after it is open", () => {
    for (const scene of ALL) {
      const kinds = scene.steps.map((s) => s.action);
      const open = scene.steps.findIndex((s) => s.label === "Open the host side pane");
      expect(open).toBeGreaterThan(0);
      kinds.forEach((a, i) => {
        if (a.kind === "scrollPane") expect(i).toBeGreaterThan(open);
      });
    }
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
