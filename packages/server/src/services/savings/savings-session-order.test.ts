// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { sessionsByContribution } from "./savings-session-order.js";

const ref = (sessionId: string) => ({ providerId: "p", sessionId });
const ids = (entries: { ref: ReturnType<typeof ref>; high: number | undefined }[]) => sessionsByContribution(entries).map((entry) => entry.sessionId);

describe("sessionsByContribution", () => {
  it("puts the largest contribution first", () => {
    expect(ids([{ ref: ref("a"), high: 1 }, { ref: ref("b"), high: 5 }, { ref: ref("c"), high: 3 }])).toEqual(["b", "c", "a"]);
  });

  it("keeps the given order for equal figures and puts unpriced sessions last", () => {
    expect(ids([{ ref: ref("a"), high: undefined }, { ref: ref("b"), high: 2 }, { ref: ref("c"), high: 2 }, { ref: ref("d"), high: undefined }])).toEqual(["b", "c", "a", "d"]);
  });
});
