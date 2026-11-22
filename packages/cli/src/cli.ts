// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The entry that becomes dist/cli.js (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §4.3): the shim imports
// it, so importing it runs the CLI. In the bundle it sits in <root>/dist/,
// so the package root is one level up.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAppVersion } from "../../server/src/composition/app-version.js";
import { npmPackageLayout } from "../../server/src/composition/package-layout.js";
import { serveStandaloneMcpStdio } from "../../server/src/mcp/standalone-mcp-server.js";
import { createSetup } from "./mcp-setup/setup-wiring.js";
import { run } from "./run.js";
import { createServe } from "./serve-wiring.js";

const stdout = (text: string): void => void process.stdout.write(text);
const stderr = (text: string): void => void process.stderr.write(text);

async function main(): Promise<number> {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const layout = npmPackageLayout(packageRoot);
  const version = (): string => readAppVersion(layout.packageJsonPath);
  return run(process.argv.slice(2), {
    stdout,
    stderr,
    version,
    // Built on use: the server and the app paths never read the home folder.
    setup: (command) => createSetup({ version: version(), stdout, stderr })(command),
    serve: createServe({
      layout,
      stdout,
      stderr,
      stdoutIsTty: process.stdout.isTTY === true,
      onSignal: (handler) => {
        process.once("SIGINT", handler);
        process.once("SIGTERM", handler);
        return () => {
          process.off("SIGINT", handler);
          process.off("SIGTERM", handler);
        };
      },
    }),
    // stdout carries JSON-RPC only; the server logs to stderr.
    mcp: ({ projectBillingDetails, appViewsHtml }) => {
      serveStandaloneMcpStdio({ layout, projectBillingDetails, ...(appViewsHtml === undefined ? {} : { appViewsHtml }) });
      return new Promise<number>((resolve) => process.stdin.once("close", () => resolve(0)));
    },
  });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
