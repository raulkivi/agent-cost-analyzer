import { useState } from "react";
import { getViewStateStorage } from "./current-view-state-storage.js";

export const EXTRA_MODELS_KEY = "learnVendorsExtraModels";

function parse(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

// D11: the Vendors tab starts from each vendor's default model, and the
// models the user adds are kept between visits.
export function useExtraVendorModels() {
  const [modelIds, setModelIds] = useState<string[]>(() => parse(getViewStateStorage().get(EXTRA_MODELS_KEY)));

  function update(next: string[]): void {
    setModelIds(next);
    getViewStateStorage().set(EXTRA_MODELS_KEY, next);
  }

  return {
    modelIds,
    add: (modelId: string) => {
      if (!modelIds.includes(modelId)) update([...modelIds, modelId]);
    },
    remove: (modelId: string) => update(modelIds.filter((id) => id !== modelId)),
  };
}
