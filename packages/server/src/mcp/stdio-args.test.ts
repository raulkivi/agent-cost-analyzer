// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { parseStdioArgs } from "./stdio-args.js";

describe("parseStdioArgs", () => {
  it("defaults to nothing enabled", () => {
    expect(parseStdioArgs([])).toEqual({ projectBillingDetails: false });
  });

  it("reads --project-billing-details", () => {
    expect(parseStdioArgs(["--project-billing-details"]).projectBillingDetails).toBe(true);
  });

  it("reads --app-views-html with a separate value", () => {
    expect(parseStdioArgs(["--app-views-html", "/tmp/spike.html"])).toEqual({ projectBillingDetails: false, appViewsHtml: "/tmp/spike.html" });
  });

  it("reads --app-views-html=value", () => {
    expect(parseStdioArgs(["--app-views-html=/tmp/a b.html", "--project-billing-details"])).toEqual({
      projectBillingDetails: true,
      appViewsHtml: "/tmp/a b.html",
    });
  });

  it("rejects --app-views-html without a value", () => {
    expect(() => parseStdioArgs(["--app-views-html"])).toThrow(/--app-views-html needs a path/);
    expect(() => parseStdioArgs(["--app-views-html", "--project-billing-details"])).toThrow(/--app-views-html needs a path/);
    expect(() => parseStdioArgs(["--app-views-html="])).toThrow(/--app-views-html needs a path/);
  });
});
