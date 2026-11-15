// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// One test per row of the command table in npm-package.md §4.3.
import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../src/args.js";

describe("parseCliArgs", () => {
  it("no arguments: serve and open the browser on the default port", () => {
    expect(parseCliArgs([])).toEqual({ kind: "serve", open: true });
  });

  it("--port <n> serves on that port only", () => {
    expect(parseCliArgs(["--port", "4000"])).toEqual({ kind: "serve", port: 4000, open: true });
    expect(parseCliArgs(["--port=4000"])).toEqual({ kind: "serve", port: 4000, open: true });
  });

  it("--port 0 means any free port, 65535 is the highest", () => {
    expect(parseCliArgs(["--port", "0"])).toEqual({ kind: "serve", port: 0, open: true });
    expect(parseCliArgs(["--port", "65535"])).toEqual({ kind: "serve", port: 65535, open: true });
  });

  it.each(["-1", "65536", "80.5", "abc", "", "1e3", "0x10", " 80", "08x"])("--port %j is an error", (value) => {
    const result = parseCliArgs([`--port=${value}`]);
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.message).toMatch(/--port/);
  });

  it("--port without a value is an error", () => {
    expect(parseCliArgs(["--port"]).kind).toBe("error");
  });

  it("--no-open starts without opening a browser", () => {
    expect(parseCliArgs(["--no-open"])).toEqual({ kind: "serve", open: false });
    expect(parseCliArgs(["--no-open", "--port", "0"])).toEqual({ kind: "serve", port: 0, open: false });
  });

  it("mcp with no flags: billing details off, no views override", () => {
    expect(parseCliArgs(["mcp"])).toEqual({ kind: "mcp", projectBillingDetails: false });
  });

  it("mcp takes today's stdio flags", () => {
    expect(parseCliArgs(["mcp", "--project-billing-details", "--app-views-html", "/tmp/v.html"])).toEqual({
      kind: "mcp",
      projectBillingDetails: true,
      appViewsHtml: "/tmp/v.html",
    });
    expect(parseCliArgs(["mcp", "--app-views-html=/tmp/a b.html"])).toEqual({
      kind: "mcp",
      projectBillingDetails: false,
      appViewsHtml: "/tmp/a b.html",
    });
  });

  it("mcp --app-views-html without a path is an error", () => {
    expect(parseCliArgs(["mcp", "--app-views-html"])).toEqual({
      kind: "error",
      message: expect.stringMatching(/--app-views-html needs a path/),
    });
  });

  it("mcp rejects unknown flags and positionals instead of ignoring them", () => {
    expect(parseCliArgs(["mcp", "--bogus"]).kind).toBe("error");
    expect(parseCliArgs(["mcp", "extra"]).kind).toBe("error");
    expect(parseCliArgs(["mcp", "--port", "1"]).kind).toBe("error");
  });

  it("--help and -h show usage", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  });

  it("--version and -v show the version", () => {
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseCliArgs(["-v"])).toEqual({ kind: "version" });
  });

  it("anything else is an error that names the argument", () => {
    for (const argv of [["--bogus"], ["serve"], ["extra"], ["--no-open", "extra"], ["-x"]]) {
      const result = parseCliArgs(argv);
      expect(result.kind).toBe("error");
      if (result.kind === "error") expect(result.message).toContain(argv[argv.length - 1]!);
    }
  });

  it("mcp is a subcommand only in first position", () => {
    expect(parseCliArgs(["--no-open", "mcp"]).kind).toBe("error");
  });
});
