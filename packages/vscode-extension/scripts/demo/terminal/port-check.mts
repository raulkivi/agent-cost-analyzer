// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createServer } from "node:net";

export type CanBind = (port: number) => Promise<boolean>;

export const canBind: CanBind = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });

// A running app on the port would turn the first command into "already running" and spoil beat 2.
export async function assertPortFree(port: number, bind: CanBind = canBind): Promise<void> {
  if (!(await bind(port))) throw new Error(`Port ${port} is in use: stop the Agent Cost Analyzer (or whatever holds it) before recording N1`);
}
