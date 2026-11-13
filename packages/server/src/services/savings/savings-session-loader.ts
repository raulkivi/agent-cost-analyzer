// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostFigure, PromptChangeMarker, RequestTrace, Session } from "@agent-cost-analyzer/domain";
import { canReadCacheBreakTrace, canReadRequestTrace, type LogProvider } from "../../data-sources/log-providers/log-provider.js";
import type { RowAttributor } from "../insights/insights-dataset-builder.js";
import type { TurnPricer } from "../pricing/turn-cost-figures.js";
import { buildSessionAudit } from "../tool-audit/session-audit-builder.js";
import type { SavingsSessionInput } from "./savings-detector.js";

// Phase 16 SR10 (docs/plans/savings-report.md §5.2, §6): one session of the
// window as the detectors read it. Only readSession gives the tool
// inventory; the channel and priced figures come from the same attribution
// and turn pricer as the Dashboard. The priced figure (not the preferred
// one) is kept per turn: a saving names the price versions it came from.

export interface SavingsCosting {
  attributor: RowAttributor;
  turnPricer: TurnPricer;
}

type TraceFields = Pick<SavingsSessionInput, "trace" | "promptChanges" | "traceUnavailableReason">;

const NO_PROMPT_CHANGES: ReadonlyMap<number, PromptChangeMarker> = new Map();
// Fixed sentences: an error's message can hold a path, which no report shows.
const UNREADABLE_TRACE = "The session's request trace could not be read.";
const NO_SESSION_TRACE = "The provider has no request trace for this session.";
const noProviderTrace = (provider: LogProvider) => `${provider.label}'s log records no request trace, so cache breaks can't be found.`;

export class SavingsSessionLoader {
  constructor(private readonly costing: SavingsCosting) {}

  // null: the provider no longer has the session.
  async load(provider: LogProvider, sessionId: string): Promise<SavingsSessionInput | null> {
    const session = await provider.readSession(sessionId);
    if (!session) return null;
    const { attributor } = this.costing;
    return {
      providerId: provider.id,
      session,
      channel: attributor.session(provider.id, session).channel,
      ...(await this.traceOf(provider, sessionId)),
      audit: buildSessionAudit(session),
      turnCosts: this.turnCosts(provider.id, session),
    };
  }

  private async traceOf(provider: LogProvider, sessionId: string): Promise<TraceFields> {
    try {
      if (canReadCacheBreakTrace(provider)) {
        const found = await provider.readCacheBreakTrace(sessionId);
        return found ? { trace: found.trace, promptChanges: found.promptChanges } : { traceUnavailableReason: NO_SESSION_TRACE };
      }
      if (canReadRequestTrace(provider)) {
        const trace: RequestTrace | null = await provider.readRequestTrace(sessionId);
        return trace ? { trace, promptChanges: NO_PROMPT_CHANGES } : { traceUnavailableReason: NO_SESSION_TRACE };
      }
      return { traceUnavailableReason: noProviderTrace(provider) };
    } catch {
      return { traceUnavailableReason: UNREADABLE_TRACE };
    }
  }

  private turnCosts(providerId: string, session: Session): Map<number, CostFigure> {
    const { attributor, turnPricer } = this.costing;
    return new Map(session.turns.map((turn) => [turn.index, turnPricer.figuresFor(providerId, session, turn, attributor.turn(providerId, session, turn)).priced]));
  }
}
