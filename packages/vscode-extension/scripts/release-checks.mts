// Pure checks behind the release workflows (vscode-extension.md §7.2):
// which version a tag releases, which channel it goes to, whether
// engines.vscode is the current stable (D9), and the release notes for a
// version. release-check.mts and release-notes.mts are the CLIs over them.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parse(version: string): [number, number, number] | undefined {
  const match = SEMVER.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

// `ext-v0.1.0` (or `refs/tags/ext-v0.1.0`) -> `0.1.0`. Only a plain
// major.minor.patch is a release; anything else is refused.
export function versionFromTag(tag: string, prefix: string): string {
  const name = tag.startsWith("refs/tags/") ? tag.slice("refs/tags/".length) : tag;
  const version = name.startsWith(prefix) ? name.slice(prefix.length) : "";
  if (!parse(version)) {
    throw new Error(`Release tag ${JSON.stringify(tag)} isn't ${prefix}<major>.<minor>.<patch>.`);
  }
  return version;
}

// An odd minor is published to the Marketplace pre-release channel.
export function isPreReleaseVersion(version: string): boolean {
  const parsed = parse(version);
  if (!parsed) throw new Error(`Not a version: ${JSON.stringify(version)}.`);
  return parsed[1] % 2 === 1;
}

// The newest version in the answer of
// https://update.code.visualstudio.com/api/releases/stable.
export function latestStableVersion(answer: unknown): string {
  const versions = Array.isArray(answer) ? answer.filter((v): v is string => typeof v === "string" && !!parse(v)) : [];
  if (versions.length === 0 || (Array.isArray(answer) && versions.length !== answer.length)) {
    throw new Error("The VS Code update API didn't return a list of stable versions.");
  }
  return versions.reduce((newest, version) => {
    const [a, b] = [parse(version)!, parse(newest)!];
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? version : newest;
    return newest;
  });
}

// D9: engines.vscode is exactly ^<stable major>.<stable minor>.0.
export function engineMatchesStable(enginesVscode: string, stableVersion: string): boolean {
  const stable = parse(stableVersion);
  return !!stable && enginesVscode === `^${stable[0]}.${stable[1]}.0`;
}

// The body of `## [<version>]` in a Keep a Changelog file, up to the next
// `## ` heading, trimmed.
export function changelogSection(changelog: string, version: string): string {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`## [${version}]`));
  if (start === -1) throw new Error(`The changelog has no section for ${version}.`);
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}
