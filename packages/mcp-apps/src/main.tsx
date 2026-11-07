// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Cascade order (plan §5.2): Industry tokens, brand tokens, host mapping.
import "@agent-cost-analyzer/web/theme.css";
import "./theme/brand.css";
import "./theme/theme-mcp-host.css";
import "./theme/views.css";
import { App } from "./App.js";
import { readBrand } from "./brand/read-brand.js";
import { browserClipboard } from "./host/clipboard-port.js";
import { createExtAppsHostPort } from "./host/ext-apps-port.js";
import { bindHostTheme } from "./theme/apply-host-theme.js";

const brand = readBrand(document);
const port = createExtAppsHostPort(brand.displayName, brand.version || "0.0.0");
// Before connect(), so the first host context is applied as it arrives.
bindHostTheme(port, { applyDocumentTheme, applyHostStyleVariables, applyHostFonts });
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App port={port} brand={brand} clipboard={browserClipboard()} />
  </StrictMode>,
);
