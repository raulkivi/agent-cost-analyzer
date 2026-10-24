import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./theme.css";
import { App } from "./App.js";
import { setApiTransport } from "./api-client/current-transport.js";
import { selectTransport } from "./api-client/select-transport.js";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root container missing in index.html");
}

setApiTransport(selectTransport(window));

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
