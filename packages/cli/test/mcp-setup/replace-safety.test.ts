// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpClientId } from "../../../server/src/mcp/client-setup/client-setup.js";
import { createClientTargets } from "../../src/mcp-setup/client-targets.js";
import type { CommandResult } from "../../src/mcp-setup/command-runner.js";
import {
  BACKUP_SUFFIX,
  createConfigFileStore,
} from "../../src/mcp-setup/config-file-store.js";
import { createSetupRunner } from "../../src/mcp-setup/setup-runner.js";
import { fakeEnv } from "./fake-client-env.js";

// MC9 review R5: a replace shows the old and the new entry in full, and a
// CLI client's failed add after its remove says how to restore the old one.
// Real adapters and the real store over a temporary home; commands are
// recorded, never run.

const NAME = "agent-cost-analyzer";
const OWN = { command: "node", args: ["/x/server.js"] };
const NEW = {
  command: "npx",
  args: ["-y", "--prefer-offline", NAME, "mcp"],
};

let root: string;
let home: string;
let cwd: string;
beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "aca-replace-"));
  home = join(root, "home");
  cwd = join(root, "proj");
  await fsp.mkdir(home);
  await fsp.mkdir(cwd);
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await fsp.mkdir(dirname(path), { recursive: true });
  await fsp.writeFile(path, JSON.stringify(value, null, 2));
}

interface Run {
  code: number;
  out: string;
  err: string;
  runs: string[][];
}

async function install(
  client: McpClientId,
  opts: { yes?: boolean; fail?: (argv: string[]) => string | undefined } = {},
): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const runs: string[][] = [];
  const store = createConfigFileStore();
  const code = await createSetupRunner({
    targets: createClientTargets({ store }),
    store,
    runner: {
      run: async (file, args): Promise<CommandResult> => {
        const argv = [file, ...args];
        runs.push(argv);
        const failure = opts.fail?.(argv);
        return failure === undefined
          ? { ok: true }
          : { ok: false, message: failure };
      },
    },
    env: fakeEnv({
      home,
      cwd,
      commands: ["claude", "gemini"],
      exists: (path) =>
        fsp.access(path).then(
          () => true,
          () => false,
        ),
    }),
    version: "1.0.0",
    io: {
      out: (t) => void out.push(t),
      err: (t) => void err.push(t),
      interactive: false,
      confirm: async () => false,
    },
  })({
    kind: "mcp-install",
    clients: { kind: "ids", ids: [client] },
    scope: "user",
    pin: false,
    projectBillingDetails: false,
    dryRun: !opts.yes,
    yes: opts.yes ?? false,
  });
  return { code, out: out.join(""), err: err.join(""), runs };
}

const failAdd = (argv: string[]) =>
  argv.includes("add") ? "exit code 1: boom" : undefined;

describe("a replace shows the old and the new entry", () => {
  it("prints both in full for a JSON client and names the backup", async () => {
    const file = join(home, ".cursor", "mcp.json");
    await writeJson(file, { mcpServers: { [NAME]: OWN } });

    const run = await install("cursor");

    expect(run.out).toContain(
      `This replaces your existing entry; the file is backed up to ${file}${BACKUP_SUFFIX} first.\n` +
        `    old: ${JSON.stringify(OWN)}\n` +
        `    new: ${JSON.stringify(NEW)}\n`,
    );
    expect(run.out).not.toContain("differs: differs");
  });

  it("keeps the old entry in the backup when the replace is applied", async () => {
    const file = join(home, ".cursor", "mcp.json");
    await writeJson(file, { mcpServers: { [NAME]: OWN } });

    const run = await install("cursor", { yes: true });

    expect(run.code).toBe(0);
    expect(run.out).toContain(`backup: ${file}${BACKUP_SUFFIX}`);
    const backup = JSON.parse(await fsp.readFile(file + BACKUP_SUFFIX, "utf8"));
    expect(backup.mcpServers[NAME]).toEqual(OWN);
  });

  it("prints Claude Code's entry as read and says it keeps no backup", async () => {
    const own = { type: "stdio", ...OWN, env: { TOKEN: "t" } };
    await writeJson(join(home, ".claude.json"), {
      mcpServers: { [NAME]: own },
    });

    const run = await install("claude-code");

    expect(run.out).toContain(
      "This replaces your existing entry. Claude Code keeps no backup; " +
        "if the add fails, how to restore it is printed.\n" +
        `    old: ${JSON.stringify(own)}\n` +
        `    new: ${JSON.stringify(NEW)}\n`,
    );
    expect(run.runs).toEqual([]);
  });
});

describe("a failed add after the remove", () => {
  it("says Claude Code lost the entry and prints the add-json command to restore it", async () => {
    const own = { type: "stdio", ...OWN, env: {} };
    await writeJson(join(home, ".claude.json"), {
      mcpServers: { [NAME]: own },
    });

    const run = await install("claude-code", { yes: true, fail: failAdd });

    expect(run.code).toBe(1);
    expect(run.runs.map((argv) => argv.slice(0, 3))).toEqual([
      ["claude", "mcp", "remove"],
      ["claude", "mcp", "add"],
    ]);
    expect(run.err).toBe(
      "Claude Code: failed: exit code 1: boom\n" +
        `  ${NAME} is no longer registered in Claude Code: its old entry was removed, then the add failed.\n` +
        "  To restore the old entry, run:\n" +
        `    claude mcp add-json --scope user ${NAME} '${JSON.stringify(own)}'\n`,
    );
  });

  it("says Gemini CLI lost the entry and where to put the old JSON back", async () => {
    const file = join(home, ".gemini", "settings.json");
    await writeJson(file, { mcpServers: { [NAME]: OWN } });

    const run = await install("gemini", { yes: true, fail: failAdd });

    expect(run.code).toBe(1);
    expect(run.err).toBe(
      "Gemini CLI: failed: exit code 1: boom\n" +
        `  ${NAME} is no longer registered in Gemini CLI: its old entry was removed, then the add failed.\n` +
        `  To restore the old entry, put it back under "mcpServers" in ${file}:\n` +
        `    "${NAME}": ${JSON.stringify(OWN)}\n`,
    );
  });

  it("says nothing about restoring when the remove itself fails", async () => {
    await writeJson(join(home, ".claude.json"), {
      mcpServers: { [NAME]: OWN },
    });

    const run = await install("claude-code", {
      yes: true,
      fail: (argv) => (argv.includes("remove") ? "exit code 1: no" : undefined),
    });

    expect(run.code).toBe(1);
    expect(run.runs).toHaveLength(1);
    expect(run.err).toBe("Claude Code: failed: exit code 1: no\n");
  });
});
