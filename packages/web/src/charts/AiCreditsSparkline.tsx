import { scaleLinear } from "d3-scale";
import { line as d3Line } from "d3-shape";
import type { Turn } from "@copilot-cost-analyzer/domain";
import { ViewAsTable } from "./ViewAsTable.js";

const WIDTH = 200;
const HEIGHT = 30;
const PADDING = 2;

interface AiCreditsSparklineProps {
  turns: Turn[];
}

// The sparkline with its "View as table" switch: every turn's credits as
// the sparkline's own figures (2 decimals), unknown turns as "unknown".
export function AiCreditsSparkline({ turns }: AiCreditsSparklineProps) {
  const table = {
    caption: "AI Credits per turn",
    rowHeader: "Turn",
    columns: ["AI Credits"],
    rows: turns.map((turn) => ({
      key: String(turn.index),
      header: String(turn.index),
      cells: [turn.usage.costAiCredits.known ? turn.usage.costAiCredits.value.toFixed(2) : null],
    })),
  };
  return (
    <ViewAsTable table={table}>
      <Sparkline turns={turns} />
    </ViewAsTable>
  );
}

function Sparkline({ turns }: AiCreditsSparklineProps) {
  const knownPoints = turns.flatMap((turn, index) =>
    turn.usage.costAiCredits.known ? [{ index, aiCredits: turn.usage.costAiCredits.value }] : [],
  );

  if (knownPoints.length < 2) {
    return (
      <svg role="img" aria-label="AI Credits sparkline: not enough data" width={WIDTH} height={HEIGHT}>
        <text data-testid="ai-credits-sparkline-empty" x={PADDING} y={HEIGHT / 2}>
          not enough credit data
        </text>
      </svg>
    );
  }

  const xScale = scaleLinear().domain([0, turns.length - 1]).range([PADDING, WIDTH - PADDING]);
  const maxAiCredits = Math.max(...knownPoints.map((point) => point.aiCredits));
  const yScale = scaleLinear()
    .domain([0, maxAiCredits || 1])
    .range([HEIGHT - PADDING, PADDING]);
  const path = d3Line<{ index: number; aiCredits: number }>()
    .x((point) => xScale(point.index))
    .y((point) => yScale(point.aiCredits))(knownPoints);

  return (
    <svg role="img" aria-label="AI Credits sparkline" width={WIDTH} height={HEIGHT}>
      <path data-testid="ai-credits-sparkline-path" d={path ?? ""} fill="none" stroke="#4a7" strokeWidth={1.5} />
    </svg>
  );
}
