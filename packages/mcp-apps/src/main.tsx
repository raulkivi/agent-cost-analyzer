// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { readBrand } from "./brand/read-brand.js";
import { createExtAppsHostPort } from "./host/ext-apps-port.js";

const brand = readBrand(document);
const port = createExtAppsHostPort(brand.displayName, brand.version || "0.0.0");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App port={port} brand={brand} />
  </StrictMode>,
);
