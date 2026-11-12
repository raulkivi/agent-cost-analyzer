// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { isLocalRepositoryKey, repositoryFolderLabel, type ConfigWarning, type Session } from "@agent-cost-analyzer/domain";
import type { RepositoryOf } from "../sidebar/sessions-by-repository-tree-model.js";
import { identityTranslate, type Translate } from "../l10n/localize.js";
import { COMMAND_IDS, FOCUS_SETUP_VIEW_COMMAND } from "../commands/command-ids.js";
import { dayKeyOf } from "../time/local-time.js";
import { knownSum, sessionStartedOn } from "./session-credits.js";

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

// Step 15.14 (plan §11.9): the repositories of the open workspace's folders
// (several in a multi-root workspace) and each session's repository.
export interface WorkspaceRepositories {
  repositoryKeys: string[];
  repositoryOf: RepositoryOf;
}

// What a person reads in the status bar: "portal-web" for a remote, a local
// repository's folder (never its path, §10.1.5).
function shortRepositoryName(key: string): string {
  return isLocalRepositoryKey(key) ? repositoryFolderLabel(key) : (key.split(/[/:]/).filter((part) => part.length > 0).at(-1) ?? key);
}

function workspaceName(keys: string[], t: Translate): string {
  const first = shortRepositoryName(keys[0]!);
  return keys.length === 1 ? first : t("{0} +{1}", first, keys.length - 1);
}

// Today's AI Credits: only known costs are summed (an unknown one is never a
// 0), and the tooltip says how many sessions that covers. Hidden (undefined)
// when no session started today. With the workspace's repositories, the
// text is theirs and the tooltip adds every repository's (board 7).
export function buildTodayStatus(
  sessions: Session[],
  now: Date,
  timeZone?: string,
  t: Translate = identityTranslate,
  workspace?: WorkspaceRepositories,
): TodayStatus | undefined {
  const today = dayKeyOf(now, timeZone);
  const todays = sessions.filter((session) => sessionStartedOn(session, today, timeZone));
  if (todays.length === 0) {
    return undefined;
  }
  const { known, total } = knownSum(todays);
  // Whole messages for one session and several, not word suffixes.
  const coverage =
    todays.length === 1
      ? t("{0} of {1} session today has cost data", known, todays.length)
      : t("{0} of {1} sessions today have cost data", known, todays.length);
  const amount = known === 0 ? t("unknown") : total.toFixed(2);
  const all: TodayStatus = {
    // The codicon stays outside the message: a translator must not see it.
    text: `$(graph) ${known === 0 ? t("AI Credits: unknown") : t("{0} AI Credits today", amount)}`,
    tooltip: coverage,
    ariaLabel: t("AI Credits today: {0}, {1}. Open analyzer.", amount, coverage),
  };
  const keys = workspace?.repositoryKeys ?? [];
  if (!workspace || keys.length === 0) {
    return all;
  }
  const name = workspaceName(keys, t);
  const inWorkspace = todays.filter((session) => {
    const repository = workspace.repositoryOf(session);
    return repository.attributed && keys.includes(repository.repository.key);
  });
  if (inWorkspace.length === 0) {
    return { ...all, tooltip: `${coverage}\n${t("{0} (this workspace): no sessions today", name)}` };
  }
  const mine = knownSum(inWorkspace);
  const mineAmount = mine.known === 0 ? t("unknown") : mine.total.toFixed(2);
  return {
    text: `$(graph) ${mine.known === 0 ? t("{0}: AI Credits unknown", name) : t("{0} {1} AI Credits today", name, mineAmount)}`,
    tooltip: [t("AI Credits today"), t("{0} (this workspace): {1}", name, mineAmount), t("All repositories: {0}", amount), coverage].join("\n"),
    ariaLabel: t("AI Credits today: {0} in {1}, {2} in all repositories, {3}. Open analyzer.", mineAmount, name, amount, coverage),
  };
}

export interface StatusBarInput {
  sessions: Session[];
  now: Date;
  // The current config warnings; a required one takes the item over.
  warnings: ConfigWarning[];
  timeZone?: string;
  t?: Translate;
  // Step 15.14: the open workspace's repositories, for the item's text.
  workspace?: WorkspaceRepositories;
}

// A required config warning means no usable numbers, so the item says so and
// opens the Setup view; otherwise it's today's status and opens the panel.
export function buildStatusBarState({ sessions, now, warnings, timeZone, t = identityTranslate, workspace }: StatusBarInput): StatusBarState | undefined {
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
  const today = buildTodayStatus(sessions, now, timeZone, t, workspace);
  return today && { ...today, command: COMMAND_IDS.open, warning: false };
}
