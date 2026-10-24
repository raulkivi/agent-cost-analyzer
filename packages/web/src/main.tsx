import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.js";
import "./theme.css";
import "./theme-vscode.css";
import { App } from "./App.js";
import { setApiTransport } from "./api-client/current-transport.js";
import { selectTransport } from "./api-client/select-transport.js";
import { setHostCapabilities } from "./host/current-host-capabilities.js";
import { hostCapabilitiesFor } from "./host/host-capabilities.js";
import { setViewStateStorage } from "./state/current-view-state-storage.js";
import { viewStateStorageFor } from "./state/view-state-storage.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container missing in index.html");
}

const transport = selectTransport(window);
setApiTransport(transport);
setHostCapabilities(hostCapabilitiesFor(transport));
setViewStateStorage(viewStateStorageFor(transport, () => window.localStorage));

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
