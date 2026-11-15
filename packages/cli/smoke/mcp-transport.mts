// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// An MCP stdio client transport over a process the smoke already started
// (the installed bin, as a client starts it), which keeps every stdout line
// so the smoke can check that stdout carried JSON-RPC alone (npm-package.md
// §4.6). The SDK's StdioClientTransport spawns the process itself and parses
// stdout without exposing it.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { deserializeMessage, serializeMessage, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client";

export class RecordingStdioTransport implements Transport {
  readonly lines: string[] = [];
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport["onmessage"];

  constructor(private readonly child: ChildProcessWithoutNullStreams) {}

  async start(): Promise<void> {
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      this.lines.push(line);
      let message: JSONRPCMessage;
      try {
        message = deserializeMessage(line);
      } catch (error) {
        this.onerror?.(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.onmessage?.(message);
    });
    this.child.once("close", () => this.onclose?.());
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.child.stdin.write(serializeMessage(message));
  }

  /** Ends stdin, as a client does; the server exits on its own. */
  async close(): Promise<void> {
    this.child.stdin.end();
  }
}
