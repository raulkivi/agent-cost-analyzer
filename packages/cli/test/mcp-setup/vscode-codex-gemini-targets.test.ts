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
import type { ClientEnv } from "../../src/mcp-setup/client-env.js";
import { createClientTargets } from "../../src/mcp-setup/client-targets.js";
import { createConfigFileStore } from "../../src/mcp-setup/config-file-store.js";
import type { McpClientTarget } from "../../src/mcp-setup/mcp-client-target.js";
import { fakeEnv } from "./fake-client-env.js";

const NAME = "agent-cost-analyzer";
const REST = ["-y", "--prefer-offline"];
const LATEST = { command: "npx", args: [...REST, NAME, "mcp"] };
const PINNED = { command: "npx", args: [...REST, `${NAME}@0.9.0`, "mcp"] };

let root: string;
let home: string;
let cwd: string;
beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "aca-targets2-"));
  home = join(root, "home");
  cwd = join(root, "proj");
  await fsp.mkdir(home);
  await fsp.mkdir(cwd);
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

// Real fs over the temp home: the adapters under test read through the env.
function env(extra: Partial<ClientEnv> & { commands?: string[] } = {}) {
  return fakeEnv({
    home,
    cwd,
    exists: (p) =>
      fsp.access(p).then(
        () => true,
        () => false,
      ),
    readDir: (p) => fsp.readdir(p).catch(() => []),
    readText: (p) => fsp.readFile(p, "utf8").catch(() => undefined),
    ...extra,
  });
}

function target(id: McpClientId): McpClientTarget {
  const found = createClientTargets({ store: createConfigFileStore() }).find(
    (t) => t.id === id,
  );
  if (!found) throw new Error(`no target ${id}`);
  return found;
}

function setupFor(client: McpClientId, scope: McpScope = "user", pin = false) {
  return clientSetup(client, {
    version: "1.0.0",
    pin,
    projectBillingDetails: false,
    platform: "linux",
    scope,
  });
}

async function write(path: string, text: string): Promise<void> {
  await fsp.mkdir(dirname(path), { recursive: true });
  await fsp.writeFile(path, text);
}
const writeJson = (path: string, value: unknown) =>
  write(path, JSON.stringify(value, null, 2));

describe("vscode", () => {
  const userDir = () => join(home, ".config", "Code", "User");
  const file = () => join(userDir(), "mcp.json");
  const extDir = () => join(home, ".vscode", "extensions");

  it("is detected by the code command or the Code/User folder", async () => {
    const t = target("vscode");
    expect(await t.detect(env())).toBe(false);
    expect(await t.detect(env({ commands: ["code"] }))).toBe(true);
    await fsp.mkdir(userDir(), { recursive: true });
    expect(await t.detect(env())).toBe(true);
  });

  it("plans a merge under servers with the typed entry", async () => {
    await fsp.mkdir(userDir(), { recursive: true });
    const plan = await target("vscode").planInstall(setupFor("vscode"), env());
    expect(plan).toEqual({
      status: { kind: "not-registered" },
      actions: [
        {
          kind: "merge-json",
          path: file(),
          keyPath: ["servers"],
          name: NAME,
          entry: { type: "stdio", ...LATEST },
          replace: false,
        },
      ],
      needsConfirmation: false,
    });
  });

  it("never plans code --add-mcp", async () => {
    const plan = await target("vscode").planInstall(
      setupFor("vscode"),
      env({ commands: ["code"] }),
    );
    expect(plan.actions.some((a) => a.kind === "run")).toBe(false);
  });

  it("reads status from servers, not mcpServers", async () => {
    await writeJson(file(), {
      mcpServers: { [NAME]: PINNED },
      servers: { [NAME]: { type: "stdio", ...LATEST } },
    });
    const status = await target("vscode").status(
      "user",
      env(),
      setupFor("vscode"),
    );
    expect(status).toEqual({
      kind: "registered",
      launch: "latest",
      matches: true,
      existing: { type: "stdio", ...LATEST },
    });
  });

  it("plans a confirmed replace when the pin differs", async () => {
    await writeJson(file(), {
      servers: { [NAME]: { type: "stdio", ...LATEST } },
    });
    const plan = await target("vscode").planInstall(
      setupFor("vscode", "user", true),
      env(),
    );
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.actions).toMatchObject([{ kind: "merge-json", replace: true }]);
  });

  it("plans remove-json under servers on uninstall", async () => {
    await writeJson(file(), { servers: { [NAME]: LATEST, other: {} } });
    const plan = await target("vscode").planUninstall("user", env());
    expect(plan.actions).toEqual([
      { kind: "remove-json", path: file(), keyPath: ["servers"], name: NAME },
    ]);
  });

  it("defers to the extension: nothing planned, its own status kind", async () => {
    await fsp.mkdir(join(extDir(), "raulkivi.ai-credits-analyzer-0.14.0"), {
      recursive: true,
    });
    const t = target("vscode");
    const install = await t.planInstall(setupFor("vscode"), env());
    expect(install).toEqual({
      status: { kind: "provided-by-extension" },
      actions: [],
      needsConfirmation: false,
    });
    const uninstall = await t.planUninstall("user", env());
    expect(uninstall).toEqual({
      status: { kind: "provided-by-extension" },
      actions: [],
    });
  });

  it("ignores folders of other extensions", async () => {
    await fsp.mkdir(join(extDir(), "raulkivi.other-1.0.0"), {
      recursive: true,
    });
    await fsp.mkdir(userDir(), { recursive: true });
    const status = await target("vscode").status(
      "user",
      env(),
      setupFor("vscode"),
    );
    expect(status).toEqual({ kind: "not-registered" });
  });

  it("rejects a scope it does not support", async () => {
    await expect(
      target("vscode").status("project", env(), setupFor("vscode")),
    ).rejects.toThrow(/scope/);
  });
});

describe("vscode-insiders", () => {
  const userDir = () => join(home, ".config", "Code - Insiders", "User");
  const file = () => join(userDir(), "mcp.json");
  const extDir = () => join(home, ".vscode-insiders", "extensions");

  it("is detected by code-insiders or the Code - Insiders/User folder", async () => {
    const t = target("vscode-insiders");
    expect(await t.detect(env())).toBe(false);
    expect(await t.detect(env({ commands: ["code"] }))).toBe(false);
    expect(await t.detect(env({ commands: ["code-insiders"] }))).toBe(true);
    await fsp.mkdir(userDir(), { recursive: true });
    expect(await t.detect(env())).toBe(true);
  });

  it("is not detected by the stable VS Code folder", async () => {
    await fsp.mkdir(join(home, ".config", "Code", "User"), { recursive: true });
    expect(await target("vscode-insiders").detect(env())).toBe(false);
    expect(await target("vscode").detect(env())).toBe(true);
  });

  it("plans a merge under servers in its own mcp.json", async () => {
    await fsp.mkdir(userDir(), { recursive: true });
    const plan = await target("vscode-insiders").planInstall(
      setupFor("vscode-insiders"),
      env(),
    );
    expect(plan).toEqual({
      status: { kind: "not-registered" },
      actions: [
        {
          kind: "merge-json",
          path: file(),
          keyPath: ["servers"],
          name: NAME,
          entry: { type: "stdio", ...LATEST },
          replace: false,
        },
      ],
      needsConfirmation: false,
    });
  });

  it("reads status from its own file, not the stable one", async () => {
    await writeJson(join(home, ".config", "Code", "User", "mcp.json"), {
      servers: { [NAME]: { type: "stdio", ...LATEST } },
    });
    await writeJson(file(), {
      servers: { [NAME]: { type: "stdio", ...PINNED } },
    });
    const status = await target("vscode-insiders").status(
      "user",
      env(),
      setupFor("vscode-insiders"),
    );
    expect(status).toEqual({
      kind: "registered",
      launch: { pinned: "0.9.0" },
      matches: false,
      existing: { type: "stdio", ...PINNED },
    });
  });

  it("defers to the extension in the Insiders extensions folder only", async () => {
    await fsp.mkdir(join(extDir(), "raulkivi.ai-credits-analyzer-0.14.0"), {
      recursive: true,
    });
    const t = target("vscode-insiders");
    expect(await t.planInstall(setupFor("vscode-insiders"), env())).toEqual({
      status: { kind: "provided-by-extension" },
      actions: [],
      needsConfirmation: false,
    });
    const stable = await target("vscode").planInstall(
      setupFor("vscode"),
      env(),
    );
    expect(stable.status).not.toEqual({ kind: "provided-by-extension" });
  });

  it("plans remove-json under servers on uninstall", async () => {
    await writeJson(file(), { servers: { [NAME]: LATEST, other: {} } });
    const plan = await target("vscode-insiders").planUninstall("user", env());
    expect(plan.actions).toEqual([
      { kind: "remove-json", path: file(), keyPath: ["servers"], name: NAME },
    ]);
  });
});

describe("codex", () => {
  const dir = () => join(home, ".codex");
  const file = () => join(dir(), "config.toml");
  const body = (name = NAME) =>
    `command = "npx"\nargs = ["-y", "--prefer-offline", "${name}", "mcp"]\n`;
  const table = `[mcp_servers.${NAME}]\n${body()}`;

  it("is detected by the codex command or its home folder", async () => {
    const t = target("codex");
    expect(await t.detect(env())).toBe(false);
    expect(await t.detect(env({ commands: ["codex"] }))).toBe(true);
    await fsp.mkdir(dir());
    expect(await t.detect(env())).toBe(true);
  });

  it("honors CODEX_HOME", async () => {
    const custom = join(root, "codex-home");
    await write(join(custom, "config.toml"), table);
    const status = await target("codex").status(
      "user",
      env({ env: { CODEX_HOME: custom } }),
      setupFor("codex"),
    );
    expect(status.kind).toBe("registered");
  });

  it("plans the codex mcp add command when the table is absent", async () => {
    await write(file(), 'model = "x"\n[mcp_servers.other]\ncommand = "y"\n');
    const setup = setupFor("codex");
    const plan = await target("codex").planInstall(setup, env());
    expect(plan).toEqual({
      status: { kind: "not-registered" },
      actions: [{ kind: "run", file: "codex", args: setup.command!.slice(1) }],
      needsConfirmation: false,
    });
  });

  it("plans add when the config file does not exist yet", async () => {
    const plan = await target("codex").planInstall(
      setupFor("codex"),
      env({ commands: ["codex"] }),
    );
    expect(plan.status).toEqual({ kind: "not-registered" });
    expect(plan.actions).toHaveLength(1);
  });

  it.each([
    ["bare", `[mcp_servers.${NAME}]`],
    ["quoted", `[mcp_servers."${NAME}"]`],
    ["spaced", `  [ mcp_servers . ${NAME} ]  # mine`],
  ])("finds a %s table header", async (_n, header) => {
    await write(file(), `${header}\n${body()}`);
    const status = await target("codex").status(
      "user",
      env(),
      setupFor("codex"),
    );
    expect(status).toEqual({
      kind: "registered",
      launch: "latest",
      matches: true,
      existing: LATEST,
    });
  });

  it("ignores a commented-out header and a similar server name", async () => {
    await write(
      file(),
      `# [mcp_servers.${NAME}]\n[mcp_servers.${NAME}-2]\ncommand = "x"\n`,
    );
    const status = await target("codex").status(
      "user",
      env(),
      setupFor("codex"),
    );
    expect(status).toEqual({ kind: "not-registered" });
  });

  it("classifies a pinned table and flags it as different", async () => {
    await write(file(), `[mcp_servers.${NAME}]\n${body(`${NAME}@0.9.0`)}`);
    const status = await target("codex").status(
      "user",
      env(),
      setupFor("codex"),
    );
    expect(status).toEqual({
      kind: "registered",
      launch: { pinned: "0.9.0" },
      matches: false,
      existing: PINNED,
    });
  });

  it("reads only its own table, not the next one", async () => {
    await write(
      file(),
      `[mcp_servers.${NAME}]\ncommand = "npx"\n[mcp_servers.z]\nargs = ["a"]\n`,
    );
    const status = await target("codex").status(
      "user",
      env(),
      setupFor("codex"),
    );
    expect(status).toEqual({
      kind: "registered-unverified",
      existing: { command: "npx" },
    });
  });

  it("reports registered-unverified when args span lines", async () => {
    await write(
      file(),
      `[mcp_servers.${NAME}]\ncommand = "npx"\nargs = [\n  "-y",\n  "${NAME}",\n]\n`,
    );
    const status = await target("codex").status(
      "user",
      env(),
      setupFor("codex"),
    );
    expect(status).toEqual({
      kind: "registered-unverified",
      existing: { command: "npx" },
    });
  });

  // MC9 review R6: a status read must finish, whatever the path holds.
  it("reports unreadable when config.toml cannot be read safely", async () => {
    const status = await target("codex").status(
      "user",
      env({
        commands: ["codex"],
        readText: async (p) => {
          throw new Error(`${p} is not a regular file`);
        },
      }),
      setupFor("codex"),
    );
    expect(status).toEqual({
      kind: "unreadable",
      message: `${file()} is not a regular file`,
    });
  });

  it("plans nothing when registered, even with a different pin", async () => {
    await write(file(), `[mcp_servers.${NAME}]\n${body(`${NAME}@0.9.0`)}`);
    const plan = await target("codex").planInstall(setupFor("codex"), env());
    expect(plan.status.kind).toBe("registered");
    expect(plan.actions).toEqual([]);
    expect(plan.needsConfirmation).toBe(false);
  });

  it("plans a note with the file and the exact table on uninstall", async () => {
    await write(file(), table);
    const plan = await target("codex").planUninstall("user", env());
    const toml = setupFor("codex").toml!;
    expect(plan.actions).toHaveLength(1);
    const action = plan.actions[0]!;
    expect(action.kind).toBe("note");
    if (action.kind !== "note") return;
    expect(action.text).toContain(file());
    expect(action.text).toContain(toml.trimEnd());
  });

  it("plans nothing on uninstall when not registered", async () => {
    const plan = await target("codex").planUninstall("user", env());
    expect(plan).toEqual({ status: { kind: "not-detected" }, actions: [] });
  });
});

describe("gemini", () => {
  const userFile = () => join(home, ".gemini", "settings.json");
  const projectFile = () => join(cwd, ".gemini", "settings.json");

  it("is detected by the gemini command or ~/.gemini", async () => {
    const t = target("gemini");
    expect(await t.detect(env())).toBe(false);
    expect(await t.detect(env({ commands: ["gemini"] }))).toBe(true);
    await fsp.mkdir(join(home, ".gemini"));
    expect(await t.detect(env())).toBe(true);
  });

  it("plans the add command for the scope when not registered", async () => {
    const setup = setupFor("gemini", "project");
    const plan = await target("gemini").planInstall(
      setup,
      env({ commands: ["gemini"] }),
    );
    expect(plan).toEqual({
      status: { kind: "not-registered" },
      actions: [{ kind: "run", file: "gemini", args: setup.command!.slice(1) }],
      needsConfirmation: false,
    });
  });

  it("reads user scope from home and project scope from cwd", async () => {
    await writeJson(userFile(), { mcpServers: { [NAME]: LATEST } });
    await writeJson(projectFile(), { mcpServers: { [NAME]: PINNED } });
    const t = target("gemini");
    const e = env({ commands: ["gemini"] });
    expect(await t.status("user", e, setupFor("gemini"))).toEqual({
      kind: "registered",
      launch: "latest",
      matches: true,
      existing: LATEST,
    });
    expect(await t.status("project", e, setupFor("gemini", "project"))).toEqual(
      {
        kind: "registered",
        launch: { pinned: "0.9.0" },
        matches: false,
        existing: PINNED,
      },
    );
  });

  it("plans remove then add behind a confirmation when the pin differs", async () => {
    await writeJson(userFile(), { mcpServers: { [NAME]: PINNED } });
    const setup = setupFor("gemini");
    const plan = await target("gemini").planInstall(
      setup,
      env({ commands: ["gemini"] }),
    );
    expect(plan.needsConfirmation).toBe(true);
    expect(plan.actions).toEqual([
      { kind: "run", file: "gemini", args: setup.remove!.slice(1) },
      {
        kind: "run",
        file: "gemini",
        args: setup.command!.slice(1),
        onFailure:
          `${NAME} is no longer registered in Gemini CLI: its old entry was removed, then the add failed.\n` +
          `To restore the old entry, put it back under "mcpServers" in ${userFile()}:\n` +
          `  "${NAME}": ${JSON.stringify(PINNED)}`,
      },
    ]);
  });

  it("plans nothing when the entry already matches", async () => {
    await writeJson(userFile(), { mcpServers: { [NAME]: LATEST } });
    const plan = await target("gemini").planInstall(
      setupFor("gemini"),
      env({ commands: ["gemini"] }),
    );
    expect(plan.actions).toEqual([]);
  });

  it("plans remove for the scope on uninstall only when registered", async () => {
    const t = target("gemini");
    const e = env({ commands: ["gemini"] });
    expect((await t.planUninstall("project", e)).actions).toEqual([]);
    await writeJson(projectFile(), { mcpServers: { [NAME]: LATEST } });
    const remove = setupFor("gemini", "project").remove!;
    expect((await t.planUninstall("project", e)).actions).toEqual([
      { kind: "run", file: "gemini", args: remove.slice(1) },
    ]);
  });

  it("reports unreadable for an invalid settings file", async () => {
    await write(userFile(), "{");
    const plan = await target("gemini").planInstall(
      setupFor("gemini"),
      env({ commands: ["gemini"] }),
    );
    expect(plan.status.kind).toBe("unreadable");
    expect(plan.actions).toEqual([]);
  });

  it("rejects the local scope", async () => {
    await expect(
      target("gemini").status("local", env(), setupFor("cursor")),
    ).rejects.toThrow(/scope/);
  });
});
