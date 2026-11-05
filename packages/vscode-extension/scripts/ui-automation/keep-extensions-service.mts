// wdio-vscode-service always starts VS Code with --disable-extensions, so no
// installed extension loads, only the one under development. Checks 1.2 and
// 1.4 need a second extension (the Copilot Chat stand-in) and check 1.12 an
// installed copy of the analyzer. `KeepExtensionsLauncher.prepare` points
// marked launches at a wrapper that drops that flag before starting the real
// VS Code (the service's chromium shim passes the binary's path through, and
// can't remove an argument). The config calls it from `onWorkerStart`: the
// services' `onPrepare` hooks run in parallel, so the vscode service hasn't
// downloaded VS Code, and set `binary`, when a service of ours would run.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const KEEP_EXTENSIONS_MARKER = "aica:keepExtensions";
const VSCODE_OPTIONS = "wdio:vscodeOptions";
const WRAPPER_NAME = "code-keeping-extensions";

// POSIX sh: the argument list is rebuilt without the flag, spaces intact.
export function writeKeepExtensionsBinary(wrapperPath: string, realBinary: string): string {
  const quoted = `'${realBinary.replace(/'/g, `'\\''`)}'`;
  writeFileSync(
    wrapperPath,
    [
      "#!/bin/sh",
      "n=$#",
      "while [ \"$n\" -gt 0 ]; do",
      "  arg=$1; shift; n=$((n - 1))",
      "  case \"$arg\" in",
      "    --disable-extensions|--disable-extensions=*|--disableExtensions|--disableExtensions=*) ;;",
      "    *) set -- \"$@\" \"$arg\" ;;",
      "  esac",
      "done",
      `exec ${quoted} "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(wrapperPath, 0o755);
  return wrapperPath;
}

interface MarkedCapability {
  [VSCODE_OPTIONS]?: { binary?: string };
  [key: string]: unknown;
}

export interface KeepExtensionsOptions {
  // Where the wrapper is written.
  dir: string;
}

export class KeepExtensionsLauncher {
  constructor(private readonly options: KeepExtensionsOptions) {}

  prepare(capabilities: MarkedCapability[]): void {
    for (const capability of capabilities) {
      if (capability[KEEP_EXTENSIONS_MARKER] !== true) continue;
      const binary = capability[VSCODE_OPTIONS]?.binary;
      if (binary === undefined || binary === "") {
        throw new Error("The launch keeps extensions but has no VS Code binary yet: call prepare after the vscode service has downloaded VS Code");
      }
      const wrapperPath = path.join(this.options.dir, WRAPPER_NAME);
      // One capability starts several workers (one per spec file): wrap once.
      if (binary === wrapperPath) continue;
      mkdirSync(this.options.dir, { recursive: true });
      capability[VSCODE_OPTIONS] = { ...capability[VSCODE_OPTIONS], binary: writeKeepExtensionsBinary(wrapperPath, binary) };
    }
  }
}
