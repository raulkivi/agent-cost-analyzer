// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { PackageLayout } from "../../server/src/composition/package-layout.js";
import { createWebAppServer } from "../../server/src/http/web-app-server.js";
import { composeStandaloneApp, type StandaloneAppOptions } from "../../server/src/standalone-app.js";
import type { ServeCommand } from "./args.js";
import { isThisApp, listenOnLoopback } from "./loopback-server.js";
import { openBrowser } from "./open-browser.js";
import { createServeCommand } from "./serve-command.js";

export interface ServeWiring {
  layout: PackageLayout;
  stdout(text: string): void;
  stderr(text: string): void;
  onSignal(handler: () => void): () => void;
  // Composition options beyond the layout; tests isolate the log paths here.
  appOptions?: Omit<StandaloneAppOptions, "layout" | "allowedHostPorts">;
  open?: (port: number, open: boolean) => Promise<void>;
}

/**
 * The real `serve` handler: sockets, the packaged web app on the API's
 * origin, and the browser opener. Configuration warnings go to stderr.
 */
export function createServe(wiring: ServeWiring): (options: ServeCommand) => Promise<number> {
  const { layout, appOptions, stdout, stderr, onSignal } = wiring;
  return createServeCommand({
    listen: listenOnLoopback,
    isThisApp,
    compose: (port) => {
      const { app, version } = composeStandaloneApp({
        warn: (line) => stderr(`${line}\n`),
        ...appOptions,
        layout,
        allowedHostPorts: [port],
      });
      return { listener: createWebAppServer({ api: app, webDir: layout.webDir, allowedHostPorts: [port] }), version };
    },
    open: wiring.open ?? (async (port, open) => void (await openBrowser({ port, open }))),
    onSignal,
    stdout,
    stderr,
  });
}
