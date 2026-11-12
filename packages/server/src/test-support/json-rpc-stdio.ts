// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";

// A bare JSON-RPC peer for an MCP stdio entry point: it writes exactly the
// messages a test gives it, so a test pins the wire a host sends (a 2025
// `initialize` at a chosen protocolVersion, or a 2026-07-28 request with its
// `_meta` envelope) without an SDK client choosing for it.

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcStdioPeer {
  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse>;
  notify(method: string, params?: Record<string, unknown>): void;
  stderr(): string;
  close(): Promise<void>;
}

export const MODERN_PROTOCOL_VERSION = "2026-07-28";

// The per-request envelope protocol revision 2026-07-28 puts in every
// request's `_meta` in place of the `initialize` handshake.
export function modernEnvelope(clientCapabilities: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": MODERN_PROTOCOL_VERSION,
    "io.modelcontextprotocol/clientInfo": { name: "json-rpc-stdio-test", version: "1.0.0" },
    "io.modelcontextprotocol/clientCapabilities": clientCapabilities,
  };
}

export function spawnJsonRpcStdio(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 30_000): JsonRpcStdioPeer {
  const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, { resolve: (message: JsonRpcResponse) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let buffered = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString("utf-8");
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      const message = JSON.parse(line) as JsonRpcResponse;
      pending.get(message.id)?.resolve(message);
      pending.delete(message.id);
    }
  });
  child.on("exit", (code) => {
    for (const { reject } of pending.values()) reject(new Error(`exited with ${code}: ${stderr}`));
    pending.clear();
  });
  const write = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);

  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise<JsonRpcResponse>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no answer to ${method} within ${timeoutMs} ms: ${stderr}`)), timeoutMs);
        pending.set(id, {
          resolve: (message) => {
            clearTimeout(timer);
            resolve(message);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        write({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method, params = {}) {
      write({ jsonrpc: "2.0", method, params });
    },
    stderr: () => stderr,
    close() {
      if (child.exitCode !== null) return Promise.resolve();
      return new Promise<void>((resolve) => {
        child.once("exit", () => resolve());
        child.stdin.end();
        child.kill();
      });
    },
  };
}

// The 2025-era handshake at the given protocol version; resolves with the
// server's `initialize` result.
export async function initializeLegacy(peer: JsonRpcStdioPeer, protocolVersion: string): Promise<JsonRpcResponse> {
  const response = await peer.request("initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "json-rpc-stdio-test", version: "1.0.0" },
  });
  peer.notify("notifications/initialized");
  return response;
}
