// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { Waterfall } from "@agent-cost-analyzer/web/charts/Waterfall";
import type { CurrencyBlock } from "../../view-models/index.js";
import "./cost-change.css";

// The web waterfall, fed the view model's native-currency steps. Its step
// type comes from the web's own helper, which converts from USD and so does
// not fit a result already in AI Credits; the steps are mapped here.
// Increases and decreases always carry their written sign (colour is never
// the only cue); cost-change.css gives them the host's danger and success.

type WebStep = Parameters<typeof Waterfall>[0]["steps"][number];

const SHORT_LABEL = { usage: "Usage", price: "Price", mix: "Mix" } as const;

// What shows as zero is no change (no colour, no sign).
function effectKind(value: number, currency: CurrencyBlock["currency"]): WebStep["kind"] {
  const shown = currency === "AI_CREDITS" ? Math.round(value * 100) / 100 : Math.abs(value) < 1e-9 ? 0 : value;
  return shown > 0 ? "increase" : shown < 0 ? "decrease" : "none";
}

export function webSteps(block: CurrencyBlock): WebStep[] {
  const steps: WebStep[] = [];
  let level = 0;
  for (const step of block.steps) {
    if (step.kind === "start" || step.kind === "end") {
      steps.push({ key: step.kind === "start" ? "a" : "b", label: step.label, kind: "total", value: step.value, from: 0, to: step.value });
      level = step.value;
    } else {
      steps.push({ key: step.kind, label: SHORT_LABEL[step.kind], kind: effectKind(step.value, block.currency), value: step.value, from: level, to: level + step.value });
      level += step.value;
    }
  }
  return steps;
}

export function CostChangeWaterfall({ block, ariaLabel }: { block: CurrencyBlock; ariaLabel: string }) {
  return (
    <div className="cv-waterfall">
      <Waterfall ariaLabel={ariaLabel} steps={webSteps(block)} unit={block.currency} />
      <div className="cv-key text-muted">
        <span>
          <i className="cv-swatch cv-swatch--total" />
          period total
        </span>
        <span>
          <i className="cv-swatch cv-swatch--increase" />
          raises cost
        </span>
        <span>
          <i className="cv-swatch cv-swatch--decrease" />
          lowers cost
        </span>
        <span>the sign is always written</span>
      </div>
    </div>
  );
}
