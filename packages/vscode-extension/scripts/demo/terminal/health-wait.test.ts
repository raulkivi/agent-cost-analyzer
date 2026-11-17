// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { waitForHealth } from "./health-wait.mts";

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
}
const o = { timeoutMs: 1000, intervalMs: 100 };

describe("waitForHealth", () => {
  it("polls GET /api/health on the port until it answers ok", async () => {
    const urls: string[] = [];
    let n = 0;
    const get = async (url: string) => {
      urls.push(url);
      if (++n < 3) throw new Error("ECONNREFUSED");
      return { ok: true };
    };
    await waitForHealth(5199, get, o, fakeClock());
    expect(urls).toEqual(Array(3).fill("http://127.0.0.1:5199/api/health"));
  });
  it("treats a non-ok answer as not ready", async () => {
    let n = 0;
    await waitForHealth(5199, async () => ({ ok: ++n > 1 }), o, fakeClock());
    expect(n).toBe(2);
  });
  it("names the port when it never answers", async () => {
    await expect(waitForHealth(5199, async () => ({ ok: false }), o, fakeClock())).rejects.toThrow(/5199.*1000 ms/);
  });
});
