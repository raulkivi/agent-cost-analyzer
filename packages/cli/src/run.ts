// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { parseCliArgs, type McpCommand, type ServeCommand, type SetupCommand } from "./args.js";
import { usageText } from "./usage.js";

/** Everything `run` touches, injected so tests need no process, port or stdio. */
export interface CliDeps {
  stdout(text: string): void;
  stderr(text: string): void;
  version(): string;
  /** Resolves to the process exit code once the server has stopped. */
  serve(options: ServeCommand): Promise<number>;
  /** Resolves to the process exit code once the stdio server has ended. */
  mcp(options: McpCommand): Promise<number>;
  /** `mcp config|install|uninstall|status`: resolves to the exit code. */
  setup(command: SetupCommand): Promise<number>;
}

export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  const command = parseCliArgs(argv);
  switch (command.kind) {
    case "help":
      deps.stdout(usageText());
      return 0;
    case "version":
      deps.stdout(`${deps.version()}\n`);
      return 0;
    case "error":
      deps.stderr(`${command.message}\n\n${usageText()}`);
      return 2;
    default:
      try {
        return await dispatch(command, deps);
      } catch (error) {
        deps.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
  }
}

function dispatch(command: ServeCommand | McpCommand | SetupCommand, deps: CliDeps): Promise<number> {
  switch (command.kind) {
    case "serve":
      return deps.serve(command);
    case "mcp":
      return deps.mcp(command);
    default:
      return deps.setup(command);
  }
}
