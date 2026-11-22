// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  computeMonthlyAllowance,
  monthlyAllowanceAnswerSchema,
  periodOf,
  type AllowanceSettings,
  type AllowanceSettingsWrite,
  type AllowanceState,
  type CopilotHarness,
  type MonthlyAllowanceAnswer,
  type MonthlyAllowanceFigures,
  type Session,
} from "@agent-cost-analyzer/domain";
import type { AllowanceSettingsStore } from "./allowance-settings-store.js";

// The monthly AI Credits allowance answer (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance-standalone.md
// §4.4 to §4.6): the VS Code Copilot sessions, whatever provider is active,
// against the user's settings. The figures come from the domain's
// computeMonthlyAllowance, the one computation the extension shares.

export const NO_COPILOT_LOGS_REASON = "No Copilot Chat logs found on this machine";

// The slice of the VS Code provider this reads (DIP): tests pass a fake,
// composition passes registry.getProvider("vscode").
export interface CopilotSessionSource {
  checkAvailability(): Promise<{ available: boolean; unavailableReason?: string }>;
  listSessions(): Promise<Session[]>;
}

export type CopilotVariant = "VS Code" | "VS Code Insiders";

export interface MonthlyAllowanceQueries {
  get(): Promise<MonthlyAllowanceAnswer>;
  // The settings are already validated (allowanceSettingsWriteSchema).
  save(settings: AllowanceSettingsWrite): Promise<MonthlyAllowanceAnswer>;
}

export interface MonthlyAllowanceDeps {
  settings: AllowanceSettingsStore;
  copilot: CopilotSessionSource;
  now: () => Date;
  timeZone: string;
  // A fixed label for the VS Code variant the app reads, never its path.
  variant: CopilotVariant | null;
}

// The variant named by the resolved user-data root ("Code - Insiders" or
// "Code"); any other folder name has no label.
export function variantOfUserDataDir(userDataDir: string | null): CopilotVariant | null {
  if (userDataDir === null) return null;
  const name = userDataDir.split(/[\\/]/).filter(Boolean).pop();
  if (name === "Code - Insiders") return "VS Code Insiders";
  return name === "Code" ? "VS Code" : null;
}

// Display order of the split; a session with no harness is a classic one.
const HARNESSES: readonly CopilotHarness[] = ["local", "agent-host"];

type Shown = MonthlyAllowanceFigures;

export class MonthlyAllowanceService implements MonthlyAllowanceQueries {
  constructor(private readonly deps: MonthlyAllowanceDeps) {}

  async get(): Promise<MonthlyAllowanceAnswer> {
    return this.answer(this.deps.settings.read());
  }

  async save(settings: AllowanceSettingsWrite): Promise<MonthlyAllowanceAnswer> {
    this.deps.settings.write(settings);
    return this.get();
  }

  private async answer(settings: AllowanceSettings): Promise<MonthlyAllowanceAnswer> {
    const { now, timeZone, variant, copilot } = this.deps;
    const at = now();
    const period = periodOf(at, timeZone, settings.resetDay);
    const availability = await copilot.checkAvailability();
    const source = {
      providerId: "vscode" as const,
      available: availability.available,
      ...(availability.available ? {} : { reason: availability.unavailableReason || NO_COPILOT_LOGS_REASON }),
      variant,
      byHarness: [] as { harness: CopilotHarness; known: number; total: number; used: number | null }[],
    };
    const base = {
      settings,
      period: { ...period, timeZone },
      asOf: at.toISOString(),
    };
    const done = (state: AllowanceState, figures?: object) => monthlyAllowanceAnswerSchema.parse({ ...base, state, ...(figures ? { figures } : {}), source });

    if (settings.aiCredits === null) return done("not-set");
    if (!availability.available) return done("no-source");

    const sessions = await copilot.listSessions();
    const input = { now: at, timeZone, settings };
    const overall = shown(computeMonthlyAllowance({ ...input, sessions }));
    for (const harness of HARNESSES) {
      const part = shown(computeMonthlyAllowance({ ...input, sessions: sessions.filter((s) => (s.copilotHarness ?? "local") === harness) }));
      if (part.coverage.total > 0) source.byHarness.push({ harness, known: part.coverage.known, total: part.coverage.total, used: part.used });
    }

    const { coverage, countedSinceKey } = overall;
    if (coverage.total === 0) return done("no-sessions", { coverage });
    if (overall.used === null) return done("unknown", { coverage, countedSinceKey });
    const { level, used, atLeast, percent, remaining } = overall;
    return done("known", { level, used, atLeast, percent, remaining, coverage, countedSinceKey });
  }
}

// The settings are usable here, so the gauge is never hidden.
function shown(result: ReturnType<typeof computeMonthlyAllowance>): Shown {
  if (result.level === "hidden") throw new Error("the allowance is set, so its figures are shown");
  return result;
}
