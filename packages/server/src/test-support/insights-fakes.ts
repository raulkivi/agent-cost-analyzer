import { unavailableTokenCount, type Session, type ToolCallRecord, type Turn, type TurnUsage } from "@agent-cost-analyzer/domain";
import { parseShellCommand } from "../services/tool-audit/shell-command-parser.js";
import type { ProviderSessions } from "../services/insights/insights-dataset-builder.js";

// In-memory Sessions for insights tests: each test states its own data.
const known = (value: number) => ({ known: true as const, value });

export function usage(overrides: Partial<Record<"uncached" | "write" | "read" | "output" | "credits", number | null>> = {}): TurnUsage {
  const figure = (value: number | null | undefined, fallback: number) =>
    value === null ? unavailableTokenCount("not recorded") : known(value ?? fallback);
  return {
    uncachedInput: figure(overrides.uncached, 100),
    cacheWrite: figure(overrides.write, 0),
    cacheRead: figure(overrides.read, 0),
    tool: unavailableTokenCount("n/a"),
    vision: unavailableTokenCount("n/a"),
    reasoning: unavailableTokenCount("n/a"),
    output: figure(overrides.output, 10),
    costAiCredits: figure(overrides.credits, 1),
    model: "m",
  };
}

export function bash(command: string, status: "success" | "error" | "denied" = "success", startedAt?: string): ToolCallRecord {
  return {
    name: "Bash",
    kind: "shell",
    argsSummary: command,
    shell: { command, program: parseShellCommand(command).program },
    outcome: { status },
    ...(startedAt ? { startedAt } : {}),
  };
}

export function turn(index: number, toolCalls: ToolCallRecord[] = [], turnUsage: TurnUsage = usage()): Turn {
  return { index, userMessage: "", assistantResponse: "", toolCalls, usage: turnUsage, explanation: "" };
}

export function analyzeSession(id: string, startedAt: string | undefined, turns: Turn[], model = "m"): Session {
  return {
    id,
    mode: "analyze",
    title: `Session ${id}`,
    model,
    turns,
    turnCount: turns.length,
    costAiCredits: unavailableTokenCount("n/a"),
    usageDataAvailable: true,
    ...(startedAt ? { startedAt } : {}),
  };
}

export function providerSessions(sessions: Session[], providerId = "fake", providerLabel = "Fake"): ProviderSessions {
  return { providerId, providerLabel, sessions };
}
