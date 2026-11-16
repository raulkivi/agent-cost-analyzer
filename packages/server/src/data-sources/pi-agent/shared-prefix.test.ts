// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { PiRawEntry } from "./pi-jsonl-reader.js";
import { sharedPrefixRequests } from "./shared-prefix.js";

const entry = (id: string, role: string): PiRawEntry => ({ type: "message", id, message: { role } });
const system = entry("s", "system");
const user = (id: string) => entry(id, "user");
const assistant = (id: string) => entry(id, "assistant");

describe("sharedPrefixRequests (D27)", () => {
  const first = [system, user("u1"), assistant("a1"), user("u2"), assistant("a2")];

  it("is 0 for the first branch (no earlier branch)", () => {
    expect(sharedPrefixRequests(first, [])).toBe(0);
  });

  it("counts the assistant requests in the leading entries an earlier branch holds", () => {
    const second = [system, user("u1"), assistant("a1"), user("u3"), assistant("a3")];

    expect(sharedPrefixRequests(second, [first])).toBe(1);
  });

  it("stops at the first entry no earlier branch holds, even if a later one matches again", () => {
    const second = [system, user("u1"), assistant("x1"), assistant("a2")];

    expect(sharedPrefixRequests(second, [first])).toBe(0);
  });

  it("counts a prefix shared with any earlier branch, and ignores assistants before the first user message", () => {
    const earlierA = [system, assistant("pre"), user("u1")];
    const earlierB = [system, assistant("pre"), user("u1"), assistant("a1"), assistant("a1b")];
    const third = [system, assistant("pre"), user("u1"), assistant("a1"), assistant("a1b"), assistant("own")];

    expect(sharedPrefixRequests(third, [earlierA, earlierB])).toBe(2);
  });
});
