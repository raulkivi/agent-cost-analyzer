import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The version /api/health and the MCP server report. The package.json path
// is injectable (G4, vscode-extension.md §2.2) because a single-file bundle
// can't locate it through import.meta.url; the default — resolved only
// when no path is given — is this package's own package.json, as before.
export function readAppVersion(packageJsonPath?: string): string {
  const resolvedPath =
    packageJsonPath ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../package.json");
  return (JSON.parse(readFileSync(resolvedPath, "utf-8")) as { version: string }).version;
}
