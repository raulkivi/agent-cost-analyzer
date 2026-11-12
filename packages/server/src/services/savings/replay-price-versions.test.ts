// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { SessionReplay } from "@agent-cost-analyzer/domain";
import { BundledPriceBookSource } from "../pricing/bundled-price-book-source.js";
import { PriceBook } from "../pricing/price-book.js";
import { replayPriceVersions } from "./replay-price-versions.js";

// Phase 16 SR10 (docs/plans/savings-report.md §7): a Simulated saving shows
// the price versions its replay used. The replay names its channel, model and
// date; the price book says which version was in force.

const versionsOf = replayPriceVersions(new PriceBook(new BundledPriceBookSource()));

type ReplayFields = Pick<SessionReplay, "model" | "vendorId" | "pricing">;

function replay(model: string, channel: "api" | "copilot" | null, asOf = "2026-10-15", vendorId = "anthropic"): ReplayFields {
  return {
    model,
    vendorId,
    pricing: { ...(channel === null ? { channel: null, reason: "No channel is known." } : { channel }), asOf, requested: "session-channel" },
  };
}

describe("replayPriceVersions", () => {
  it("names the vendor API's version in force on the replay's date", () => {
    expect(versionsOf(replay("claude-haiku-5.5", "api"))).toEqual(["anthropic-api:claude-haiku-5.5:2026-10-07"]);
  });

  it("names Copilot's version for a replay priced on Copilot's price table", () => {
    expect(versionsOf(replay("claude-haiku-5.5", "copilot"))).toEqual(["github-copilot:claude-haiku-5.5:2026-10-07"]);
  });

  it("takes the version in force on the replay's date, not the newest", () => {
    expect(versionsOf(replay("claude-sonnet-5.5", "api", "2026-10-03"))).toEqual(["anthropic-api:claude-sonnet-5.5:2026-10-01"]);
  });

  it("finds the book's spelling of a model id", () => {
    expect(versionsOf(replay("Claude-Haiku-5.5", "api"))).toEqual(["anthropic-api:claude-haiku-5.5:2026-10-07"]);
  });

  it("names none when the replay had no price channel", () => {
    expect(versionsOf(replay("claude-haiku-5.5", null))).toEqual([]);
  });

  it("names none when the vendor lists no API channel", () => {
    expect(versionsOf(replay("claude-haiku-5.5", "api", "2026-10-15", "no-such-vendor"))).toEqual([]);
  });

  it("names none when no version was in force on the replay's date", () => {
    expect(versionsOf(replay("claude-haiku-5.5", "api", "2026-09-01"))).toEqual([]);
  });
});
