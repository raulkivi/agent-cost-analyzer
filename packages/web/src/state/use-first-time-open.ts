// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useState } from "react";
import { getViewStateStorage } from "./current-view-state-storage.js";

// A disclosure that is open the first time this viewer meets it and closed
// from then on (plan §10: the replay's assumptions are shown by default the
// first time). Remembered in the app's view-state storage: the webview's
// state in VS Code, localStorage in the standalone app.
export function useFirstTimeOpen(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => getViewStateStorage().get(key) !== true);
  useEffect(() => {
    getViewStateStorage().set(key, true);
  }, [key]);
  return [open, setOpen];
}
