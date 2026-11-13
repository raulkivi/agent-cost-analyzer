// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { assertScene, playScene, totalBeatMs, type Scene } from "./scene-timeline.mts";

const scene = (over: Partial<Scene<string>> = {}): Scene<string> => ({
  id: "E1",
  slug: "first-look",
  title: "First look",
  steps: [
    { label: "a", action: "A", beatMs: 100 },
    { label: "b", action: "B", beatMs: 250 },
  ],
  ...over,
});

describe("totalBeatMs", () => {
  it("sums the beats", () => expect(totalBeatMs(scene())).toBe(350));
});

describe("playScene", () => {
  it("runs each action then sleeps its beat, in order", async () => {
    const log: string[] = [];
    await playScene(
      scene(),
      async (a) => void log.push(`run ${a}`),
      async (ms) => void log.push(`sleep ${ms}`),
    );
    expect(log).toEqual(["run A", "sleep 100", "run B", "sleep 250"]);
  });

  it("stops at a rejected action and propagates it", async () => {
    const log: string[] = [];
    await expect(
      playScene(
        scene(),
        async (a) => {
          log.push(a);
          if (a === "A") throw new Error("boom");
        },
        async () => void log.push("sleep"),
      ),
    ).rejects.toThrow("boom");
    expect(log).toEqual(["A"]);
  });
});

describe("assertScene", () => {
  it("accepts a valid scene", () => expect(() => assertScene(scene())).not.toThrow());
  it("rejects no steps", () => expect(() => assertScene(scene({ steps: [] }))).toThrow(/step/));
  it("rejects a negative beat", () => expect(() => assertScene(scene({ steps: [{ label: "x", action: "x", beatMs: -1 }] }))).toThrow(/beat/));
  it("rejects a non-finite beat", () => {
    expect(() => assertScene(scene({ steps: [{ label: "x", action: "x", beatMs: Number.NaN }] }))).toThrow(/beat/);
    expect(() => assertScene(scene({ steps: [{ label: "x", action: "x", beatMs: Infinity }] }))).toThrow(/beat/);
  });
  it("accepts a zero beat", () => expect(() => assertScene(scene({ steps: [{ label: "x", action: "x", beatMs: 0 }] }))).not.toThrow());
  it.each(["Upper", "has space", "under_score", "-lead", "trail-", "a--b", ""])("rejects slug %j", (slug) => {
    expect(() => assertScene(scene({ slug }))).toThrow(/slug/);
  });
  it.each(["x1", "E", "E1a", "e1", "E-1", ""])("rejects id %j", (id) => {
    expect(() => assertScene(scene({ id: id as Scene<string>["id"] }))).toThrow(/id/);
  });
  it.each(["E1", "W12", "M3", "F10"])("accepts id %s", (id) => {
    expect(() => assertScene(scene({ id: id as Scene<string>["id"] }))).not.toThrow();
  });
});
