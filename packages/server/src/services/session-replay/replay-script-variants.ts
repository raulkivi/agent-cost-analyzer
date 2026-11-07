// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ScenarioScript } from "@agent-cost-analyzer/domain";

// Phase 14 step 14.4: on a target model the whole session runs on that one
// model (plan assumptions A1 and A5: same conversation, same harness, only
// the model changes), so the session's own model switches are dropped. The
// self-check keeps them: it replays the session on the models it really used.
export function withoutModelSwitches(script: ScenarioScript): ScenarioScript {
  return {
    ...script,
    steps: script.steps.map((step) => ({
      ...step,
      events: step.events.filter((event) => event.type !== "model-switch"),
    })),
  };
}
