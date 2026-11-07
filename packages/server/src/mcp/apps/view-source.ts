// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFile } from "node:fs/promises";

// Where the MCP App views' HTML comes from (docs/plans/mcp-apps.md §4.2).
// The server depends on this port, not on file paths (DIP).
export interface ViewSource {
  read(): Promise<string>;
}

// The built bundle on disk (packages/mcp-apps/dist/views.html for the
// standalone server, dist/mcp-apps/views.html in the .vsix). Read on every
// call, so a rebuilt bundle is served without restarting the server.
export class FileViewSource implements ViewSource {
  constructor(private readonly path: string) {}

  async read(): Promise<string> {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      throw new Error(`Cannot read the MCP App views at ${this.path}: ${(error as Error).message}`, { cause: error });
    }
  }
}

export class InMemoryViewSource implements ViewSource {
  constructor(private readonly html: string) {}

  async read(): Promise<string> {
    return this.html;
  }
}
