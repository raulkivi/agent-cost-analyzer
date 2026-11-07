// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { TriggeredEvent } from "@agent-cost-analyzer/domain";

export const TRIGGER_LABELS: Record<TriggeredEvent, string> = {
  "model-switch": "model switch",
  "tool-change": "tool change",
  compaction: "compaction",
  clear: "/clear",
  rewind: "/rewind",
  fork: "fork",
  "cache-expiry": "cache expiry",
  "instructions-change": "instructions change",
  "image-change": "image change",
  "reasoning-toggle": "reasoning toggle",
};
