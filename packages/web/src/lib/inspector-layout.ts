// The system prompt inspector's columns by its own width (step 10.11): the
// structure, the text and the description side by side only when wide; at
// medium the description moves under the other two; narrow stacks all three.
// The text column is minmax(0, 1fr) so a long line wraps or scrolls inside
// it instead of widening the page past the panel.
export type InspectorLayout = "wide" | "medium" | "narrow";

const WIDE_MIN_WIDTH = 1100;
const MEDIUM_MIN_WIDTH = 760;

export interface InspectorColumns {
  layout: InspectorLayout;
  columns: string;
  descriptionSpansRow: boolean;
}

export function inspectorLayout(width: number | undefined): InspectorColumns {
  if (!width || width >= WIDE_MIN_WIDTH) {
    return { layout: "wide", columns: "260px minmax(0, 1fr) 300px", descriptionSpansRow: false };
  }
  if (width >= MEDIUM_MIN_WIDTH) {
    return { layout: "medium", columns: "240px minmax(0, 1fr)", descriptionSpansRow: true };
  }
  return { layout: "narrow", columns: "minmax(0, 1fr)", descriptionSpansRow: true };
}
