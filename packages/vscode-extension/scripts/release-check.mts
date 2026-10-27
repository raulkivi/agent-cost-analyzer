// Release gate for the workflows (vscode-extension.md §7.2):
//   node scripts/release-check.mts <tag> <tag-prefix> <package.json> [--engine]
// Fails unless the tag names the package's version; with --engine, also
// unless engines.vscode is the current stable VS Code (D9, the only network
// call, and only in CI). Prints `version=` and `prerelease=` lines, the
// format of $GITHUB_OUTPUT.
import { readFileSync } from "node:fs";
import { engineMatchesStable, isPreReleaseVersion, latestStableVersion, versionFromTag } from "./release-checks.mts";

const [tag, prefix, packageJsonPath, ...flags] = process.argv.slice(2);
if (!tag || !prefix || !packageJsonPath) {
  console.error("Usage: release-check.mts <tag> <tag-prefix> <package.json> [--engine]");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string; engines?: { vscode?: string } };
const version = versionFromTag(tag, prefix);
if (version !== manifest.version) {
  throw new Error(`Tag ${tag} doesn't match ${packageJsonPath} version ${manifest.version}.`);
}
if (flags.includes("--engine")) {
  const response = await fetch("https://update.code.visualstudio.com/api/releases/stable");
  if (!response.ok) throw new Error(`VS Code update API answered ${response.status}.`);
  const stable = latestStableVersion(await response.json());
  const engine = manifest.engines?.vscode ?? "";
  if (!engineMatchesStable(engine, stable)) {
    throw new Error(`engines.vscode is ${JSON.stringify(engine)}; D9 needs "^${stable.split(".").slice(0, 2).join(".")}.0" (stable ${stable}); also update "VS Code X.Y or later" in README.md.`);
  }
}
console.log(`version=${version}`);
console.log(`prerelease=${isPreReleaseVersion(version)}`);
