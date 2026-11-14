// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { Match } from "./click-point.mts";
import { createActionRunner, PANE_POINT, type ActionDeps } from "./action-runner.mts";

const hit = (x: number, y: number): Match => ({ x, y, width: 20, height: 10, score: 0.95 });

function setup(screen: (template: string, call: number) => Match | undefined) {
  const log: string[] = [];
  const calls = new Map<string, number>();
  let t = 0;
  const deps: ActionDeps = {
    input: {
      key: async (k) => void log.push(`key:${k}`),
      type: async (text) => void log.push(`type:${text}`),
      click: async (p) => void log.push(`click:${p.x},${p.y}`),
      scrollDown: async (p, clicks) => void log.push(`scroll:${p.x},${p.y},${clicks}`),
    },
    find: async (template) => {
      const n = (calls.get(template) ?? 0) + 1;
      calls.set(template, n);
      return screen(template, n);
    },
    startRecording: async () => void log.push("record"),
    clock: { now: () => t, sleep: async (ms) => void (t += ms) },
    pacing: { typeDelayMs: 60, timeoutMs: 1000, intervalMs: 100 },
  };
  return { run: createActionRunner(deps), log };
}

describe("createActionRunner", () => {
  it("opens a new chat with Ctrl+N", async () => {
    const { run, log } = setup(() => undefined);
    await run.perform({ kind: "newChat" });
    expect(log).toEqual(["key:ctrl+n"]);
  });
  it("types the prompt then presses Return", async () => {
    const { run, log } = setup(() => undefined);
    await run.perform({ kind: "prompt", text: "hello" });
    expect(log).toEqual(["type:hello", "key:Return"]);
  });
  it("clicks the centre of a template", async () => {
    const { run, log } = setup((t) => (t === "expand" ? hit(100, 50) : undefined));
    await run.perform({ kind: "click", template: "expand" });
    expect(log).toEqual(["click:110,55"]);
  });
  it("scrolls the host's side pane with the wheel", async () => {
    const { run, log } = setup(() => undefined);
    await run.perform({ kind: "scrollPane", clicks: 8 });
    expect(log).toEqual([`scroll:${PANE_POINT.x},${PANE_POINT.y},8`]);
  });
  it("waits until the stop button is gone", async () => {
    const { run } = setup((t, n) => (t === "stop" && n < 3 ? hit(1, 1) : undefined));
    await expect(run.perform({ kind: "waitAnswerDone" })).resolves.toBeUndefined();
  });
  it("clicks Always allow once, marks a retake and keeps waiting", async () => {
    const { run, log } = setup((t, n) => {
      if (t === "always-allow") return n === 2 ? hit(10, 10) : undefined;
      if (t === "row-scratch") return n >= 3 ? hit(0, 0) : undefined;
      return undefined;
    });
    await run.perform({ kind: "waitFor", template: "row-scratch" });
    expect(log).toEqual(["click:20,15"]);
    expect(run.retakeNeeded()).toBe(true);
  });
  it("does not flag a retake when no prompt appeared", async () => {
    const { run } = setup((t) => (t === "row-scratch" ? hit(0, 0) : undefined));
    await run.perform({ kind: "waitFor", template: "row-scratch" });
    expect(run.retakeNeeded()).toBe(false);
  });
  it("starts the recorder on startRecording", async () => {
    const { run, log } = setup(() => undefined);
    await run.perform({ kind: "startRecording" });
    expect(log).toEqual(["record"]);
  });
  it("times out naming the missing template", async () => {
    const { run } = setup(() => undefined);
    await expect(run.perform({ kind: "waitFor", template: "expand" })).rejects.toThrow(/expand/);
  });
  it("a beat action does nothing by itself", async () => {
    const { run, log } = setup(() => undefined);
    await run.perform({ kind: "beat" });
    expect(log).toEqual([]);
  });
});
