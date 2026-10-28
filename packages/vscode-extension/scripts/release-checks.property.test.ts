import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isPreReleaseVersion, versionFromTag } from "./release-checks.mts";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// A plain major.minor.patch, no leading zeros, from fc.nat() parts.
const versionArb = fc.tuple(fc.nat(), fc.nat(), fc.nat()).map(
  ([major, minor, patch]) => `${major}.${minor}.${patch}`,
);

describe("versionFromTag (properties)", () => {
  it("returns the version after the product's tag prefix", () => {
    fc.assert(
      fc.property(versionArb, (version) => {
        expect(versionFromTag(`ext-v${version}`, "ext-v")).toBe(version);
      }),
    );
  });

  it("reads the version through the refs/tags/ remote ref too", () => {
    fc.assert(
      fc.property(versionArb, (version) => {
        expect(versionFromTag(`refs/tags/ext-v${version}`, "ext-v")).toBe(version);
      }),
    );
  });

  it("refuses any string that is not a plain major.minor.patch", () => {
    fc.assert(
      fc.property(fc.string().filter((s) => !SEMVER.test(s)), (s) => {
        expect(() => versionFromTag(`ext-v${s}`, "ext-v")).toThrow();
      }),
    );
  });

  it("refuses a leading zero in any part", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), (major, minor, patch) => {
        expect(() => versionFromTag(`ext-v0${major + 1}.${minor}.${patch}`, "ext-v")).toThrow();
        expect(() => versionFromTag(`ext-v${major}.0${minor + 1}.${patch}`, "ext-v")).toThrow();
        expect(() => versionFromTag(`ext-v${major}.${minor}.0${patch + 1}`, "ext-v")).toThrow();
      }),
    );
  });
});

describe("isPreReleaseVersion (properties)", () => {
  it("is true exactly for the odd minor (the pre-release channel)", () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), fc.nat(), (major, minor, patch) => {
        const version = `${major}.${minor}.${patch}`;
        expect(isPreReleaseVersion(version)).toBe(minor % 2 === 1);
      }),
    );
  });
});
