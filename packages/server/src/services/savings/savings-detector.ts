// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { CostFigure, PricingMode, RequestTrace, SavingsNotAnalysed, SavingsOpportunity, SavingsWindow, Session, SessionAudit } from "@agent-cost-analyzer/domain";
import type { ChannelResolution } from "../cost-attribution/channel-resolver.js";
import type { CacheRulesLookup, PromptChangeMarker } from "./cache-break-classifier.js";
import type { CounterfactualPricer } from "./counterfactual-pricer.js";

// Phase 16 SR5 (docs/plans/savings-report.md §5.2): the port every opportunity
// detector implements (open/closed: a new opportunity is a new class). A
// detector reads plain data and returns plain data; it loads nothing and
// prices through the counterfactual pricer it is given.

// One session of the window, as the service (SR10) loads it. Everything but
// the session is optional: absent means the provider's log doesn't give it,
// and the detector lists the session under Not analysed with the reason.
export interface SavingsSessionInput {
  providerId: string;
  session: Session;
  channel: ChannelResolution;
  // Request trace, or why there is none.
  trace?: RequestTrace;
  traceUnavailableReason?: string;
  // Per request index, built from allow-listed metadata only (hashes, counts).
  promptChanges?: ReadonlyMap<number, PromptChangeMarker>;
  audit?: SessionAudit;
  // Each turn's priced cost figure, by turn index: it names its price
  // versions, which a priced saving shows (the preferred figure may not).
  turnCosts?: ReadonlyMap<number, CostFigure>;
}

export interface SavingsInput {
  window: SavingsWindow;
  sessions: readonly SavingsSessionInput[];
  pricer: CounterfactualPricer;
  pricing: PricingMode;
  cacheRules: CacheRulesLookup;
}

export interface DetectorResult {
  opportunities: SavingsOpportunity[];
  notAnalysed: SavingsNotAnalysed[];
}

export interface SavingsDetector {
  detect(input: SavingsInput): DetectorResult | Promise<DetectorResult>;
}
