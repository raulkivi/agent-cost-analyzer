import path from "node:path";

const GLOBAL_STORAGE_DIR = "globalStorage";
const USER_DIR = "User";

// VS Code's user-data dir from the extension's own global storage path
// (context.globalStorageUri.fsPath, vscode-extension.md D4):
// <userData>/User/globalStorage/<extension-id>. That's the same layout on
// every platform and for Stable, Insiders, portable and remote-server
// installs, so no per-platform candidate list is needed (G5). Anything that
// doesn't have that shape gives null rather than a guess. `pathApi` follows
// the host OS by default; tests pass path.win32 to check Windows paths from
// any machine.
export function userDataDirFromGlobalStorage(globalStoragePath: string, pathApi: path.PlatformPath = path): string | null {
  if (!pathApi.isAbsolute(globalStoragePath)) {
    return null;
  }
  const globalStorageDir = pathApi.dirname(globalStoragePath);
  const userDir = pathApi.dirname(globalStorageDir);
  if (pathApi.basename(globalStoragePath) === "" || pathApi.basename(globalStorageDir) !== GLOBAL_STORAGE_DIR) {
    return null;
  }
  if (pathApi.basename(userDir) !== USER_DIR) {
    return null;
  }
  return pathApi.dirname(userDir);
}
