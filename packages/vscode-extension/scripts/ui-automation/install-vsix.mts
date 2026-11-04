// Check 1.12 (uninstall) needs the analyzer installed from a VSIX, as a user
// has it, not loaded as a development extension. VS Code's own CLI installs it
// into the launch's extensions dir before VS Code starts.
import { execFileSync } from "node:child_process";
import path from "node:path";

export interface InstallVsixOptions {
  cli: string;
  vsix: string;
  extensionsDir: string;
  userDataDir: string;
}

// wdio-vscode-service's `binary` is the app executable; the CLI is bin/code beside it.
export function cliOf(appBinary: string): string {
  return path.join(path.dirname(appBinary), "bin", "code");
}

export function installVsix({ cli, vsix, extensionsDir, userDataDir }: InstallVsixOptions): void {
  try {
    execFileSync(cli, [`--extensions-dir=${extensionsDir}`, `--user-data-dir=${userDataDir}`, "--install-extension", vsix, "--force"], { stdio: "pipe", encoding: "utf-8" });
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; message: string };
    throw new Error(`Installing ${vsix} failed: ${failure.stderr || failure.stdout || failure.message}`, { cause: error });
  }
}
