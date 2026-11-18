// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { changeCommand } from "../../src/mcp-setup/change-command.js";
import type { SetupAction } from "../../src/mcp-setup/mcp-client-target.js";
import type {
  InstallCommand,
  UninstallCommand,
} from "../../src/mcp-setup/setup-args.js";
import { fakeTarget, harness } from "./fake-setup-deps.js";

const install = (over: Partial<InstallCommand> = {}): InstallCommand => ({
  kind: "mcp-install",
  clients: { kind: "ids", ids: ["claude-code"] },
  scope: "user",
  pin: false,
  projectBillingDetails: false,
  dryRun: false,
  yes: false,
  ...over,
});
const uninstall = (over: Partial<UninstallCommand> = {}): UninstallCommand => ({
  kind: "mcp-uninstall",
  clients: { kind: "ids", ids: ["claude-code"] },
  scope: "user",
  dryRun: false,
  yes: false,
  ...over,
});

const add: SetupAction = {
  kind: "run",
  file: "claude",
  args: ["mcp", "add", "--scope", "user", "agent-cost-analyzer", "--", "npx"],
};
const merge: SetupAction = {
  kind: "merge-json",
  path: "/h/.cursor/mcp.json",
  keyPath: ["mcpServers"],
  name: "agent-cost-analyzer",
  entry: { command: "npx" },
  replace: false,
};
const planning = (...actions: SetupAction[]) => ({
  install: { actions },
});
const text = (lines: string[]) => lines.join("");

describe("install: plan and prompt", () => {
  it("prints the plan, asks once and applies on yes", async () => {
    const h = harness([
      fakeTarget("claude-code", { label: "Claude Code", ...planning(add) }),
    ]);
    expect(await changeCommand(install(), h.deps)).toBe(0);
    expect(text(h.out)).toContain("Claude Code (user scope): not registered");
    expect(text(h.out)).toContain(
      "run: claude mcp add --scope user agent-cost-analyzer -- npx",
    );
    expect(h.asked).toEqual(["Apply these changes? [y/N] "]);
    expect(h.runs).toHaveLength(1);
    expect(text(h.out)).toContain("Claude Code: done");
  });

  it("does nothing when the answer is no", async () => {
    const h = harness([fakeTarget("claude-code", planning(add))], {
      answer: false,
    });
    expect(await changeCommand(install(), h.deps)).toBe(0);
    expect(h.runs).toEqual([]);
  });

  it("--yes skips the prompt", async () => {
    const h = harness([fakeTarget("claude-code", planning(add))]);
    expect(await changeCommand(install({ yes: true }), h.deps)).toBe(0);
    expect(h.asked).toEqual([]);
    expect(h.runs).toHaveLength(1);
  });

  it("--dry-run prints the plan and applies nothing", async () => {
    const h = harness([fakeTarget("claude-code", planning(add))]);
    expect(await changeCommand(install({ dryRun: true }), h.deps)).toBe(0);
    expect(h.asked).toEqual([]);
    expect(h.runs).toEqual([]);
    expect(text(h.out)).toContain("Dry run");
  });

  it("refuses to apply without a terminal or --yes", async () => {
    const h = harness([fakeTarget("claude-code", planning(add))], {
      interactive: false,
    });
    expect(await changeCommand(install(), h.deps)).toBe(1);
    expect(text(h.err)).toContain("--yes");
    expect(h.runs).toEqual([]);
  });

  it("applies without a terminal when --yes is given", async () => {
    const h = harness([fakeTarget("claude-code", planning(add))], {
      interactive: false,
    });
    expect(await changeCommand(install({ yes: true }), h.deps)).toBe(0);
    expect(h.runs).toHaveLength(1);
  });

  it("flags a replacing plan and shows how it differs", async () => {
    const h = harness([
      fakeTarget("cursor", {
        install: {
          status: { kind: "registered", launch: "latest", matches: false },
          needsConfirmation: true,
          actions: [{ ...merge, replace: true }],
        },
      }),
    ]);
    await changeCommand(
      install({
        clients: { kind: "ids", ids: ["cursor"] },
        pin: true,
        dryRun: true,
      }),
      h.deps,
    );
    expect(text(h.out)).toContain(
      "replace agent-cost-analyzer in /h/.cursor/mcp.json (differs: latest → pinned 1.2.3)",
    );
    expect(text(h.out)).toContain("replaces your existing entry");
  });

  it("says already registered and asks nothing", async () => {
    const h = harness([
      fakeTarget("claude-code", {
        install: {
          status: { kind: "registered", launch: "latest", matches: true },
        },
      }),
    ]);
    expect(await changeCommand(install(), h.deps)).toBe(0);
    expect(text(h.out)).toContain("already registered");
    expect(text(h.out)).toContain("Nothing to change");
    expect(h.asked).toEqual([]);
  });

  it("prints the config snippet for an undetected client and plans nothing", async () => {
    const h = harness([
      fakeTarget("claude-code", {
        install: { status: { kind: "not-detected" } },
      }),
    ]);
    expect(await changeCommand(install(), h.deps)).toBe(0);
    expect(text(h.out)).toContain("not detected");
    expect(text(h.out)).toContain("claude mcp add --scope user");
    expect(h.asked).toEqual([]);
  });

  it("prints the message and the snippet for an unreadable config", async () => {
    const h = harness([
      fakeTarget("cursor", {
        install: {
          status: { kind: "unreadable", message: "bad JSON at line 3" },
        },
      }),
    ]);
    await changeCommand(
      install({ clients: { kind: "ids", ids: ["cursor"] } }),
      h.deps,
    );
    expect(text(h.out)).toContain("unreadable: bad JSON at line 3");
    expect(text(h.out)).toContain('"mcpServers"');
  });

  // MC9 review R2: a refused file is a request not met, so a script that
  // passed --client must not read success.
  it("exits 1 when a requested client's config is unreadable", async () => {
    const unreadable = {
      status: { kind: "unreadable", message: "bad JSON" } as const,
    };
    const h = harness([
      fakeTarget("cursor", { install: unreadable, uninstall: unreadable }),
    ]);
    const clients = { kind: "ids", ids: ["cursor"] } as const;
    expect(await changeCommand(install({ clients, yes: true }), h.deps)).toBe(
      1,
    );
    expect(await changeCommand(uninstall({ clients, yes: true }), h.deps)).toBe(
      1,
    );
    expect(h.merges).toEqual([]);
    expect(h.removes).toEqual([]);
  });

  it("prints an unknown status kind by name", async () => {
    const h = harness([
      fakeTarget("vscode", {
        install: {
          status: { kind: "provided-by-extension" } as never,
          actions: [
            { kind: "note", text: "The extension provides the server." },
          ],
        },
      }),
    ]);
    expect(
      await changeCommand(
        install({ clients: { kind: "ids", ids: ["vscode"] } }),
        h.deps,
      ),
    ).toBe(0);
    expect(text(h.out)).toContain(
      "provided by the AI Credits Analyzer extension",
    );
    expect(text(h.out)).toContain("The extension provides the server.");
    expect(h.asked).toEqual([]);
  });
});

describe("install: codex with a differing table", () => {
  it("explains how to change it instead of saying already registered", async () => {
    const h = harness([
      fakeTarget("codex", {
        install: {
          status: { kind: "registered", launch: "custom", matches: false },
        },
      }),
    ]);
    await changeCommand(
      install({ clients: { kind: "ids", ids: ["codex"] } }),
      h.deps,
    );
    expect(text(h.out)).toContain(
      "delete the [mcp_servers.agent-cost-analyzer] table in ~/.codex/config.toml",
    );
    expect(text(h.out)).not.toContain("already registered");
  });
});

describe("install: client selection", () => {
  it("names a client without an adapter as not supported yet, exit 1", async () => {
    const h = harness([fakeTarget("cursor", planning(merge))]);
    const code = await changeCommand(
      install({
        clients: { kind: "ids", ids: ["codex", "cursor"] },
        yes: true,
      }),
      h.deps,
    );
    expect(code).toBe(1);
    expect(text(h.out)).toContain("codex (user scope): not supported yet");
    expect(h.merges).toHaveLength(1);
  });

  it("uses the detected clients when none is named", async () => {
    const h = harness([
      fakeTarget("claude-code", { detected: false }),
      fakeTarget("cursor", planning(merge)),
    ]);
    await changeCommand(
      install({ clients: { kind: "detected" }, yes: true }),
      h.deps,
    );
    expect(text(h.out)).not.toContain("claude-code");
    expect(h.merges).toHaveLength(1);
  });

  it("is a usage error without --client when there is no terminal", async () => {
    const h = harness([fakeTarget("cursor")], { interactive: false });
    expect(
      await changeCommand(install({ clients: { kind: "detected" } }), h.deps),
    ).toBe(2);
    expect(text(h.err)).toContain("--client");
  });

  // MC9 review R3: the message named install for uninstall too.
  it("names uninstall in the usage error of an uninstall", async () => {
    const h = harness([fakeTarget("cursor")], { interactive: false });
    expect(
      await changeCommand(uninstall({ clients: { kind: "detected" } }), h.deps),
    ).toBe(2);
    expect(text(h.err)).toContain("mcp uninstall without a terminal");
  });

  it("--client all covers every target and skips scopes a client lacks", async () => {
    const h = harness([
      fakeTarget("claude-code", { label: "Claude Code", ...planning(add) }),
      fakeTarget("claude-desktop", { label: "Claude Desktop" }),
    ]);
    await changeCommand(
      install({ clients: { kind: "all" }, scope: "local", dryRun: true }),
      h.deps,
    );
    expect(text(h.out)).toContain("Claude Code (local scope)");
    expect(text(h.out)).toContain("Claude Desktop: no local scope, skipped");
  });
});

describe("applying", () => {
  it("runs, merges and notes in order and prints backup paths", async () => {
    const note: SetupAction = { kind: "note", text: "Restart Cursor." };
    const h = harness([fakeTarget("cursor", planning(merge, note))]);
    await changeCommand(
      install({ clients: { kind: "ids", ids: ["cursor"] }, yes: true }),
      h.deps,
    );
    expect(h.merges).toEqual([
      {
        kind: "merge-json",
        path: "/h/.cursor/mcp.json",
        keyPath: ["mcpServers"],
        name: "agent-cost-analyzer",
        entry: { command: "npx" },
        replace: false,
      },
    ]);
    expect(text(h.out)).toContain("backup: /bak/one");
    expect(text(h.out)).toContain("Restart Cursor.");
  });

  // Found by the MC7 smoke: the details printed before the client's own
  // "done" line, so they read as the previous client's.
  it("prints a client's details after its own done line", async () => {
    const note: SetupAction = { kind: "note", text: "Restart Cursor." };
    const h = harness([
      fakeTarget("claude-code", { label: "Claude Code", ...planning(add) }),
      fakeTarget("cursor", { label: "Cursor", ...planning(merge, note) }),
    ]);
    await changeCommand(
      install({
        clients: { kind: "ids", ids: ["claude-code", "cursor"] },
        yes: true,
      }),
      h.deps,
    );
    expect(text(h.out)).toContain(
      "Claude Code: done\nCursor: done\n  backup: /bak/one\n  Restart Cursor.\n",
    );
  });

  it("stops a client at its first failure, continues with others, exits 1", async () => {
    const second: SetupAction = {
      kind: "run",
      file: "claude",
      args: ["second"],
    };
    const h = harness(
      [
        fakeTarget("claude-code", planning({ ...add, file: "boom" }, second)),
        fakeTarget("cursor", planning(merge)),
      ],
      {
        run: (file) =>
          file === "boom"
            ? { ok: false, message: "exit code 1: nope" }
            : { ok: true },
      },
    );
    const code = await changeCommand(
      install({
        clients: { kind: "ids", ids: ["claude-code", "cursor"] },
        yes: true,
      }),
      h.deps,
    );
    expect(code).toBe(1);
    expect(h.runs.map((r) => r.file)).toEqual(["boom"]);
    expect(text(h.err)).toContain("claude-code: failed: exit code 1: nope");
    expect(h.merges).toHaveLength(1);
  });

  it("reports a planning crash for one client and carries on", async () => {
    const broken = fakeTarget("claude-code");
    broken.planInstall = async () => {
      throw new Error("disk on fire");
    };
    const h = harness([broken, fakeTarget("cursor", planning(merge))]);
    const code = await changeCommand(
      install({
        clients: { kind: "ids", ids: ["claude-code", "cursor"] },
        yes: true,
      }),
      h.deps,
    );
    expect(code).toBe(1);
    expect(text(h.out)).toContain("disk on fire");
    expect(h.merges).toHaveLength(1);
  });
});

describe("uninstall", () => {
  it("removes through the store after confirmation", async () => {
    const remove: SetupAction = {
      kind: "remove-json",
      path: "/h/.cursor/mcp.json",
      keyPath: ["mcpServers"],
      name: "agent-cost-analyzer",
    };
    const h = harness([
      fakeTarget("cursor", {
        uninstall: {
          status: { kind: "registered", launch: "latest", matches: true },
          actions: [remove],
        },
      }),
    ]);
    const code = await changeCommand(
      uninstall({ clients: { kind: "ids", ids: ["cursor"] } }),
      h.deps,
    );
    expect(code).toBe(0);
    expect(text(h.out)).toContain(
      "remove agent-cost-analyzer from /h/.cursor/mcp.json",
    );
    expect(h.removes).toHaveLength(1);
    expect(text(h.out)).toContain("backup: /bak/two");
  });

  it("says nothing to change for a client that is not registered", async () => {
    const h = harness([fakeTarget("cursor")]);
    expect(
      await changeCommand(
        uninstall({ clients: { kind: "ids", ids: ["cursor"] } }),
        h.deps,
      ),
    ).toBe(0);
    expect(text(h.out)).toContain("not registered");
    expect(text(h.out)).toContain("Nothing to change");
  });
});
