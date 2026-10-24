// Prints one version's changelog section, the GitHub Release notes:
//   node scripts/release-notes.mts <CHANGELOG.md> <version>
import { readFileSync } from "node:fs";
import { changelogSection } from "./release-checks.mts";

const [changelogPath, version] = process.argv.slice(2);
if (!changelogPath || !version) {
  console.error("Usage: release-notes.mts <CHANGELOG.md> <version>");
  process.exit(2);
}
console.log(changelogSection(readFileSync(changelogPath, "utf-8"), version));
