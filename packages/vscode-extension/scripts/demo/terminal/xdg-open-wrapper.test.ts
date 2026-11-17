// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { demoPath, xdgOpenScript } from "./xdg-open-wrapper.mts";

describe("xdgOpenScript", () => {
  it("forwards the URL it is given to the control port as data, never through a shell string", () => {
    const script = xdgOpenScript(40123);
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain("http://127.0.0.1:40123/open");
    expect(script).toContain('--data-urlencode "url=$1"');
  });
  it("rejects a control port that is not a port", () => {
    expect(() => xdgOpenScript(0)).toThrow(/port/i);
    expect(() => xdgOpenScript(70000)).toThrow(/port/i);
  });
});

describe("demoPath", () => {
  it("puts the wrapper directory first", () => {
    expect(demoPath("/tmp/bin", "/usr/bin:/bin")).toBe("/tmp/bin:/usr/bin:/bin");
  });
});
