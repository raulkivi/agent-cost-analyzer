// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClientTargets } from "../../src/mcp-setup/client-targets.js";
import { createConfigFileStore } from "../../src/mcp-setup/config-file-store.js";
import { createSetupRunner } from "../../src/mcp-setup/setup-runner.js";
import { fakeEnv } from "./fake-client-env.js";

// Real store and real Cursor adapter over a temp home; no command runs.
let root: string;
beforeEach(async () => {
  root = await fsp.mkdtemp(join(tmpdir(), "aca-setup-"));
  await fsp.mkdir(join(root, ".cursor"));
});
afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

function runner(out: string[]) {
  const store = createConfigFileStore();
  return createSetupRunner({
    targets: createClientTargets({ store }),
    store,
    runner: { run: async () => ({ ok: false, message: "must not run" }) },
    env: fakeEnv({
      home: root,
      cwd: root,
      exists: (path) =>
        fsp.access(path).then(
          () => true,
          () => false,
        ),
    }),
    version: "1.0.0",
    io: {
      out: (t) => void out.push(t),
      err: (t) => void out.push(t),
      interactive: false,
      confirm: async () => false,
    },
  });
}

const cursor = { kind: "ids", ids: ["cursor"] } as const;
const file = () => join(root, ".cursor", "mcp.json");

describe("install, status and uninstall over a real Cursor config", () => {
  it("round-trips an entry and keeps the user's other servers", async () => {
    await fsp.writeFile(
      file(),
      JSON.stringify({ mcpServers: { other: { command: "x" } } }),
    );
    const out: string[] = [];
    const run = runner(out);
    const base = { scope: "user", dryRun: false, yes: true } as const;

    expect(
      await run({
        kind: "mcp-install",
        clients: cursor,
        pin: false,
        projectBillingDetails: false,
        ...base,
      }),
    ).toBe(0);
    const written = JSON.parse(await fsp.readFile(file(), "utf8"));
    expect(Object.keys(written.mcpServers)).toEqual([
      "other",
      "agent-cost-analyzer",
    ]);
    expect(out.join("")).toContain("backup:");

    out.length = 0;
    await run({ kind: "mcp-status", scope: "user" });
    expect(out.join("")).toMatch(/Cursor\s+registered \(latest\)/);

    out.length = 0;
    expect(await run({ kind: "mcp-uninstall", clients: cursor, ...base })).toBe(
      0,
    );
    const after = JSON.parse(await fsp.readFile(file(), "utf8"));
    expect(after).toEqual({ mcpServers: { other: { command: "x" } } });
  });

  it("dry-run leaves the file untouched", async () => {
    await fsp.writeFile(file(), "{}");
    const out: string[] = [];
    const code = await runner(out)({
      kind: "mcp-install",
      clients: cursor,
      scope: "user",
      pin: false,
      projectBillingDetails: false,
      dryRun: true,
      yes: false,
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain(`add agent-cost-analyzer to ${file()}`);
    expect(await fsp.readFile(file(), "utf8")).toBe("{}");
  });
});
