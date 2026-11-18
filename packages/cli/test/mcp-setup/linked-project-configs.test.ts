// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientSetup,
  type McpClientId,
  type McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import { createClientTargets } from "../../src/mcp-setup/client-targets.js";
import { createConfigFileStore } from "../../src/mcp-setup/config-file-store.js";
import { createSetupRunner } from "../../src/mcp-setup/setup-runner.js";
import { fakeEnv } from "./fake-client-env.js";

// MC9 review R6: a cloned repository can commit its project config, or the
// folder holding it, as a link that points anywhere. Project scope refuses
// such a config; user scope still follows links (dotfile managers).

const NAME = "agent-cost-analyzer";
const isWindows = process.platform === "win32";

let root: string;
let home: string;
let cwd: string;
let elsewhere: string;
beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "aca-linked-"));
  home = join(root, "home");
  cwd = join(root, "proj");
  elsewhere = join(root, "elsewhere");
  for (const dir of [home, cwd, elsewhere]) await fsp.mkdir(dir);
  await fsp.mkdir(join(home, ".cursor"));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

const env = () =>
  fakeEnv({
    home,
    cwd,
    commands: ["claude", "gemini"],
    exists: (path) =>
      fsp.access(path).then(
        () => true,
        () => false,
      ),
  });

function deps(out: string[], runs: string[][]) {
  const store = createConfigFileStore();
  return {
    targets: createClientTargets({ store }),
    store,
    runner: {
      run: async (file: string, args: readonly string[]) => {
        runs.push([file, ...args]);
        return { ok: true } as const;
      },
    },
    env: env(),
    version: "1.0.0",
    io: {
      out: (t: string) => void out.push(t),
      err: (t: string) => void out.push(t),
      interactive: false,
      confirm: async () => false,
    },
  };
}

const status = async (client: McpClientId, scope: McpScope) => {
  const target = createClientTargets({ store: createConfigFileStore() }).find(
    (t) => t.id === client,
  )!;
  const setup = clientSetup(client, {
    version: "1.0.0",
    pin: false,
    projectBillingDetails: false,
    platform: "linux",
    scope,
  });
  return target.status(scope, env(), setup);
};

const registered = JSON.stringify({
  mcpServers: { [NAME]: { command: "npx", args: ["-y", NAME, "mcp"] } },
});

// [client, the project file's path inside the project]
const projectFiles: [McpClientId, string[]][] = [
  ["claude-code", [".mcp.json"]],
  ["cursor", [".cursor", "mcp.json"]],
  ["gemini", [".gemini", "settings.json"]],
];

describe.skipIf(isWindows)("project scope refuses a linked config", () => {
  it.each(projectFiles)(
    "%s: a config file that is a link is unreadable, names its target, and nothing is planned",
    async (client, parts) => {
      const target = join(elsewhere, "target.json");
      await fsp.writeFile(target, registered);
      const link = join(cwd, ...parts);
      await fsp.mkdir(join(link, ".."), { recursive: true });
      await fsp.symlink(target, link);

      expect(await status(client, "project")).toEqual({
        kind: "unreadable",
        message: expect.stringContaining(`${link} is a link to ${target}`),
      });

      const out: string[] = [];
      const runs: string[][] = [];
      const run = createSetupRunner(deps(out, runs));
      const base = {
        clients: { kind: "ids", ids: [client] },
        scope: "project",
        dryRun: false,
        yes: true,
      } as const;
      const installed = await run({
        kind: "mcp-install",
        pin: true,
        projectBillingDetails: false,
        ...base,
      });
      const uninstalled = await run({ kind: "mcp-uninstall", ...base });

      expect([installed, uninstalled]).toEqual([1, 1]);
      expect(runs).toEqual([]);
      expect(out.join("")).toContain(`is a link to ${target}`);
      expect(await fsp.readFile(target, "utf8")).toBe(registered);
    },
  );

  it.each(projectFiles.filter(([, parts]) => parts.length > 1))(
    "%s: a folder in the project that is a link is refused, even when the file is missing",
    async (client, parts) => {
      const folder = join(cwd, parts[0]!);
      await fsp.symlink(elsewhere, folder);

      expect(await status(client, "project")).toEqual({
        kind: "unreadable",
        message: expect.stringContaining(`${folder} is a link to ${elsewhere}`),
      });

      const out: string[] = [];
      const runs: string[][] = [];
      const code = await createSetupRunner(deps(out, runs))({
        kind: "mcp-install",
        clients: { kind: "ids", ids: [client] },
        scope: "project",
        pin: false,
        projectBillingDetails: false,
        dryRun: false,
        yes: true,
      });

      expect(code).toBe(1);
      expect(runs).toEqual([]);
      expect(await fsp.readdir(elsewhere)).toEqual([]);
    },
  );

  it("still follows a linked user-scope config", async () => {
    const target = join(elsewhere, "mcp.json");
    await fsp.writeFile(target, registered);
    await fsp.symlink(target, join(home, ".cursor", "mcp.json"));

    expect(await status("cursor", "user")).toMatchObject({
      kind: "registered",
    });
  });
});

describe.skipIf(isWindows)("status reads are bounded in every scope", () => {
  it("refuses a user config linked to /dev/zero instead of reading forever", async () => {
    await fsp.symlink("/dev/zero", join(home, ".claude.json"));

    expect(await status("claude-code", "user")).toEqual({
      kind: "unreadable",
      message: `${join(home, ".claude.json")} is not a regular file`,
    });
  });

  it("refuses a config larger than 10 MB", async () => {
    const file = join(home, ".cursor", "mcp.json");
    await fsp.writeFile(file, "");
    await fsp.truncate(file, 10 * 1024 * 1024 + 1);

    expect(await status("cursor", "user")).toEqual({
      kind: "unreadable",
      message: `${file} is larger than 10 MB, too large for a config file`,
    });
  });
});
