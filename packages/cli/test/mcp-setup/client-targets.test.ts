// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clientSetup,
  type McpClientId,
  type McpScope,
} from "../../../server/src/mcp/client-setup/client-setup.js";
import { createConfigFileStore } from "../../src/mcp-setup/config-file-store.js";
import type { ClientEnv } from "../../src/mcp-setup/client-env.js";
import { createClientTargets } from "../../src/mcp-setup/client-targets.js";
import type { McpClientTarget } from "../../src/mcp-setup/mcp-client-target.js";
import { fakeEnv } from "./fake-client-env.js";

const NAME = "agent-cost-analyzer";
const REST = ["-y", "--prefer-offline"];
const LATEST = { command: "npx", args: [...REST, NAME, "mcp"] };
const PINNED = { command: "npx", args: [...REST, `${NAME}@0.9.0`, "mcp"] };
const WRAPPED = {
  command: "cmd",
  args: ["/c", "npx", ...REST, `${NAME}@1.0.0`, "mcp"],
};

let root: string;
let home: string;
let cwd: string;
beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "aca-targets-"));
  home = join(root, "home");
  cwd = join(root, "proj");
  await fsp.mkdir(home);
  await fsp.mkdir(cwd);
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

const realExists = (path: string) =>
  fsp.access(path).then(
    () => true,
    () => false,
  );

function env(extra: Partial<ClientEnv> & { commands?: string[] } = {}) {
  return fakeEnv({ home, cwd, exists: realExists, ...extra });
}

function target(id: McpClientId): McpClientTarget {
  const found = createClientTargets({ store: createConfigFileStore() }).find(
    (t) => t.id === id,
  );
  if (!found) throw new Error(`no target ${id}`);
  return found;
}

function setupFor(
  client: McpClientId,
  scope: McpScope = "user",
  opts: { pin?: boolean; platform?: NodeJS.Platform } = {},
) {
  return clientSetup(client, {
    version: "1.0.0",
    pin: opts.pin ?? false,
    projectBillingDetails: false,
    platform: opts.platform ?? "linux",
    scope,
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fsp.mkdir(dirname(path), { recursive: true });
  await fsp.writeFile(path, JSON.stringify(value, null, 2));
}

const withType = (e: object) => ({ type: "stdio", ...e, env: {} });

describe("createClientTargets", () => {
  it("lists every client in MCP_CLIENT_IDS order with labels", () => {
    const targets = createClientTargets({ store: createConfigFileStore() });
    expect(targets.map((t) => t.id)).toEqual([
      "claude-code",
      "claude-desktop",
      "cursor",
      "vscode",
      "vscode-insiders",
      "codex",
      "gemini",
    ]);
    expect(targets.every((t) => t.label.length > 0)).toBe(true);
  });
});

describe("claude-code", () => {
  const userFile = () => join(home, ".claude.json");

  it("is detected when claude is on PATH", async () => {
    const t = target("claude-code");
    expect(await t.detect(env({ commands: ["claude"] }))).toBe(true);
    expect(await t.detect(env())).toBe(false);
  });

  it("reports not-detected and plans nothing without the CLI", async () => {
    const t = target("claude-code");
    const plan = await t.planInstall(setupFor("claude-code"), env());
    expect(plan).toEqual({
      status: { kind: "not-detected" },
      actions: [],
      needsConfirmation: false,
    });
  });

  it("plans a plain add when the config file does not exist", async () => {
    const setup = setupFor("claude-code");
    const plan = await target("claude-code").planInstall(
      setup,
      env({ commands: ["claude"] }),
    );
    expect(plan.status).toEqual({ kind: "not-registered" });
    expect(plan.needsConfirmation).toBe(false);
    expect(plan.actions).toEqual([
      { kind: "run", file: "claude", args: setup.command!.slice(1) },
    ]);
  });

  it("is not registered when the file has other keys but not the server", async () => {
    await writeJson(userFile(), { numStartups: 3, mcpServers: { other: {} } });
    const status = await target("claude-code").status(
      "user",
      env({ commands: ["claude"] }),
      setupFor("claude-code"),
    );
    expect(status).toEqual({ kind: "not-registered" });
  });

  it("reads user scope from the top-level mcpServers and ignores type and env", async () => {
    await writeJson(userFile(), {
      numStartups: 3,
      projects: {},
      mcpServers: { [NAME]: withType(LATEST) },
    });
    const plan = await target("claude-code").planInstall(
      setupFor("claude-code"),
      env({ commands: ["claude"] }),
    );
    expect(plan).toEqual({
      status: { kind: "registered", launch: "latest", matches: true },
      actions: [],
      needsConfirmation: false,
    });
  });

  it("plans remove then add behind a confirmation when the pin differs", async () => {
    await writeJson(userFile(), {
      mcpServers: { [NAME]: withType(PINNED) },
    });
    const setup = setupFor("claude-code");
    const plan = await target("claude-code").planInstall(
      setup,
      env({ commands: ["claude"] }),
    );
    expect(plan.status).toEqual({
      kind: "registered",
      launch: { pinned: "0.9.0" },
      matches: false,
    });
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.actions).toEqual([
      { kind: "run", file: "claude", args: setup.remove!.slice(1) },
      { kind: "run", file: "claude", args: setup.command!.slice(1) },
    ]);
  });

  it("matches the cmd /c wrapper that Claude Code gets on Windows", async () => {
    await writeJson(userFile(), {
      mcpServers: { [NAME]: withType(WRAPPED) },
    });
    const setup = setupFor("claude-code", "user", {
      pin: true,
      platform: "win32",
    });
    const status = await target("claude-code").status(
      "user",
      env({ commands: ["claude"] }),
      setup,
    );
    expect(status).toEqual({
      kind: "registered",
      launch: { pinned: "1.0.0" },
      matches: true,
    });
  });

  it("reads local scope from the project entry keyed by cwd", async () => {
    await writeJson(userFile(), {
      mcpServers: { [NAME]: withType(PINNED) },
      projects: {
        [cwd]: { allowedTools: [], mcpServers: { [NAME]: withType(LATEST) } },
        "/elsewhere": { mcpServers: {} },
      },
    });
    const status = await target("claude-code").status(
      "local",
      env({ commands: ["claude"] }),
      setupFor("claude-code", "local"),
    );
    expect(status).toEqual({
      kind: "registered",
      launch: "latest",
      matches: true,
    });
  });

  it("reads project scope from .mcp.json in the working folder", async () => {
    await writeJson(join(cwd, ".mcp.json"), {
      mcpServers: { [NAME]: withType(PINNED) },
    });
    const status = await target("claude-code").status(
      "project",
      env({ commands: ["claude"] }),
      setupFor("claude-code", "project"),
    );
    expect(status).toEqual({
      kind: "registered",
      launch: { pinned: "0.9.0" },
      matches: false,
    });
  });

  it("treats a custom launch as registered but not matching", async () => {
    await writeJson(userFile(), {
      mcpServers: { [NAME]: { command: "node", args: ["/x/server.js"] } },
    });
    const status = await target("claude-code").status(
      "user",
      env({ commands: ["claude"] }),
      setupFor("claude-code"),
    );
    expect(status).toEqual({
      kind: "registered",
      launch: "custom",
      matches: false,
    });
  });

  it("reports unreadable for invalid JSON and plans nothing", async () => {
    await fsp.writeFile(userFile(), "{ not json");
    const plan = await target("claude-code").planInstall(
      setupFor("claude-code"),
      env({ commands: ["claude"] }),
    );
    expect(plan.status.kind).toBe("unreadable");
    expect(plan.actions).toEqual([]);
    expect(plan.needsConfirmation).toBe(false);
  });

  it("reports unreadable when a key on the way is not an object", async () => {
    await writeJson(userFile(), { mcpServers: [] });
    const status = await target("claude-code").status(
      "user",
      env({ commands: ["claude"] }),
      setupFor("claude-code"),
    );
    expect(status).toMatchObject({ kind: "unreadable" });
  });

  it("uninstalls with claude mcp remove when registered", async () => {
    await writeJson(userFile(), { mcpServers: { [NAME]: withType(LATEST) } });
    const plan = await target("claude-code").planUninstall(
      "user",
      env({ commands: ["claude"] }),
    );
    expect(plan.status.kind).toBe("registered");
    expect(plan.actions).toEqual([
      {
        kind: "run",
        file: "claude",
        args: ["mcp", "remove", "--scope", "user", NAME],
      },
    ]);
  });

  it("plans nothing to uninstall when absent, since claude exits 1", async () => {
    const plan = await target("claude-code").planUninstall(
      "project",
      env({ commands: ["claude"] }),
    );
    expect(plan).toEqual({
      status: { kind: "not-registered" },
      actions: [],
    });
  });

  it("rejects a scope the client does not support", async () => {
    await expect(
      target("claude-desktop").status("local", env(), setupFor("cursor")),
    ).rejects.toThrow(/scope/);
  });
});

describe("claude-desktop", () => {
  const dir = () => join(home, ".config", "Claude");
  const file = () => join(dir(), "claude_desktop_config.json");
  const restart = {
    kind: "note",
    text: "Restart Claude Desktop to load the server.",
  };

  it("is detected when the config folder exists", async () => {
    const t = target("claude-desktop");
    expect(await t.detect(env())).toBe(false);
    await fsp.mkdir(dir(), { recursive: true });
    expect(await t.detect(env())).toBe(true);
  });

  it("plans a merge and a restart note when not registered", async () => {
    await writeJson(file(), { preferences: { menuBarEnabled: false } });
    const setup = setupFor("claude-desktop");
    const plan = await target("claude-desktop").planInstall(setup, env());
    expect(plan).toEqual({
      status: { kind: "not-registered" },
      actions: [
        {
          kind: "merge-json",
          path: file(),
          keyPath: ["mcpServers"],
          name: NAME,
          entry: setup.json!.entry,
          replace: false,
        },
        restart,
      ],
      needsConfirmation: false,
    });
  });

  it("plans a merge into a folder whose file is missing", async () => {
    await fsp.mkdir(dir(), { recursive: true });
    const plan = await target("claude-desktop").planInstall(
      setupFor("claude-desktop"),
      env(),
    );
    expect(plan.status).toEqual({ kind: "not-registered" });
    expect(plan.actions[0]).toMatchObject({
      kind: "merge-json",
      replace: false,
    });
  });

  it("plans nothing when the entry already matches", async () => {
    await writeJson(file(), { mcpServers: { [NAME]: LATEST } });
    const plan = await target("claude-desktop").planInstall(
      setupFor("claude-desktop"),
      env(),
    );
    expect(plan).toEqual({
      status: { kind: "registered", launch: "latest", matches: true },
      actions: [],
      needsConfirmation: false,
    });
  });

  it("replaces a different entry after confirmation", async () => {
    await writeJson(file(), { mcpServers: { [NAME]: PINNED } });
    const plan = await target("claude-desktop").planInstall(
      setupFor("claude-desktop"),
      env(),
    );
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.actions).toHaveLength(2);
    expect(plan.actions[0]).toMatchObject({
      kind: "merge-json",
      replace: true,
    });
    expect(plan.actions[1]).toEqual(restart);
  });

  it("reads APPDATA on Windows paths without touching the host layout", async () => {
    const t = target("claude-desktop");
    const winEnv = fakeEnv({
      platform: "win32",
      home: "C:\\Users\\u",
      env: { APPDATA: "C:\\Roaming" },
      paths: ["C:\\Roaming\\Claude"],
    });
    expect(await t.detect(winEnv)).toBe(true);
  });

  it("is not detected and plans nothing without the folder", async () => {
    const plan = await target("claude-desktop").planInstall(
      setupFor("claude-desktop"),
      env(),
    );
    expect(plan.status).toEqual({ kind: "not-detected" });
    expect(plan.actions).toEqual([]);
  });

  it("reports unreadable for invalid JSON and plans nothing", async () => {
    await fsp.mkdir(dir(), { recursive: true });
    await fsp.writeFile(file(), "oops");
    const plan = await target("claude-desktop").planInstall(
      setupFor("claude-desktop"),
      env(),
    );
    expect(plan.status.kind).toBe("unreadable");
    expect(plan.actions).toEqual([]);
  });

  it("plans remove-json and a restart note on uninstall", async () => {
    await writeJson(file(), { mcpServers: { [NAME]: LATEST } });
    const plan = await target("claude-desktop").planUninstall("user", env());
    expect(plan.actions).toEqual([
      {
        kind: "remove-json",
        path: file(),
        keyPath: ["mcpServers"],
        name: NAME,
      },
      restart,
    ]);
  });

  it("plans nothing to uninstall when the entry is absent", async () => {
    await writeJson(file(), { mcpServers: {} });
    const plan = await target("claude-desktop").planUninstall("user", env());
    expect(plan).toEqual({
      status: { kind: "not-registered" },
      actions: [],
    });
  });
});

describe("cursor", () => {
  const userFile = () => join(home, ".cursor", "mcp.json");
  const projectFile = () => join(cwd, ".cursor", "mcp.json");
  const other = { command: "node", args: ["other.js"] };

  it("is detected by ~/.cursor or by cursor on PATH", async () => {
    const t = target("cursor");
    expect(await t.detect(env())).toBe(false);
    expect(await t.detect(env({ commands: ["cursor"] }))).toBe(true);
    await fsp.mkdir(join(home, ".cursor"));
    expect(await t.detect(env())).toBe(true);
  });

  it("merges beside another server in the user file", async () => {
    await writeJson(userFile(), { mcpServers: { other } });
    const setup = setupFor("cursor");
    const plan = await target("cursor").planInstall(setup, env());
    expect(plan).toEqual({
      status: { kind: "not-registered" },
      actions: [
        {
          kind: "merge-json",
          path: userFile(),
          keyPath: ["mcpServers"],
          name: NAME,
          entry: setup.json!.entry,
          replace: false,
        },
      ],
      needsConfirmation: false,
    });
  });

  it("targets .cursor/mcp.json in the working folder for project scope", async () => {
    await fsp.mkdir(join(home, ".cursor"));
    await writeJson(projectFile(), { mcpServers: { [NAME]: PINNED } });
    const plan = await target("cursor").planInstall(
      setupFor("cursor", "project"),
      env(),
    );
    expect(plan.status).toEqual({
      kind: "registered",
      launch: { pinned: "0.9.0" },
      matches: false,
    });
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.actions).toEqual([
      expect.objectContaining({
        kind: "merge-json",
        path: projectFile(),
        replace: true,
      }),
    ]);
  });

  it("plans nothing when the entry already matches", async () => {
    await writeJson(userFile(), { mcpServers: { [NAME]: LATEST, other } });
    const plan = await target("cursor").planInstall(setupFor("cursor"), env());
    expect(plan.actions).toEqual([]);
    expect(plan.status).toEqual({
      kind: "registered",
      launch: "latest",
      matches: true,
    });
  });

  it("reports unreadable for an invalid file and plans nothing", async () => {
    await fsp.mkdir(join(home, ".cursor"));
    await fsp.writeFile(userFile(), "{");
    const plan = await target("cursor").planInstall(setupFor("cursor"), env());
    expect(plan.status.kind).toBe("unreadable");
    expect(plan.actions).toEqual([]);
  });

  it("plans remove-json on uninstall without a restart note", async () => {
    await writeJson(projectFile(), { mcpServers: { [NAME]: LATEST } });
    await fsp.mkdir(join(home, ".cursor"));
    const plan = await target("cursor").planUninstall("project", env());
    expect(plan.actions).toEqual([
      {
        kind: "remove-json",
        path: projectFile(),
        keyPath: ["mcpServers"],
        name: NAME,
      },
    ]);
  });
});
