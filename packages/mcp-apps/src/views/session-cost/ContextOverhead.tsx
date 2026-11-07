import type { ContextOverheadView } from "../../view-models/index.js";

// The context-overhead bar: the system prompt split into the components the
// log names. Segments are sized by their known counts; an unknown component
// has no segment and reads "Unknown" in the legend (constraint 6).

const SHADES = ["var(--brand-accent-strong)", "var(--brand-accent)", "var(--color-accent-100)", "var(--color-text-secondary)"];

export function ContextOverhead({ overhead }: { overhead: ContextOverheadView }) {
  const { systemPrompt } = overhead;
  if (systemPrompt === undefined) {
    return (
      <p className="text-muted">
        {overhead.unavailableReason ?? "Not recorded."}
        {overhead.unusedToolsText !== undefined && <> · {overhead.unusedToolsText}</>}
      </p>
    );
  }

  const total = systemPrompt.value;
  const known = systemPrompt.components.filter((component) => component.value !== null && component.value > 0);
  const knownSum = known.reduce((sum, component) => sum + (component.value ?? 0), 0);
  const rest = total === null ? 0 : Math.max(0, total - knownSum);
  const segments = [
    ...known.map((component) => ({ label: component.label, value: component.value ?? 0 })),
    ...(rest > 0 ? [{ label: "Other", value: rest }] : []),
  ];
  const span = total !== null && total > 0 ? Math.max(total, knownSum) : knownSum;
  const description = `System prompt ${systemPrompt.tokens.text}: ${systemPrompt.components.map((component) => `${component.label} ${component.tokens.text}`).join(", ")}`;

  return (
    <>
      {span > 0 && (
        <div className="view-stack" role="img" aria-label={description}>
          {segments.map((segment, index) => (
            <span key={segment.label} style={{ width: `${(segment.value / span) * 100}%`, background: SHADES[index % SHADES.length] }} />
          ))}
        </div>
      )}
      <div className="view-legend">
        <span>System prompt {systemPrompt.tokens.text}</span>
        {systemPrompt.components.map((component) => (
          <span key={component.label}>{component.label} {component.tokens.text}</span>
        ))}
        {overhead.unusedToolsText !== undefined && <span>{overhead.unusedToolsText}</span>}
      </div>
    </>
  );
}
