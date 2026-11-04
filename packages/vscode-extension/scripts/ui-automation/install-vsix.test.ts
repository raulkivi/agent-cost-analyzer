import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cliOf, installVsix } from "./install-vsix.mts";

describe("installVsix (step 10.16, check 1.12)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "aica-install-vsix-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds VS Code's command-line launcher next to the app binary", () => {
    expect(cliOf("/cache/vscode-linux-x64-1.145.0/code")).toBe("/cache/vscode-linux-x64-1.145.0/bin/code");
  });

  it("installs into the launch's own extensions and user-data dirs, never the developer's", () => {
    const cli = path.join(dir, "fake-cli");
    writeFileSync(cli, `#!/bin/sh\nprintf "%s\\n" "$@" > ${path.join(dir, "args.txt")}\n`);
    chmodSync(cli, 0o755);

    installVsix({ cli, vsix: "/tmp/a.vsix", extensionsDir: "/tmp/ext", userDataDir: "/tmp/ud" });

    expect(readFileSync(path.join(dir, "args.txt"), "utf-8").split("\n").filter(Boolean)).toEqual([
      "--extensions-dir=/tmp/ext",
      "--user-data-dir=/tmp/ud",
      "--install-extension",
      "/tmp/a.vsix",
      "--force",
    ]);
  });

  it("fails with the CLI's own output when the install fails", () => {
    const cli = path.join(dir, "failing-cli");
    writeFileSync(cli, "#!/bin/sh\necho 'bad vsix' >&2\nexit 3\n");
    chmodSync(cli, 0o755);

    expect(() => installVsix({ cli, vsix: "/x.vsix", extensionsDir: "/e", userDataDir: "/u" })).toThrow(/bad vsix/);
  });
});
