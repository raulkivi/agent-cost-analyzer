// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  alignLogTurnsToStore,
  logTurnDigests,
  placeByStoreIndex,
  userMessageDigest,
} from "./log-turn-alignment.js";

const d = userMessageDigest;
const store = (...texts: string[]) => texts.map((text, index) => ({ index, digest: d(text) }));

describe("userMessageDigest", () => {
  it("is stable for equal text and differs for different text", () => {
    expect(d("fix the bug")).toBe(d("fix the bug"));
    expect(d("fix the bug")).not.toBe(d("fix the other bug"));
  });
});

describe("logTurnDigests", () => {
  it("lists the digest of each user_message in log order, null where it carries none", () => {
    const envelopes = [
      { type: "session_start" },
      { type: "user_message", attrs: { contentDigest: d("a") } },
      { type: "llm_request" },
      { type: "user_message" },
    ];

    expect(logTurnDigests(envelopes)).toEqual([d("a"), null]);
  });
});

describe("alignLogTurnsToStore", () => {
  it("places log turns by position when the log covers the whole store", () => {
    expect(alignLogTurnsToStore([d("a"), d("b")], store("a", "b"))).toEqual([0, 1]);
  });

  it("starts at the store turn whose text the first log turn carries when logging began mid-session", () => {
    expect(alignLogTurnsToStore([d("c"), d("d")], store("a", "b", "c", "d"))).toEqual([2, 3]);
  });

  it("continues the numbering past the store for log turns it has no row for", () => {
    expect(alignLogTurnsToStore([d("b"), d("c"), d("x")], store("a", "b", "c"))).toEqual([1, 2, 3]);
    expect(alignLogTurnsToStore([d("a"), d("x")], store("a"))).toEqual([0, 1]);
  });

  it("numbers every log turn from 0 when the store has no turns", () => {
    expect(alignLogTurnsToStore([d("a"), d("b")], [])).toEqual([0, 1]);
  });

  it("places a log that stopped early at the matching store turns", () => {
    expect(alignLogTurnsToStore([d("a"), d("b")], store("a", "b", "c"))).toEqual([0, 1]);
  });

  it("leaves every log turn unplaced when the shorter log's text matches no store turns", () => {
    expect(alignLogTurnsToStore([d("x")], store("a", "b", "c"))).toEqual([null]);
  });

  it("leaves every log turn unplaced when the text matches more than one place", () => {
    expect(alignLogTurnsToStore([d("continue")], store("a", "continue", "b", "continue"))).toEqual([null]);
    expect(alignLogTurnsToStore([d("continue")], store("continue", "continue", "continue"))).toEqual([null]);
  });

  it("trusts the position when the counts agree even though a text differs", () => {
    expect(alignLogTurnsToStore([d("a"), d("a + attachment")], store("a", "b"))).toEqual([0, 1]);
  });

  it("leaves log turns unplaced when the counts differ and the texts do not line up", () => {
    expect(alignLogTurnsToStore([d("x"), d("y"), d("z")], store("a", "b"))).toEqual([null, null, null]);
  });

  it("does not guess from a log turn without a digest", () => {
    expect(alignLogTurnsToStore([null], store("a", "b"))).toEqual([null]);
  });

  it("uses the store's own turn indices", () => {
    expect(alignLogTurnsToStore([d("b")], [{ index: 4, digest: d("a") }, { index: 7, digest: d("b") }])).toEqual([7]);
  });
});

describe("placeByStoreIndex", () => {
  it("puts each per-log-turn value at its store turn index, leaving earlier indices empty", () => {
    const placed = placeByStoreIndex(["x", "y"], [2, 3]);

    expect(placed[2]).toBe("x");
    expect(placed[3]).toBe("y");
    expect(0 in placed || 1 in placed).toBe(false);
  });

  it("drops the values of unplaced log turns", () => {
    expect(placeByStoreIndex(["x", "y"], [null, 1])).toHaveLength(2);
    expect(placeByStoreIndex(["x", "y"], [null, null])).toEqual([]);
  });
});
