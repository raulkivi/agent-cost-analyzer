// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.js";
import "./theme.css";
import "./theme-vscode.css";
import { App } from "./App.js";
import { setApiTransport } from "./api-client/current-transport.js";
import { selectTransport } from "./api-client/select-transport.js";
import { setHostCapabilities } from "./host/current-host-capabilities.js";
import { initColorMode, PREFERS_DARK_QUERY } from "./lib/color-mode.js";
import { createPerformanceMarks } from "./lib/performance-marks.js";
import { hostCapabilitiesFor } from "./host/host-capabilities.js";
import { setViewStateStorage } from "./state/current-view-state-storage.js";
import { viewStateStorageFor } from "./state/view-state-storage.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container missing in index.html");
}

const transport = selectTransport(window);
setApiTransport(transport);
const hostCapabilities = hostCapabilitiesFor(transport);
setHostCapabilities(hostCapabilities);
// Before the first render, so there is no flash of the wrong scheme.
initColorMode(
  hostCapabilities.colorMode === true,
  document.documentElement,
  (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
  window.matchMedia?.(PREFERS_DARK_QUERY).matches ?? false,
);
setViewStateStorage(viewStateStorageFor(transport, () => window.localStorage));
// The page's timing marks, also posted to the extension host when there is
// one (step 10.9's performance budgets).
const performanceMarks = createPerformanceMarks(globalThis.performance, (name, timeMs) =>
  transport.reportPerformanceMark?.(name, timeMs),
);

createRoot(container).render(
  <StrictMode>
    <App performanceMarks={performanceMarks} />
  </StrictMode>,
);
