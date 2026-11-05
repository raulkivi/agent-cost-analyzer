import type { ScriptImage } from "@agent-cost-analyzer/domain";

export interface ImageTokens {
  tokens: number;
  // No vendor formula in the profile data: the figure borrows Anthropic's
  // and must be labelled an estimate (D15).
  estimated: boolean;
}

const PATCH_PIXELS = 28;

export function imageTokens(vendorId: string, image: ScriptImage): ImageTokens {
  return {
    tokens:
      Math.ceil(image.width / PATCH_PIXELS) *
      Math.ceil(image.height / PATCH_PIXELS),
    estimated: vendorId !== "anthropic",
  };
}
