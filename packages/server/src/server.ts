// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { composeStandaloneApp } from "./standalone-app.js";
import { assertLoopbackBindHost } from "./http/loopback-bind.js";

// The dev entry point (npm run dev): this package's own data, no layout.
const port = 3001;
// Loopback-only per architecture.md §11.2 — never expose to other hosts.
const host = "127.0.0.1";
// threat-model.md §5.1: fails at start if this ever stops being loopback.
assertLoopbackBindHost(host);
// The Vite dev server (packages/web/vite.config.ts, strictPort) proxies
// /api here without changeOrigin, so its own Host (port 5173) arrives as-is.
const viteDevServerPort = 5173;

composeStandaloneApp({ allowedHostPorts: [port, viteDevServerPort] }).app.listen(port, host, () => {
  console.log(`Server listening on http://${host}:${port}`);
});
