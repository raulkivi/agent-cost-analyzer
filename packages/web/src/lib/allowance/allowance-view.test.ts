// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import {
  atLeastNearAnswer,
  knownAnswer,
  nearAnswer,
  noSessionsAnswer,
  noSourceAnswer,
  notSetAnswer,
  overAnswer,
  unknownAnswer,
} from "../../test-support/allowance-fixture.js";
import { allowanceView, settingsDialogDefaults } from "./allowance-view.js";

describe("allowanceView: known", () => {
  it("words a normal month figure-first, with no level word and a meter", () => {
    const view = allowanceView(knownAnswer());

    expect(view).toMatchObject({ state: "known", level: "normal", headerText: "312.40 of 1,000 AI Credits", narrowText: "312.40 of 1,000 AI Credits" });
    expect(view.levelWord).toBeUndefined();
    expect(view.shortLevelWord).toBeUndefined();
    expect(view.meter).toEqual({ fillPercent: 31, warnAtPercent: 80, openEnded: false, overflow: false });
  });

  it("near: level last in words; the narrow text keeps the short word 'near'", () => {
    const view = allowanceView(nearAnswer());

    expect(view.headerText).toBe("812.40 of 1,000 AI Credits · near limit");
    expect(view.narrowText).toBe("812.40 of 1,000 AI Credits · near");
    expect([view.levelWord, view.shortLevelWord, view.level]).toEqual(["near limit", "near", "near"]);
  });

  it("over: the meter is full with an overflow cap, and the word is 'over' at every width", () => {
    const view = allowanceView(overAnswer());

    expect(view.headerText).toBe("1,042.10 of 1,000 AI Credits · over");
    expect(view.narrowText).toBe("1,042.10 of 1,000 AI Credits · over");
    expect(view.meter).toEqual({ fillPercent: 100, warnAtPercent: 80, openEnded: false, overflow: true });
  });

  it("at least: says 'at least' in every text and draws an open end", () => {
    const view = allowanceView(atLeastNearAnswer());

    expect(view.headerText).toBe("at least 812.40 of 1,000 AI Credits · near limit");
    expect(view.narrowText).toBe("at least 812.40 of 1,000 AI Credits · near");
    expect(view.ariaLabel).toContain("at least 812.40");
    expect(view.detailLines).toContain("At least 81 % of the allowance used");
    expect(view.detailLines).toContain("The total may be higher: sessions without cost data are not counted.");
    expect(view.meter?.openEnded).toBe(true);
  });

  it("puts the level sentence first in the aria-label when near or over", () => {
    expect(allowanceView(nearAnswer()).ariaLabel.startsWith("Near limit. AI Credits this month: 812.40 of 1,000 allowance")).toBe(true);
    expect(allowanceView(overAnswer()).ariaLabel.startsWith("Over the allowance. ")).toBe(true);
    expect(allowanceView(knownAnswer()).ariaLabel.startsWith("AI Credits this month: 312.40 of 1,000 allowance")).toBe(true);
  });

  it("lists the period with its zone, days left, the source and what is not counted", () => {
    const view = allowanceView(nearAnswer());

    expect(view.detailLines).toEqual(
      expect.arrayContaining(["Monthly allowance: 1,000 AI Credits", "81 % of the allowance used", "Up to 187.60 AI Credits remain", "12 days left", "Period 2026-11-01 to 2026-11-30 (Europe/Tallinn)"]),
    );
    expect(view.daysLeft).toBe("12 days left");
    expect(view.sourceLabel).toBe("VS Code Insiders");
    expect(view.notCounted).toEqual([
      "Sessions whose logs Copilot already pruned.",
      "Spend made elsewhere: github.com chat, the cloud agent, other machines.",
      "A session counts wholly in the period it started in.",
      "Claude Code, pi and mitmproxy sessions record no AI Credits.",
    ]);
  });

  it("splits by harness with the approved labels, known-of-total and credits", () => {
    expect(allowanceView(knownAnswer()).byHarness).toEqual([
      { harness: "local", label: "Copilot Chat", coverage: "14 of 14", credits: "218.68" },
      { harness: "agent-host", label: "Agent Host and Copilot CLI", coverage: "6 of 6", credits: "93.72" },
    ]);
  });

  it("hides a harness with no sessions in the period (the server omits it)", () => {
    const rows = allowanceView(overAnswer()).byHarness;

    expect(rows.map((row) => row.label)).toEqual(["Copilot Chat"]);
    expect(rows[0]?.credits).toBe("1,042.10");
  });

  it("drops an empty harness row even if the server sent one", () => {
    const answer = knownAnswer();
    answer.source.byHarness.push({ harness: "agent-host", known: 0, total: 0, used: null });
    answer.source.byHarness.splice(1, 1);

    expect(allowanceView(answer).byHarness.map((row) => row.harness)).toEqual(["local"]);
  });

  it("says 'at least' on a harness row with sessions lacking cost data", () => {
    const rows = allowanceView(atLeastNearAnswer()).byHarness;

    expect(rows.every((row) => row.credits.startsWith("at least "))).toBe(true);
  });
});

describe("allowanceView: unknown, no sessions, no source", () => {
  it("unknown: words only, never '0 of', no meter, no percent", () => {
    const view = allowanceView(unknownAnswer());

    expect(view).toMatchObject({ state: "unknown", level: "normal", headerText: "AI Credits this month: unknown", narrowText: "AI Credits this month: unknown" });
    expect(view.meter).toBeUndefined();
    const everything = [view.headerText, view.narrowText, view.ariaLabel, ...view.detailLines, view.note ?? ""].join("\n");
    expect(everything).not.toMatch(/\b0 of\b(?! \d+ sessions)/);
    expect(everything).not.toMatch(/0\.00|%/);
    expect(view.note).toBe("No session this month has cost data, so no total is shown. Unknown is not 0.");
  });

  it("unknown: harness rows say 'unknown', not 0", () => {
    expect(allowanceView(unknownAnswer()).byHarness).toEqual([
      { harness: "local", label: "Copilot Chat", coverage: "0 of 6", credits: "unknown" },
      { harness: "agent-host", label: "Agent Host and Copilot CLI", coverage: "0 of 3", credits: "unknown" },
    ]);
  });

  it("no sessions: words only, no meter, no harness rows", () => {
    const view = allowanceView(noSessionsAnswer());

    expect(view).toMatchObject({ state: "no-sessions", headerText: "No sessions this month", narrowText: "No sessions this month", byHarness: [] });
    expect(view.meter).toBeUndefined();
    expect(view.ariaLabel).toBe("No sessions this month, 1,000 AI Credits allowance, 12 days left.");
    expect(view.note).toBe("No Copilot session started in this period on this machine.");
  });

  it("no source: names the missing logs, shows no figure, no source label", () => {
    const view = allowanceView(noSourceAnswer());

    expect(view).toMatchObject({ state: "no-source", headerText: "AI Credits this month: no Copilot logs", byHarness: [] });
    expect(view.meter).toBeUndefined();
    expect(view.sourceLabel).toBeUndefined();
    expect(view.note).toBe("No Copilot Chat logs found on this machine.");
    expect(view.ariaLabel).toContain("no Copilot logs");
  });
});

describe("allowanceView: not set", () => {
  it("is a muted prompt to set it: no figure, no level, no details, no meter", () => {
    const view = allowanceView(notSetAnswer());

    expect(view).toMatchObject({
      state: "not-set",
      level: "normal",
      headerText: "Set monthly allowance",
      narrowText: "Set monthly allowance",
      ariaLabel: "Set monthly allowance",
      hasDetails: false,
      detailLines: [],
      byHarness: [],
      notCounted: [],
    });
    expect(view.meter).toBeUndefined();
    expect(view.levelWord).toBeUndefined();
  });

  it("every other state has details to open", () => {
    for (const answer of [knownAnswer(), unknownAnswer(), noSessionsAnswer(), noSourceAnswer()]) {
      expect(allowanceView(answer).hasDetails).toBe(true);
    }
  });
});

describe("settingsDialogDefaults", () => {
  it("fills the fields from the settings as text", () => {
    expect(settingsDialogDefaults(knownAnswer({}, { settings: { aiCredits: 1250.5, resetDay: 15, warnAtPercent: 90 } }))).toEqual({
      aiCredits: "1250.5",
      resetDay: "15",
      warnAtPercent: "90",
    });
  });

  it("leaves the allowance empty when not set, keeping the reset day and threshold", () => {
    expect(settingsDialogDefaults(notSetAnswer())).toEqual({ aiCredits: "", resetDay: "1", warnAtPercent: "80" });
  });
});
