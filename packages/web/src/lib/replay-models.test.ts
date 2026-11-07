// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { MAX_COMPARED_MODELS } from "@agent-cost-analyzer/domain";
import { makeVendorProfile, REPLAY_PROFILES } from "../test-support/replay-fixture.js";
import { initialCompareModels, NOT_REPLAYABLE_PROVIDER_REASON, profileModelIdFor, replayUnavailableReason } from "./replay-models.js";

describe("replay models (step 14.7)", () => {
  it("finds the profile model a log's model id names, and guesses no near match", () => {
    expect(profileModelIdFor("claude-opus-5.5", REPLAY_PROFILES)).toBe("claude-opus-5.5");
    expect(profileModelIdFor("claude-opus-5-5", REPLAY_PROFILES)).toBe("claude-opus-5.5");
    expect(profileModelIdFor("copilot/claude-sonnet-5.5", REPLAY_PROFILES)).toBe("claude-sonnet-5.5");
    expect(profileModelIdFor("claude-haiku-5-5-20261001[1m]", REPLAY_PROFILES)).toBe("claude-haiku-5.5");
    expect(profileModelIdFor("claude-opus-5", REPLAY_PROFILES)).toBeUndefined();
    // A model whose caching is undocumented can't be replayed on.
    expect(profileModelIdFor("kimi-k3", REPLAY_PROFILES)).toBeUndefined();
  });

  it("D1: Claude Code and Copilot sessions can be replayed; pi and mitmproxy say why not", () => {
    expect(replayUnavailableReason("claude-code")).toBeUndefined();
    expect(replayUnavailableReason("vscode")).toBeUndefined();
    expect(replayUnavailableReason("pi")).toBe(NOT_REPLAYABLE_PROVIDER_REASON);
    expect(replayUnavailableReason("mitmproxy")).toBe(NOT_REPLAYABLE_PROVIDER_REASON);
    expect(NOT_REPLAYABLE_PROVIDER_REASON).toBe("This provider's logs can't be replayed yet.");
  });

  it("compares the replay model, the session's own and each vendor's default, deduped", () => {
    expect(initialCompareModels({ replayModel: "claude-haiku-5.5", sessionModel: "claude-opus-5-5", profiles: REPLAY_PROFILES })).toEqual([
      "claude-haiku-5.5",
      "claude-opus-5.5",
      "claude-sonnet-5.5",
      "gpt-6.1-sol",
    ]);
    expect(initialCompareModels({ replayModel: null, sessionModel: "claude-sonnet-5.5", profiles: REPLAY_PROFILES })).toEqual(["claude-sonnet-5.5", "gpt-6.1-sol"]);
  });

  it("keeps to the 10-model cap, leaving room for an own model the server adds itself", () => {
    const many = Array.from({ length: 12 }, (_, index) => makeVendorProfile(`v${index}`, `V${index}`, [[`m-${index}`, true]]));
    expect(initialCompareModels({ replayModel: null, sessionModel: "m-0", profiles: many })).toHaveLength(MAX_COMPARED_MODELS);
    expect(initialCompareModels({ replayModel: null, sessionModel: "unknown-model", profiles: many })).toHaveLength(MAX_COMPARED_MODELS - 1);
  });
});
