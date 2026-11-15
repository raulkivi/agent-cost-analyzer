// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { APP_ID } from "../../server/src/app-id.js";
import { assertLoopbackBindHost } from "../../server/src/http/loopback-bind.js";
import type { ListenOutcome } from "./port-choice.js";
import type { ServerHandle } from "./serve-command.js";

// threat-model.md §5.1: never anything but loopback.
const BIND_HOST = "127.0.0.1";
const PROBE_TIMEOUT_MS = 1000;

/** Binds 127.0.0.1:port. A busy port is an outcome; any other failure throws. */
export function listenOnLoopback(port: number): Promise<ListenOutcome<ServerHandle>> {
  assertLoopbackBindHost(BIND_HOST);
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve({ status: "busy" });
      else reject(error);
    });
    server.listen(port, BIND_HOST, () => {
      resolve({
        status: "listening",
        port: (server.address() as AddressInfo).port,
        server: {
          mount: (listener) => void server.on("request", listener),
          close: () =>
            new Promise<void>((done) => {
              // Idle keep-alive connections would hold close() until they time out.
              server.close(() => done());
              server.closeAllConnections();
            }),
        },
      });
    });
  });
}

/** True when `GET /api/health` on the port names this app. Any failure is false. */
export async function isThisApp(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    const response = await fetch(`http://${BIND_HOST}:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && (body as { app?: unknown }).app === APP_ID;
  } catch {
    return false;
  }
}
