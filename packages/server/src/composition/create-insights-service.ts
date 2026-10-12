import { AnomalyDetector } from "../services/insights/anomaly-detector.js";
import { BehaviorChangeDetector } from "../services/insights/behavior-change-detector.js";
import { InsightsService, type ProviderSource } from "../services/insights/insights-service.js";
import { SecurityScanner } from "../services/insights/security-scanner.js";
import { DEFAULT_SECURITY_RULES } from "../services/insights/security-rules.js";

// One wiring of the Phase 9.11 detectors, shared by the HTTP app and the
// MCP server so both report the same findings.
export function createInsightsService(providers: ProviderSource): InsightsService {
  return new InsightsService(providers, [
    new SecurityScanner(DEFAULT_SECURITY_RULES),
    new AnomalyDetector(),
    new BehaviorChangeDetector(),
  ]);
}
