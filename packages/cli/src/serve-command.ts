// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { RequestListener } from "node:http";
import type { ServeCommand } from "./args.js";
import { loopbackUrl } from "./open-browser.js";
import { DEFAULT_PORT, choosePort, type PortProbes } from "./port-choice.js";

/** A bound server that has no request listener yet. */
export interface ServerHandle {
  mount(listener: RequestListener): void;
  close(): Promise<void>;
}

export interface ServeDeps extends PortProbes<ServerHandle> {
  /** The app for the port actually bound; the Host guard allows only that port. */
  compose(port: number): { listener: RequestListener; version: string };
  open(port: number, open: boolean): Promise<void>;
  /** Registers a SIGINT/SIGTERM handler; returns how to remove it. */
  onSignal(handler: () => void): () => void;
  stdout(text: string): void;
  stderr(text: string): void;
}

/**
 * The default command (npm-package.md §4.4 steps 3-7). Listening comes
 * before composing so that `--port 0` can name the port the Host guard
 * allows; no request can arrive in between, as both happen in one turn of
 * the event loop. stdout gets the start line and nothing else.
 */
export function createServeCommand(deps: ServeDeps): (options: ServeCommand) => Promise<number> {
  return async ({ port: requested, open }) => {
    const choice = await choosePort(requested, deps);
    if (choice.kind === "unavailable") {
      deps.stderr(`${choice.message}\n`);
      return 1;
    }
    if (choice.kind === "running") {
      deps.stdout(`Agent Cost Analyzer is already running on ${loopbackUrl(choice.port).replace(/\/$/, "")} (opening it)\n`);
      await deps.open(choice.port, open);
      return 0;
    }

    const { port, server } = choice;
    let composed;
    try {
      composed = deps.compose(port);
    } catch (error) {
      await server.close();
      throw error;
    }
    server.mount(composed.listener);
    if (choice.fellBack) deps.stderr(`Port ${DEFAULT_PORT} is in use; using ${port} instead.\n`);
    deps.stdout(`Agent Cost Analyzer ${composed.version} on ${loopbackUrl(port).replace(/\/$/, "")} (Ctrl+C to stop)\n`);
    await deps.open(port, open);

    await new Promise<void>((resolve) => {
      const stopListening = deps.onSignal(() => {
        stopListening();
        resolve();
      });
    });
    await server.close();
    return 0;
  };
}
