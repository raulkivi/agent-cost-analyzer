import path from "node:path";

export const USER_DATA_DIR_FLAG = "--user-data-dir";

export const MCP_SERVER_USAGE = `Usage: mcp-stdio.js ${USER_DATA_DIR_FLAG} <absolute path to VS Code's user-data dir>`;

export type McpServerArgs = { ok: true; userDataDir: string } | { ok: false; error: string };

export interface McpServerArgsDeps {
  // Whether a path is an existing directory (fs.statSync in mcp/stdio.ts).
  isDirectory(candidate: string): boolean;
  // The running platform's path rules by default; tests pass path.win32.
  pathApi?: path.PlatformPath;
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what this rejects
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function usageError(reason: string): McpServerArgs {
  return { ok: false, error: `${reason}. ${MCP_SERVER_USAGE}` };
}

// The command line of the extension's MCP child process (dist/mcp-stdio.js,
// vscode-extension.md D7). The child has no `vscode` API, so the host passes
// the user-data dir it derived from globalStorageUri (D4) as the only
// argument; every Copilot log path is derived from it. VS Code spawns the
// child without a shell, but the value is still checked strictly: exactly
// one flag and value, an absolute and already-normalized path (no `..`, no
// doubled or trailing separator, not the root, no control characters), and
// a directory that has VS Code's `User` folder. Anything else is refused
// before a file is opened. A rejected path is quoted with JSON.stringify, so
// the message never carries a raw control character.
export function parseMcpServerArgs(argv: readonly string[], deps: McpServerArgsDeps): McpServerArgs {
  const pathApi = deps.pathApi ?? path;
  if (argv.length !== 2 || argv[0] !== USER_DATA_DIR_FLAG) {
    return usageError(`Expected exactly ${USER_DATA_DIR_FLAG} and a path`);
  }
  const userDataDir = argv[1]!;
  if (
    userDataDir === "" ||
    CONTROL_CHARACTERS.test(userDataDir) ||
    !pathApi.isAbsolute(userDataDir) ||
    pathApi.normalize(userDataDir) !== userDataDir ||
    pathApi.dirname(userDataDir) === userDataDir ||
    userDataDir.endsWith(pathApi.sep)
  ) {
    return usageError(`${USER_DATA_DIR_FLAG} must be an absolute, normalized path, not ${JSON.stringify(userDataDir)}`);
  }
  if (!deps.isDirectory(pathApi.join(userDataDir, "User"))) {
    return usageError(`${JSON.stringify(userDataDir)} has no User folder, so it isn't a VS Code user-data dir`);
  }
  return { ok: true, userDataDir };
}
