// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { apiMethodResultSchemas, type PricingMode, type SavingsReport } from "@agent-cost-analyzer/domain";
import { getApiTransport } from "./current-transport.js";

// Phase 16 SR14 (docs/plans/savings-report.md §5.3): the savings report
// (GET /api/savings, or the webview RPC method getSavingsReport). Answers are
// parsed, so a backend that drifts from the domain shapes fails loudly here
// rather than rendering wrong figures. 400 (bad query, unknown provider) and
// 404 (not in this product) reach the caller as the transport's error.

export interface SavingsQuery {
  since?: string;
  until?: string;
  provider?: string;
  pricing?: PricingMode;
  includeSimulated?: boolean;
}

export async function fetchSavingsReport(query: SavingsQuery, signal?: AbortSignal): Promise<SavingsReport> {
  const answer = await getApiTransport().call("getSavingsReport", query, signal);
  return apiMethodResultSchemas.getSavingsReport.parse(answer);
}
