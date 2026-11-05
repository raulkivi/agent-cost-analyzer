import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KEEP_EXTENSIONS_MARKER, KeepExtensionsLauncher, writeKeepExtensionsBinary } from "./keep-extensions-service.mts";

describe("writeKeepExtensionsBinary (step 10.16)", () => {
  let dir: string;
  let realBinary: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "aica-keep-ext-"));
    // Prints one argument per line.
    realBinary = path.join(dir, "real-code");
    writeFileSync(realBinary, '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done\n');
    chmodSync(realBinary, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(args: string[]): string[] {
    const wrapper = writeKeepExtensionsBinary(path.join(dir, "wrapper"), realBinary);
    return execFileSync(wrapper, args, { encoding: "utf-8" }).split("\n").slice(0, -1);
  }

  it("drops every spelling of --disable-extensions, which the service always adds", () => {
    expect(run(["--no-sandbox", "--disable-extensions", "--disableExtensions", "--disable-extensions=true", "--disableExtensions=true", "--user-data-dir=/x"])).toEqual([
      "--no-sandbox",
      "--user-data-dir=/x",
    ]);
  });

  it("keeps --disable-extension=<id> (one extension) and every other argument, in order, spaces included", () => {
    expect(run(["--disable-extension=a.b", "--folder-uri=file:/tmp/with space", "--disable-extensions-x"])).toEqual([
      "--disable-extension=a.b",
      "--folder-uri=file:/tmp/with space",
      "--disable-extensions-x",
    ]);
  });
});

describe("KeepExtensionsLauncher (step 10.16)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "aica-keep-ext-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("points only the marked launches at the wrapper, once the service has downloaded VS Code", () => {
    const marked = { [KEEP_EXTENSIONS_MARKER]: true, "wdio:vscodeOptions": { binary: "/cache/vscode/code" } };
    const plain = { "wdio:vscodeOptions": { binary: "/cache/vscode/code" } };

    new KeepExtensionsLauncher({ dir }).prepare([marked, plain]);

    expect(marked["wdio:vscodeOptions"].binary).toBe(path.join(dir, "code-keeping-extensions"));
    expect(plain["wdio:vscodeOptions"].binary).toBe("/cache/vscode/code");
  });

  it("wraps once, however many workers the launch starts", () => {
    const marked = { [KEEP_EXTENSIONS_MARKER]: true, "wdio:vscodeOptions": { binary: "/cache/vscode/code" } };
    const launcher = new KeepExtensionsLauncher({ dir });

    launcher.prepare([marked]);
    launcher.prepare([marked]);

    expect(readFileSync(marked["wdio:vscodeOptions"].binary, "utf-8")).toContain("exec '/cache/vscode/code'");
  });

  it("fails clearly when a marked launch has no VS Code binary yet", () => {
    const marked = { [KEEP_EXTENSIONS_MARKER]: true, "wdio:vscodeOptions": {} };

    expect(() => new KeepExtensionsLauncher({ dir }).prepare([marked])).toThrow(/no VS Code binary/);
  });
});
