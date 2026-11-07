// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { AnomalyDetector } from "../services/insights/anomaly-detector.js";
import { BehaviorChangeDetector } from "../services/insights/behavior-change-detector.js";
import { InsightsService, type DatasetAttribution, type ProviderSource } from "../services/insights/insights-service.js";
import { SecurityScanner } from "../services/insights/security-scanner.js";
import { DEFAULT_SECURITY_RULES } from "../services/insights/security-rules.js";
import type { TurnPricing } from "../services/pricing/turn-cost-figures.js";

// One wiring of the Phase 9.11 detectors, shared by the HTTP app and the
// MCP server so both report the same findings. Step 15.4: the attribution
// (repository, project, vendor, channel) the rows carry. Step 15.6: the
// pricer behind each row's priced cost figure.
export function createInsightsService(
  providers: ProviderSource,
  attribution?: DatasetAttribution,
  pricer?: TurnPricing,
  now?: () => Date,
): InsightsService {
  return new InsightsService(
    providers,
    [new SecurityScanner(DEFAULT_SECURITY_RULES), new AnomalyDetector(), new BehaviorChangeDetector()],
    now,
    attribution,
    pricer,
  );
}
