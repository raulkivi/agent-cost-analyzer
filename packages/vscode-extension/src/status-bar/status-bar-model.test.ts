import type { ConfigWarning, Session } from "@copilot-cost-analyzer/domain";
import { describe, expect, it } from "vitest";
import { upperCaseTranslate as T } from "../l10n/upper-case-translate.js";
import { buildStatusBarState, buildTodayStatus } from "./status-bar-model.js";

function session(id: string, startedAt: string | undefined, cost: number | null): Session {
  return {
    id,
    mode: "analyze",
    title: id,
    model: "claude-sonnet-5",
    turns: [],
    turnCount: 1,
    costAiCredits: cost === null ? { known: false, reason: "x" } : { known: true, value: cost },
    usageDataAvailable: true,
    startedAt,
  };
}

const NOW = new Date("2026-10-24T15:00:00Z");
const TODAY = "2026-10-24T09:00:00Z";
const YESTERDAY = "2026-10-23T09:00:00Z";

describe("buildTodayStatus", () => {
  it("is hidden when there are no sessions at all", () => {
    expect(buildTodayStatus([], NOW, "UTC")).toBeUndefined();
  });

  it("is hidden when no session started today, however many other days there are", () => {
    const sessions = [session("a", YESTERDAY, 5), session("b", undefined, 2), session("c", "garbage", 2)];

    expect(buildTodayStatus(sessions, NOW, "UTC")).toBeUndefined();
  });

  it("sums only today's known costs and names the coverage in the tooltip", () => {
    const status = buildTodayStatus(
      [
        session("a", TODAY, 4.82),
        session("b", TODAY, 3.17),
        session("c", "2026-10-24T10:00:00Z", 4.41),
        session("d", TODAY, null),
        session("older", YESTERDAY, 99),
      ],
      NOW,
      "UTC",
    );

    expect(status?.text).toBe("$(graph) 12.40 AI Credits today");
    expect(status?.tooltip).toBe("3 of 4 sessions today have cost data");
  });

  it("rounds the sum to 2 decimals", () => {
    expect(buildTodayStatus([session("a", TODAY, 1.004), session("b", TODAY, 2.003)], NOW, "UTC")?.text).toBe(
      "$(graph) 3.01 AI Credits today",
    );
  });

  it("says every session has cost data when all do, with the grammar of one session", () => {
    expect(buildTodayStatus([session("a", TODAY, 1), session("b", TODAY, 1)], NOW, "UTC")?.tooltip).toBe(
      "2 of 2 sessions today have cost data",
    );
    expect(buildTodayStatus([session("a", TODAY, 1)], NOW, "UTC")?.tooltip).toBe("1 of 1 session today has cost data");
  });

  it("says 'AI Credits: unknown' when today has sessions but none has a known cost, never 0", () => {
    const status = buildTodayStatus([session("a", TODAY, null), session("b", TODAY, null)], NOW, "UTC");

    expect(status?.text).toBe("$(graph) AI Credits: unknown");
    expect(status?.tooltip).toBe("0 of 2 sessions today have cost data");
    expect(status?.text).not.toMatch(/\b0\b/);
  });

  it("states the full meaning for screen readers", () => {
    const known = buildTodayStatus([session("a", TODAY, 4), session("b", TODAY, null)], NOW, "UTC");
    const unknown = buildTodayStatus([session("a", TODAY, null)], NOW, "UTC");

    expect(known?.ariaLabel).toBe("AI Credits today: 4.00, 1 of 2 sessions today have cost data. Open analyzer.");
    expect(unknown?.ariaLabel).toBe("AI Credits today: unknown, 0 of 1 session today has cost data. Open analyzer.");
  });

  it("judges today in the given time zone", () => {
    const lateEvening = [session("a", "2026-10-23T22:30:00Z", 3)];

    expect(buildTodayStatus(lateEvening, NOW, "Europe/Helsinki")?.text).toBe("$(graph) 3.00 AI Credits today");
    expect(buildTodayStatus(lateEvening, NOW, "UTC")).toBeUndefined();
  });
});

function warning(severity: "required" | "optional", message = "Debug logging is off."): ConfigWarning {
  return {
    code: "logging-disabled",
    severity,
    settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
    currentValue: false,
    recommendedValue: true,
    message,
    helpSteps: [],
  };
}

describe("buildStatusBarState", () => {
  it("opens the analyzer from today's status when setup is fine", () => {
    const state = buildStatusBarState({ sessions: [session("a", TODAY, 4)], now: NOW, warnings: [], timeZone: "UTC" });

    expect(state).toEqual({
      text: "$(graph) 4.00 AI Credits today",
      tooltip: "1 of 1 session today has cost data",
      ariaLabel: "AI Credits today: 4.00, 1 of 1 session today has cost data. Open analyzer.",
      command: "aiCreditsAnalyzer.open",
      warning: false,
    });
  });

  it("is hidden with no sessions today and nothing to set up", () => {
    expect(buildStatusBarState({ sessions: [], now: NOW, warnings: [], timeZone: "UTC" })).toBeUndefined();
  });

  it("shows 'setup needed' with a warning icon, and opens the Setup view, when a required warning exists", () => {
    const state = buildStatusBarState({
      sessions: [session("a", TODAY, 4)],
      now: NOW,
      warnings: [warning("optional"), warning("required", "Debug logging is off.")],
      timeZone: "UTC",
    });

    expect(state).toEqual({
      text: "$(warning) AI Credits: setup needed",
      tooltip: "Debug logging is off.\nClick to open Setup.",
      ariaLabel: "AI Credits Analyzer needs setup. Open setup.",
      command: "aiCreditsAnalyzer.setup.focus",
      warning: true,
    });
  });

  it("shows 'setup needed' even with no sessions (first run)", () => {
    const state = buildStatusBarState({ sessions: [], now: NOW, warnings: [warning("required")], timeZone: "UTC" });

    expect(state?.text).toBe("$(warning) AI Credits: setup needed");
  });

  it("ignores optional warnings", () => {
    const state = buildStatusBarState({ sessions: [session("a", TODAY, 4)], now: NOW, warnings: [warning("optional")], timeZone: "UTC" });

    expect(state?.text).toBe("$(graph) 4.00 AI Credits today");
    expect(state?.warning).toBe(false);
  });
});

describe("translation (vscode-extension.md §3.5 Localization)", () => {
  it("translates today's text, tooltip and screen-reader label, for one session and for several", () => {
    const status = buildTodayStatus([session("a", TODAY, 4), session("b", TODAY, null)], NOW, "UTC", T);
    const single = buildTodayStatus([session("a", TODAY, null)], NOW, "UTC", T);

    expect(status).toEqual({
      text: "$(graph) 4.00 AI CREDITS TODAY",
      tooltip: "1 OF 2 SESSIONS TODAY HAVE COST DATA",
      ariaLabel: "AI CREDITS TODAY: 4.00, 1 OF 2 SESSIONS TODAY HAVE COST DATA. OPEN ANALYZER.",
    });
    expect(single).toEqual({
      text: "$(graph) AI CREDITS: UNKNOWN",
      tooltip: "0 OF 1 SESSION TODAY HAS COST DATA",
      ariaLabel: "AI CREDITS TODAY: UNKNOWN, 0 OF 1 SESSION TODAY HAS COST DATA. OPEN ANALYZER.",
    });
  });

  it("translates the setup-needed state but keeps the warning's own message", () => {
    const state = buildStatusBarState({ sessions: [], now: NOW, warnings: [warning("required", "Debug logging is off.")], timeZone: "UTC", t: T });

    expect(state).toMatchObject({
      text: "$(warning) AI CREDITS: SETUP NEEDED",
      tooltip: "Debug logging is off.\nCLICK TO OPEN SETUP.",
      ariaLabel: "AI CREDITS ANALYZER NEEDS SETUP. OPEN SETUP.",
    });
  });
});
