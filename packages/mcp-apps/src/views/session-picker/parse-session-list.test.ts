// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseSessionList } from "./parse-session-list.js";

const entry = { id: "s1", title: "A", turnCount: 3, model: "m", startedAt: "2026-11-10T14:12:00Z", repositoryKey: "local:app", projectId: null, providerId: "vscode" };

describe("parseSessionList", () => {
  it("keeps the fields the picker shows", () => {
    expect(parseSessionList({ total: 1, sessions: [entry] })).toEqual({ total: 1, sessions: [{ id: "s1", title: "A", turnCount: 3, model: "m", startedAt: "2026-11-10T14:12:00Z", repositoryKey: "local:app" }] });
  });

  it("accepts an empty list and an entry with no start or repository", () => {
    expect(parseSessionList({ total: 0, sessions: [] })).toEqual({ total: 0, sessions: [] });
    expect(parseSessionList({ total: 1, sessions: [{ id: "s1", title: "A", turnCount: 3, model: "m", repositoryKey: null }] })?.sessions[0]).toEqual({ id: "s1", title: "A", turnCount: 3, model: "m" });
  });

  it.each([undefined, null, "text", {}, { total: "1", sessions: [] }, { total: 1, sessions: "x" }, { total: 1, sessions: [{ id: "", title: "A", turnCount: 1, model: "m" }] }, { total: 1, sessions: [{ id: "s", title: 4, turnCount: 1, model: "m" }] }, { total: 1, sessions: [null] }])("rejects %j", (value) => {
    expect(parseSessionList(value)).toBeUndefined();
  });
});
