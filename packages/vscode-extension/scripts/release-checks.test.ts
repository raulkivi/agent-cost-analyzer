import { describe, expect, it } from "vitest";
import {
  changelogSection,
  engineMatchesStable,
  isPreReleaseVersion,
  latestStableVersion,
  versionFromTag,
} from "./release-checks.mts";

describe("versionFromTag (vscode-extension.md §7.2)", () => {
  it("reads the version after the product's tag prefix", () => {
    expect(versionFromTag("ext-v0.1.0", "ext-v")).toBe("0.1.0");
    expect(versionFromTag("refs/tags/app-v1.10.2", "app-v")).toBe("1.10.2");
  });

  it.each(["v0.1.0", "ext-v0.1", "ext-v0.1.0-beta", "ext-v01.1.0", "app-v0.1.0", "ext-v0.1.0\n"])(
    "refuses %j",
    (tag) => {
      expect(() => versionFromTag(tag, "ext-v")).toThrow(/tag/);
    },
  );
});

describe("isPreReleaseVersion (odd minor goes to the pre-release channel)", () => {
  it.each([
    ["0.1.0", true],
    ["0.3.7", true],
    ["0.2.0", false],
    ["1.10.0", false],
  ])("%s -> %s", (version, expected) => {
    expect(isPreReleaseVersion(version)).toBe(expected);
  });
});

describe("latestStableVersion", () => {
  it("takes the newest of the update API's list, whatever its order", () => {
    expect(latestStableVersion(["1.142.1", "1.143.0", "1.141.0"])).toBe("1.143.0");
  });

  it("skips the old suffixed names the real answer ends with", () => {
    expect(latestStableVersion(["1.143.1", "1.143.0", "0.10.6-release", "0.10.1-preview", "0.8.0-preview"])).toBe("1.143.1");
  });

  it("refuses an answer that isn't a list of versions", () => {
    expect(() => latestStableVersion(["1.143.0", 42])).toThrow(/stable/);
    expect(() => latestStableVersion({ versions: [] })).toThrow(/stable/);
    expect(() => latestStableVersion([])).toThrow(/stable/);
    expect(() => latestStableVersion(["latest"])).toThrow(/stable/);
  });
});

describe("engineMatchesStable (D9: the minimum is the current stable)", () => {
  it("accepts ^<stable major.minor>.0", () => {
    expect(engineMatchesStable("^1.143.0", "1.143.2")).toBe(true);
  });

  it.each(["^1.142.0", "^1.144.0", ">=1.143.0", "1.143.0", "^1.143.1"])("rejects %s against 1.143.2", (range) => {
    expect(engineMatchesStable(range, "1.143.2")).toBe(false);
  });
});

describe("changelogSection", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "- not yet",
    "",
    "## [0.2.0] - 2026-11-01",
    "### Added",
    "- Thing two.",
    "",
    "## [0.1.0] - 2026-10-24",
    "- Thing one.",
    "",
  ].join("\n");

  it("returns the body of the version's section, without its heading", () => {
    expect(changelogSection(changelog, "0.2.0")).toBe("### Added\n- Thing two.");
    expect(changelogSection(changelog, "0.1.0")).toBe("- Thing one.");
  });

  it("refuses a version the changelog doesn't record", () => {
    expect(() => changelogSection(changelog, "0.3.0")).toThrow(/0\.3\.0/);
  });

  it("doesn't match a version that only shares a prefix", () => {
    expect(() => changelogSection(changelog, "0.1")).toThrow(/0\.1/);
  });
});
