// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { run, type CliDeps } from "../src/run.js";
import { usageText } from "../src/usage.js";

function fakes(overrides: (calls: unknown[]) => Partial<CliDeps> = () => ({})) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: unknown[] = [];
  const deps: CliDeps = {
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    version: () => "1.2.3",
    serve: async (options) => {
      calls.push(options);
      return 0;
    },
    mcp: async (options) => {
      calls.push(options);
      return 0;
    },
    setup: async (command) => {
      calls.push(command);
      return 0;
    },
    ...overrides(calls),
  };
  return { deps, out, err, calls };
}

describe("run", () => {
  it("--help prints usage on stdout and exits 0", async () => {
    const { deps, out, err } = fakes();
    expect(await run(["--help"], deps)).toBe(0);
    expect(out.join("")).toBe(usageText());
    expect(err).toEqual([]);
  });

  it("--version prints the version on stdout and exits 0", async () => {
    const { deps, out, err } = fakes();
    expect(await run(["-v"], deps)).toBe(0);
    expect(out.join("")).toBe("1.2.3\n");
    expect(err).toEqual([]);
  });

  it("an unknown argument prints the error and usage on stderr and exits 2", async () => {
    const { deps, out, err, calls } = fakes();
    expect(await run(["--bogus"], deps)).toBe(2);
    expect(out).toEqual([]);
    expect(err.join("")).toContain("--bogus");
    expect(err.join("")).toContain(usageText());
    expect(calls).toEqual([]);
  });

  it("an invalid port exits 2 without starting the server", async () => {
    const { deps, calls } = fakes();
    expect(await run(["--port", "70000"], deps)).toBe(2);
    expect(calls).toEqual([]);
  });

  it("hands serve options to the serve handler and returns its exit code", async () => {
    const { deps, calls } = fakes((c) => ({ serve: async (o) => (c.push(o), 7) }));
    expect(await run(["--port", "0", "--no-open"], deps)).toBe(7);
    expect(calls).toEqual([{ kind: "serve", port: 0, open: false }]);
  });

  it("hands mcp options to the mcp handler", async () => {
    const { deps, calls } = fakes();
    expect(await run(["mcp", "--project-billing-details"], deps)).toBe(0);
    expect(calls).toEqual([{ kind: "mcp", projectBillingDetails: true }]);
  });

  it("a handler that throws prints the message on stderr and exits 1", async () => {
    const { deps, err } = fakes(() => ({
      serve: async () => {
        throw new Error("port busy");
      },
    }));
    expect(await run([], deps)).toBe(1);
    expect(err.join("")).toContain("port busy");
  });
});

describe("usageText", () => {
  it("lists every command of the table", () => {
    const text = usageText();
    for (const part of ["--port", "--no-open", "mcp", "--project-billing-details", "--app-views-html", "--help", "--version"]) {
      expect(text).toContain(part);
    }
    expect(text.endsWith("\n")).toBe(true);
  });

  it("hands mcp install to the setup runner and returns its exit code", async () => {
    const { deps, calls } = fakes(() => ({ setup: async () => 1 }));
    expect(await run(["mcp", "install", "--client", "cursor", "--yes"], deps)).toBe(1);
    const ok = fakes();
    expect(await run(["mcp", "status"], ok.deps)).toBe(0);
    expect(ok.calls).toEqual([{ kind: "mcp-status", scope: "user" }]);
    expect(calls).toEqual([]);
  });

  it("exits 2 with usage for a bad setup flag", async () => {
    const { deps, err, calls } = fakes();
    expect(await run(["mcp", "install", "--client", "nope"], deps)).toBe(2);
    expect(err.join("")).toContain("Unknown client");
    expect(err.join("")).toContain("mcp install");
    expect(calls).toEqual([]);
  });

  it("reports a setup runner crash on stderr with exit 1", async () => {
    const { deps, err } = fakes(() => ({
      setup: async () => {
        throw new Error("boom");
      },
    }));
    expect(await run(["mcp", "status"], deps)).toBe(1);
    expect(err.join("")).toBe("boom\n");
  });
});
