// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { estimatedTokenCount, MAX_SAVINGS_NAME_LENGTH, type SavingsAmount, type SavingsOpportunity, type ToolInventoryEntry } from "@agent-cost-analyzer/domain";
import { currencyOf, NotAnalysedLedger, perWeek, sumAmount, unknownAmount, type PricedPart } from "../savings-amounts.js";
import type { DetectorResult, SavingsDetector, SavingsInput, SavingsSessionInput } from "../savings-detector.js";

// Phase 16 SR5 (docs/plans/savings-report.md §4 O1, §6): tools (and MCP
// servers) loaded in sessions of the window and invoked in none of them. Each
// request resends the definitions, so the saving is the group's tokens ×
// requests, a range: read from cache (the likely case) to uncached. The
// tokens are a local-tokenizer estimate (D12), the grouping of a Copilot
// `mcp_` name is inferred (SR0: its tools file names no server).

const NO_INVENTORY = "The log records no tool inventory for this session.";
const AGENT_HOST = "VS Code's Agent Host records the total tool-definition tokens only, not each tool, so unused tools can't be found.";
const NO_REQUESTS = "The log records no request count for this session, so tool tokens can't be multiplied by requests.";

interface Group {
  subject: string;
  inferred: boolean;
}

// mcp__<server>__<tool>: the server is exact. mcp_<server>_<tool…>: a server
// name can itself hold `_`, so the first segment is a guess. Anything else is
// its own group.
function groupOf(toolName: string): Group {
  const exact = /^mcp__([^_](?:.*?[^_])?)__.+$/.exec(toolName);
  if (exact) return { subject: exact[1]!.slice(0, MAX_SAVINGS_NAME_LENGTH), inferred: false };
  const loose = /^mcp_([^_]+)_.+$/.exec(toolName);
  if (loose) return { subject: loose[1]!.slice(0, MAX_SAVINGS_NAME_LENGTH), inferred: true };
  return { subject: toolName.slice(0, MAX_SAVINGS_NAME_LENGTH), inferred: false };
}

// Requests of a session by model: from the request trace, else the turns'
// round counts. Null: the log gives no count.
function requestsByModel(input: SavingsSessionInput): Map<string, number> | null {
  const counts = new Map<string, number>();
  const bump = (model: string, by: number) => counts.set(model, (counts.get(model) ?? 0) + by);
  if (input.trace && input.trace.requests.length > 0) {
    input.trace.requests.forEach((request) => bump(request.model, 1));
    return counts;
  }
  for (const turn of input.session.turns) {
    if (turn.usage.roundsCount === undefined) return null;
    bump(turn.usage.model || input.session.model, turn.usage.roundsCount);
  }
  return counts.size > 0 ? counts : null;
}

const total = (counts: Map<string, number>): number => [...counts.values()].reduce((sum, count) => sum + count, 0);

interface Usable {
  input: SavingsSessionInput;
  inventory: readonly ToolInventoryEntry[];
  requests: Map<string, number>;
  channel: string;
}

interface Candidate {
  group: Group;
  names: Set<string>;
  // Where any of its tools was loaded, and whether any ran, in any session.
  loadedIn: Set<SavingsSessionInput>;
  invoked: boolean;
}

export class UnusedToolsDetector implements SavingsDetector {
  detect(input: SavingsInput): DetectorResult {
    const unusable = new NotAnalysedLedger();
    const groupFailures = new NotAnalysedLedger();
    const usable: Usable[] = [];
    const candidates = new Map<string, Candidate>();

    for (const session of input.sessions) {
      const inventory = session.session.toolInventory;
      // Ran-evidence counts from every session that has an inventory, usable or not.
      for (const entry of inventory ?? []) {
        const group = groupOf(entry.name);
        const candidate = candidates.get(group.subject) ?? { group, names: new Set(), loadedIn: new Set(), invoked: false };
        candidates.set(group.subject, candidate);
        if (entry.invokedInTurns.length > 0) candidate.invoked = true;
        if (entry.loaded) {
          candidate.names.add(entry.name);
          candidate.loadedIn.add(session);
        }
      }
      if (inventory === undefined) {
        unusable.add(session, session.session.copilotHarness === "agent-host" ? AGENT_HOST : NO_INVENTORY);
      } else if (!session.channel.known) {
        unusable.add(session, session.channel.reason);
      } else {
        const requests = requestsByModel(session);
        if (requests === null) unusable.add(session, NO_REQUESTS);
        else usable.push({ input: session, inventory, requests, channel: session.channel.channel });
      }
    }

    const opportunities: SavingsOpportunity[] = [];
    const usableOf = new Map(usable.map((entry) => [entry.input, entry]));
    for (const candidate of [...candidates.values()].sort((a, b) => a.group.subject.localeCompare(b.group.subject))) {
      if (candidate.invoked || candidate.names.size === 0) continue;
      const loaded = [...candidate.loadedIn].map((session) => usableOf.get(session)).filter((entry): entry is Usable => entry !== undefined);
      opportunities.push(...this.opportunitiesOf(candidate, loaded, input, unusable, groupFailures));
    }
    return { opportunities, notAnalysed: NotAnalysedLedger.report("unused-tools", unusable, groupFailures) };
  }

  // One opportunity per currency the group's sessions are priced in.
  private opportunitiesOf(candidate: Candidate, loaded: Usable[], input: SavingsInput, unusable: NotAnalysedLedger, groupFailures: NotAnalysedLedger): SavingsOpportunity[] {
    const byCurrency = new Map<string, Usable[]>();
    for (const entry of loaded) {
      const currency = currencyOf(entry.channel);
      byCurrency.set(currency, [...(byCurrency.get(currency) ?? []), entry]);
    }
    const result: SavingsOpportunity[] = [];
    for (const [currency, entries] of byCurrency) {
      const extra = new Map<string, Set<SavingsSessionInput>>();
      const addExtra = (reason: string, session: SavingsSessionInput) => extra.set(reason, (extra.get(reason) ?? new Set()).add(session));
      const rows: { entry: Usable; tokens: number }[] = [];
      for (const entry of entries) {
        const tokens = this.groupTokens(candidate, entry.inventory);
        if (tokens.known) rows.push({ entry, tokens: tokens.value });
        else {
          addExtra(tokens.reason, entry.input);
          groupFailures.add(entry.input, tokens.reason);
        }
      }
      if (rows.length === 0) continue;

      const parts: PricedPart[] = [];
      for (const { entry, tokens } of rows) {
        const part = this.price(input, entry, tokens, currency);
        if (part.known) parts.push(part);
        else {
          addExtra(part.reason, entry.input);
          groupFailures.add(entry.input, part.reason);
        }
      }
      const window: SavingsAmount = parts.length > 0 ? sumAmount(currency as "USD", parts, "range") : unknownAmount([...extra.keys()].sort()[0]!);
      const requests = rows.reduce((sum, { entry }) => sum + total(entry.requests), 0);
      const averageTokens = Math.round(rows.reduce((sum, row) => sum + row.tokens, 0) / rows.length);
      result.push({
        key: `unused-tools:${candidate.group.subject}:${currency}`,
        kind: "unused-tools",
        subject: candidate.group.subject,
        sessions: rows.map(({ entry }) => ({ providerId: entry.input.providerId, sessionId: entry.input.session.id })),
        evidence: { sessions: rows.length, requests, tokens: estimatedTokenCount(averageTokens), occurrences: null },
        perWeek: perWeek(window, input.window),
        perWindow: window,
        coverage: unusable.coverage(input.sessions.length, extra),
        actionParams: { group: candidate.group.subject, tools: candidate.names.size, tokens: averageTokens, sessions: rows.length, days: input.window.days },
        inferred: candidate.group.inferred,
      });
    }
    return result;
  }

  // The group's definition tokens in one session; unknown when any loaded tool's are.
  private groupTokens(candidate: Candidate, inventory: readonly ToolInventoryEntry[]): { known: true; value: number } | { known: false; reason: string } {
    let value = 0;
    for (const entry of inventory) {
      if (!entry.loaded || !candidate.names.has(entry.name)) continue;
      const tokens = entry.definitionTokens;
      if (tokens === undefined) return { known: false, reason: "The log records no definition size for these tools." };
      if (!tokens.known) return { known: false, reason: tokens.reason };
      value += tokens.value;
    }
    return { known: true, value };
  }

  // The tokens resent on every request: from cache to uncached input, per model.
  private price(input: SavingsInput, entry: Usable, tokens: number, currency: string): ({ known: true } & PricedPart) | { known: false; reason: string } {
    const parts: PricedPart[] = [];
    const at = entry.input.trace?.requests[0]?.startedAt ?? entry.input.session.startedAt;
    for (const [model, requests] of entry.requests) {
      const saving = input.pricer.saving(
        {
          model,
          channel: entry.input.channel,
          ...(at === undefined ? {} : { at }),
          tokens,
          billedAs: ["cacheRead", "uncachedInput"],
          instead: "nothing",
        },
        input.pricing,
      );
      if (!saving.known) return saving;
      if (saving.currency !== currency) return { known: false, reason: `Priced in ${saving.currency}, not ${currency}.` };
      parts.push({ low: saving.low * requests, high: saving.high * requests, priceVersionIds: saving.priceVersionIds });
    }
    return {
      known: true,
      low: parts.reduce((sum, part) => sum + part.low, 0),
      high: parts.reduce((sum, part) => sum + part.high, 0),
      priceVersionIds: [...new Set(parts.flatMap((part) => part.priceVersionIds))],
    };
  }
}
