// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { replay, replayComparison } from "../../view-models/increment3-fixtures.js";
import { parseReplay, parseSessionReplay } from "./parse-replay.js";

describe("parseReplay", () => {
  it("accepts a replay_session result and a compare_models_for_session result", () => {
    expect(parseReplay(replay())).toMatchObject({ model: "claude-sonnet-5.5" });
    expect(parseReplay(replayComparison())).toMatchObject({ entries: expect.any(Array) });
  });

  it.each([undefined, null, "text", 3, {}, { sessionId: "s1" }, { ...replay(), turns: "x" }, { ...replay(), totals: null }, { ...replayComparison(), entries: undefined }, { ...replayComparison(), measured: null }])("refuses %j", (value) => {
    expect(parseReplay(value)).toBeUndefined();
  });

  it("parseSessionReplay takes only a single-model replay, for the drill-down", () => {
    expect(parseSessionReplay(replay())?.sessionId).toBe("s1");
    expect(parseSessionReplay(replayComparison())).toBeUndefined();
    expect(parseSessionReplay({ ...replay(), turns: undefined })).toBeUndefined();
  });
});
