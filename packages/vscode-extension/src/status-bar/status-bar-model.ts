import type { ConfigWarning, Session } from "@copilot-cost-analyzer/domain";
import { identityTranslate, type Translate } from "../l10n/localize.js";
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
export function buildTodayStatus(sessions: Session[], now: Date, timeZone?: string, t: Translate = identityTranslate): TodayStatus | undefined {
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
  // Whole messages for one session and several, not word suffixes.
  const coverage =
    todays.length === 1
      ? t("{0} of {1} session today has cost data", known, todays.length)
      : t("{0} of {1} sessions today have cost data", known, todays.length);
  const amount = known === 0 ? t("unknown") : total.toFixed(2);
  return {
    // The codicon stays outside the message: a translator must not see it.
    text: `$(graph) ${known === 0 ? t("AI Credits: unknown") : t("{0} AI Credits today", amount)}`,
    tooltip: coverage,
    ariaLabel: t("AI Credits today: {0}, {1}. Open analyzer.", amount, coverage),
  };
}

export interface StatusBarInput {
  sessions: Session[];
  now: Date;
  // The current config warnings; a required one takes the item over.
  warnings: ConfigWarning[];
  timeZone?: string;
  t?: Translate;
}

// A required config warning means no usable numbers, so the item says so and
// opens the Setup view; otherwise it's today's status and opens the panel.
export function buildStatusBarState({ sessions, now, warnings, timeZone, t = identityTranslate }: StatusBarInput): StatusBarState | undefined {
  const required = warnings.find((warning) => warning.severity === "required");
  if (required) {
    return {
      text: `$(warning) ${t("AI Credits: setup needed")}`,
      tooltip: `${required.message}\n${t("Click to open Setup.")}`,
      ariaLabel: t("AI Credits Analyzer needs setup. Open setup."),
      command: FOCUS_SETUP_VIEW_COMMAND,
      warning: true,
    };
  }
  const today = buildTodayStatus(sessions, now, timeZone, t);
  return today && { ...today, command: COMMAND_IDS.open, warning: false };
}
