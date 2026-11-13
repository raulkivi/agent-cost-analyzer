// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { defaultSavingsSince } from "./savings-api.js";

describe("defaultSavingsSince", () => {
  it("is the date 30 days before now, as the Savings tab's default window", () => {
    expect(defaultSavingsSince(new Date("2026-11-06T12:00:00Z"))).toBe("2026-10-07");
  });

  it("crosses a month and a year boundary", () => {
    expect(defaultSavingsSince(new Date("2027-01-10T00:30:00Z"))).toBe("2026-12-11");
  });
});
