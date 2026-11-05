import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { CaptureRule } from "@agent-cost-analyzer/domain";
import { captureGlobMatches, matchCaptureRule } from "./capture-rule-matcher.js";

const HOME = "/home/dev";

describe("captureGlobMatches", () => {
  it("matches `*` within one folder, `**` across folders and `?` as one character", () => {
    expect(captureGlobMatches("/captures/acme/*.har", "/captures/acme/one.har", HOME)).toBe(true);
    expect(captureGlobMatches("/captures/acme/*.har", "/captures/acme/sub/one.har", HOME)).toBe(false);
    expect(captureGlobMatches("/captures/**/*.har", "/captures/acme/sub/one.har", HOME)).toBe(true);
    expect(captureGlobMatches("/captures/acme/run-?.har", "/captures/acme/run-1.har", HOME)).toBe(true);
    expect(captureGlobMatches("/captures/acme/run-?.har", "/captures/acme/run-12.har", HOME)).toBe(false);
  });

  it("expands a leading ~ to the home folder", () => {
    expect(captureGlobMatches("~/captures/acme/*.har", "/home/dev/captures/acme/one.har", HOME)).toBe(true);
    expect(captureGlobMatches("~/captures/acme/*.har", "/root/captures/acme/one.har", HOME)).toBe(false);
  });

  it("compares Windows paths with forward slashes", () => {
    expect(captureGlobMatches("C:/captures/*.har", "C:\\captures\\one.har", "C:\\Users\\dev")).toBe(true);
    expect(captureGlobMatches("~/captures/*.har", "C:\\Users\\dev\\captures\\one.har", "C:\\Users\\dev")).toBe(true);
  });

  it("is literal for everything but *, ** and ?, so regex characters don't act", () => {
    expect(captureGlobMatches("/c/a+b(1).har", "/c/a+b(1).har", HOME)).toBe(true);
    expect(captureGlobMatches("/c/a.har", "/c/aXhar", HOME)).toBe(false);
  });

  it("finishes quickly on a pattern that would make a backtracking regex explode (ReDoS)", () => {
    const pattern = `${"**a".repeat(40)}b`;
    const subject = "a".repeat(5_000);
    const start = performance.now();
    expect(captureGlobMatches(pattern, subject, HOME)).toBe(false);
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it("matches every path against `**` and a path against itself (property)", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\/[a-z0-9/._-]{0,40}$/), (filePath) => {
        expect(captureGlobMatches("**", filePath, HOME)).toBe(true);
        expect(captureGlobMatches(filePath, filePath, HOME)).toBe(true);
      }),
    );
  });
});

describe("matchCaptureRule", () => {
  const rules: CaptureRule[] = [
    { glob: "~/captures/acme/*.har", repository: "github.com/acme/portal" },
    { glob: "~/captures/**", repository: "github.com/acme/other" },
  ];

  it("takes the first rule whose glob matches the capture file", () => {
    expect(matchCaptureRule(rules, "/home/dev/captures/acme/one.har", HOME)?.repository).toBe("github.com/acme/portal");
    expect(matchCaptureRule(rules, "/home/dev/captures/misc/two.har", HOME)?.repository).toBe("github.com/acme/other");
  });

  it("returns null when no rule matches", () => {
    expect(matchCaptureRule(rules, "/tmp/three.har", HOME)).toBeNull();
    expect(matchCaptureRule([], "/home/dev/captures/acme/one.har", HOME)).toBeNull();
  });
});
