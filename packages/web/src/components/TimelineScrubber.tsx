import { useId } from "react";
import { Blueprint } from "./ui/Blueprint.js";

interface TimelineScrubberProps {
  turnCount: number;
  selectedTurnIndex: number;
  onSelectTurn: (turnIndex: number) => void;
}

export function TimelineScrubber({ turnCount, selectedTurnIndex, onSelectTurn }: TimelineScrubberProps) {
  const labelId = useId();
  const position = `Turn ${Math.min(selectedTurnIndex + 1, turnCount)} of ${turnCount}`;
  return (
    <Blueprint style={{ padding: "var(--space-3)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-2)",
        }}
      >
        <div
          id={labelId}
          style={{
            fontSize: 12,
            color: "var(--color-text-muted)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Timeline
        </div>
        <div style={{ fontSize: 12 }}>{position}</div>
      </div>
      <input
        type="range"
        role="slider"
        aria-labelledby={labelId}
        aria-valuetext={position}
        min={0}
        max={Math.max(turnCount - 1, 0)}
        value={selectedTurnIndex}
        onChange={(event) => onSelectTurn(Number(event.target.value))}
        style={{ width: "100%", accentColor: "var(--color-accent)" }}
      />
    </Blueprint>
  );
}
