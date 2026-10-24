import type { ConfigWarning, Session } from "@copilot-cost-analyzer/domain";
import { COMMAND_IDS, FOCUS_SETUP_VIEW_COMMAND } from "../commands/command-ids.js";
import { dayKeyOf } from "../time/local-time.js";

// What the status-bar item shows (vscode-extension.md D10, step 10.6). Pure
// and free of `vscode`: vscode/vscode-status-bar.ts applies it to the item.
export interface TodayStatus {
  // May start with a codicon, e.g. "$(graph)".
  text: string;
  tooltip: string;
  // The full meaning, for screen readers.
  ariaLabel: string;
}

export interface StatusBarState extends TodayStatus {
  // Run when the item is clicked.
  command: string;
  // Shown with the warning background: the icon and text carry the meaning
  // already, the colour only adds to it.
  warning: boolean;
}

function sessionStartedOn(session: Session, dayKey: string, timeZone: string | undefined): boolean {
  if (session.startedAt === undefined) {
    return false;
  }
  const start = Date.parse(session.startedAt);
  return !Number.isNaN(start) && dayKeyOf(new Date(start), timeZone) === dayKey;
}

// Today's AI Credits: only known costs are summed (an unknown one is never a
// 0), and the tooltip says how many sessions that covers. Hidden (undefined)
// when no session started today.
export function buildTodayStatus(sessions: Session[], now: Date, timeZone?: string): TodayStatus | undefined {
  const today = dayKeyOf(now, timeZone);
  const todays = sessions.filter((session) => sessionStartedOn(session, today, timeZone));
  if (todays.length === 0) {
    return undefined;
  }
  let known = 0;
  let total = 0;
  for (const session of todays) {
    if (session.costAiCredits.known) {
      known += 1;
      total += session.costAiCredits.value;
    }
  }
  const single = todays.length === 1;
  const coverage = `${known} of ${todays.length} ${single ? "session" : "sessions"} today ${single ? "has" : "have"} cost data`;
  const amount = known === 0 ? "unknown" : total.toFixed(2);
  return {
    text: known === 0 ? "$(graph) AI Credits: unknown" : `$(graph) ${amount} AI Credits today`,
    tooltip: coverage,
    ariaLabel: `AI Credits today: ${amount}, ${coverage}. Open analyzer.`,
  };
}

export interface StatusBarInput {
  sessions: Session[];
  now: Date;
  // The current config warnings; a required one takes the item over.
  warnings: ConfigWarning[];
  timeZone?: string;
}

// A required config warning means no usable numbers, so the item says so and
// opens the Setup view; otherwise it's today's status and opens the panel.
export function buildStatusBarState({ sessions, now, warnings, timeZone }: StatusBarInput): StatusBarState | undefined {
  const required = warnings.find((warning) => warning.severity === "required");
  if (required) {
    return {
      text: "$(warning) AI Credits: setup needed",
      tooltip: `${required.message}\nClick to open Setup.`,
      ariaLabel: "AI Credits Analyzer needs setup. Open setup.",
      command: FOCUS_SETUP_VIEW_COMMAND,
      warning: true,
    };
  }
  const today = buildTodayStatus(sessions, now, timeZone);
  return today && { ...today, command: COMMAND_IDS.open, warning: false };
}
