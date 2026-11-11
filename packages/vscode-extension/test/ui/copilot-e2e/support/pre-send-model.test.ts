// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { preSendModelCheck, preSendSessionCheck, shownModelOf } from "./pre-send-model.mts";

describe("preSendSessionCheck (VS Code 1.146: the harness and the agent the chat will run in)", () => {
  const LOCAL_IN_AGENT = ["Add Context... (Ctrl+/)", "aica-e2e", "Models, Claude Haiku 5.5", "Local", "Permission picker, Default permissions"];

  it("sends from VS Code's local harness in the test agent", () => {
    expect(preSendSessionCheck(LOCAL_IN_AGENT, "aica-e2e")).toEqual({ send: true });
  });

  it("refuses the Copilot SDK harness (no Local session target), whose model the suite doesn't pick", () => {
    const decision = preSendSessionCheck(["aica-e2e", "Models, Claude Haiku 5.5", "Copilot"], "aica-e2e");

    expect(decision).toEqual({ send: false, reason: expect.stringContaining("Local") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("nothing was sent") });
  });

  it("refuses plain Agent mode: the test agent's tool list (D6) didn't load", () => {
    expect(preSendSessionCheck(["Agent", "Models, Claude Haiku 5.5", "Local"], "aica-e2e")).toEqual({ send: false, reason: expect.stringContaining("aica-e2e") });
  });
});

describe("shownModelOf (the chat input's model picker)", () => {
  it("reads the model name from the picker's accessible name, as VS Code 1.146 renders it", () => {
    expect(shownModelOf(["Agent", "Models, Claude Haiku 5.5", "Claude Haiku 5.5 details, Effort Level: Medium, Context Size: 100K"])).toBe("Claude Haiku 5.5");
  });

  it("is undefined when no picker is shown", () => {
    expect(shownModelOf(["Agent", "Session status"])).toBeUndefined();
    expect(shownModelOf([])).toBeUndefined();
  });

  it("reads Auto like any other model, so Auto is refused rather than sent", () => {
    expect(shownModelOf(["Models, Auto"])).toBe("Auto");
  });
});

describe("preSendModelCheck (a wrong model costs nothing)", () => {
  const requested = { id: "claude-haiku-5.5", name: "Claude Haiku 5.5" };

  it("sends when the picker shows the requested model's name", () => {
    expect(preSendModelCheck({ requested, shown: "Claude Haiku 5.5" })).toEqual({ send: true });
  });

  it("sends when the picker shows the requested id in another spelling", () => {
    expect(preSendModelCheck({ requested: { id: "claude-haiku-5.5" }, shown: "Claude Haiku 5.5" })).toEqual({ send: true });
  });

  it("refuses another model, naming the model shown and saying nothing was sent", () => {
    const decision = preSendModelCheck({ requested, shown: "Claude Fable 5" });

    expect(decision.send).toBe(false);
    expect(decision).toMatchObject({ reason: expect.stringContaining('"Claude Fable 5"') });
    expect(decision).toMatchObject({ reason: expect.stringContaining("claude-haiku-5.5") });
    expect(decision).toMatchObject({ reason: expect.stringContaining("nothing was sent") });
  });

  it("refuses a variant whose name only contains the requested one (a fast or preview line costs differently)", () => {
    expect(preSendModelCheck({ requested, shown: "Claude Haiku 5.5 (fast mode)" }).send).toBe(false);
  });

  it("refuses Auto: it routes to whichever model Copilot picks", () => {
    expect(preSendModelCheck({ requested, shown: "Auto" }).send).toBe(false);
  });

  it("refuses when no model is shown, saying so", () => {
    expect(preSendModelCheck({ requested, shown: undefined })).toEqual({ send: false, reason: expect.stringContaining("showed no model") });
  });

  it("refuses with VS Code's own error when the model couldn't be selected", () => {
    const decision = preSendModelCheck({ requested, shown: "Claude Fable 5", selectError: "No language models found matching selector" });

    expect(decision).toEqual({ send: false, reason: expect.stringContaining("No language models found matching selector") });
  });
});
