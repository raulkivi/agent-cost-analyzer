import { describe, expect, it } from "vitest";
import { HoldableRequestGate } from "./request-gate.js";

describe("HoldableRequestGate (step 10.16, the hold hook for check 1.6)", () => {
  it("lets every method through while nothing is held", async () => {
    await expect(new HoldableRequestGate().waitFor("getInsights")).resolves.toBeUndefined();
  });

  it("keeps a held method waiting until released, and lets other methods through", async () => {
    const gate = new HoldableRequestGate();
    gate.hold(["getInsights"]);
    let passed = false;
    const waiting = gate.waitFor("getInsights").then(() => (passed = true));

    await gate.waitFor("getHealth");
    await Promise.resolve();
    expect(passed).toBe(false);

    gate.release();
    await waiting;
    expect(passed).toBe(true);
  });

  it("releases every waiter at once, and lets later requests through", async () => {
    const gate = new HoldableRequestGate();
    gate.hold(["getInsights"]);
    const first = gate.waitFor("getInsights");
    const second = gate.waitFor("getInsights");

    gate.release();

    await Promise.all([first, second, gate.waitFor("getInsights")]);
  });

  it("ignores a release when nothing is held", () => {
    expect(() => new HoldableRequestGate().release()).not.toThrow();
  });
});
