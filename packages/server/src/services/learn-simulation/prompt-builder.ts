import type { Layer } from "@agent-cost-analyzer/domain";

export interface PromptSegment {
  layer: Layer;
  start: number;
  end: number;
}

export interface Prompt {
  segments: PromptSegment[];
  totalTokens: number;
  tokensBefore(layer: Layer): number;
}

const ORDER: Layer[] = ["tools", "system", "messages"];

// Providers hash the prompt in this fixed order, so a change to a layer can
// only invalidate that layer and everything after it (S1).
export function buildPrompt(sizes: Record<Layer, number>): Prompt {
  const segments: PromptSegment[] = [];
  let cursor = 0;
  for (const layer of ORDER) {
    segments.push({ layer, start: cursor, end: cursor + sizes[layer] });
    cursor += sizes[layer];
  }
  return {
    segments,
    totalTokens: cursor,
    tokensBefore: (layer) =>
      segments.find((segment) => segment.layer === layer)!.start,
  };
}
