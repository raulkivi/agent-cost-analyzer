// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BACKUP_SUFFIX,
  createConfigFileStore,
  type ConfigFs,
  type JsonEntryRef,
} from "../../src/mcp-setup/config-file-store.js";

const isWindows = process.platform === "win32";
const ENTRY = { command: "npx", args: ["-y", "agent-cost-analyzer", "mcp"] };

// Claude Desktop's file as the app itself writes it: other servers and a
// `preferences` key that must survive untouched.
const DESKTOP_FIXTURE = {
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    },
    github: {
      command: "docker",
      args: ["run", "-i", "ghcr.io/github/github-mcp-server"],
      env: { TOKEN: "secret" },
    },
  },
  preferences: { menuBarEnabled: false, quickEntryShortcut: "off" },
};

let dir: string;
beforeEach(async () => {
  dir = await fsp.mkdtemp(join(tmpdir(), "aca-config-store-"));
});
afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

function ref(
  file: string,
  keyPath: readonly string[] = ["mcpServers"],
): JsonEntryRef {
  return { path: join(dir, file), keyPath, name: "agent-cost-analyzer" };
}

async function seed(file: string, text: string | Uint8Array): Promise<string> {
  const path = join(dir, file);
  await fsp.writeFile(path, text);
  return path;
}

const bytes = (path: string) => fsp.readFile(path);
const text = (path: string) => fsp.readFile(path, "utf8");
const mode = async (path: string) => (await fsp.stat(path)).mode & 0o777;

describe("ConfigFileStore.merge: a missing file", () => {
  it("creates the parent folders and a file holding only the entry", async () => {
    const store = createConfigFileStore();
    const target = ref(join("nested", "deeper", "mcp.json"));

    expect(
      await store.merge({ ...target, entry: ENTRY, replace: false }),
    ).toEqual({ kind: "created-file" });

    expect(await text(target.path)).toBe(
      JSON.stringify(
        { mcpServers: { "agent-cost-analyzer": ENTRY } },
        null,
        2,
      ) + "\n",
    );
  });

  it("creates every keyPath level", async () => {
    const store = createConfigFileStore();
    const target = ref("settings.json", ["mcp", "servers"]);

    await store.merge({ ...target, entry: ENTRY, replace: false });

    expect(JSON.parse(await text(target.path))).toEqual({
      mcp: { servers: { "agent-cost-analyzer": ENTRY } },
    });
  });

  it.skipIf(isWindows)(
    "gives the new file mode 0600, since such files can hold other servers' secrets",
    async () => {
      const store = createConfigFileStore();
      const target = ref("mcp.json");

      await store.merge({ ...target, entry: ENTRY, replace: false });

      expect(await mode(target.path)).toBe(0o600);
    },
  );

  it("writes no backup for a file it created", async () => {
    const store = createConfigFileStore();
    const target = ref("mcp.json");

    await store.merge({ ...target, entry: ENTRY, replace: false });

    expect(await fsp.readdir(dir)).toEqual(["mcp.json"]);
  });
});

describe("ConfigFileStore: files that are not valid JSON are left alone", () => {
  const invalid: Array<[string, string]> = [
    ["a JSONC line comment", '{\n  // mine\n  "mcpServers": {}\n}\n'],
    ["a JSONC block comment", '{ /* mine */ "mcpServers": {} }'],
    ["a trailing comma", '{\n  "mcpServers": {},\n}\n'],
    ["truncated text", '{\n  "mcpServers": {'],
    ["an empty file (treated as invalid JSON, not as a missing file)", ""],
    ["a whitespace-only file (treated as invalid JSON)", "  \n\t\n"],
  ];

  it.each(invalid)(
    "merge refuses %s and changes nothing",
    async (_label, content) => {
      const path = await seed("mcp.json", content);
      const store = createConfigFileStore();

      const result = await store.merge({
        ...ref("mcp.json"),
        entry: ENTRY,
        replace: true,
      });

      expect(result.kind).toBe("invalid-json");
      expect(result.kind === "invalid-json" && result.message).toContain(path);
      expect(await text(path)).toBe(content);
      expect(await fsp.readdir(dir)).toEqual(["mcp.json"]);
    },
  );

  it.each(invalid)("remove and read refuse %s", async (_label, content) => {
    await seed("mcp.json", content);
    const store = createConfigFileStore();

    expect((await store.remove(ref("mcp.json"))).kind).toBe("invalid-json");
    expect((await store.read(ref("mcp.json"))).kind).toBe("invalid-json");
  });

  it("refuses bytes that are not UTF-8 rather than rewriting them as replacement characters", async () => {
    const original = Buffer.concat([
      Buffer.from('{"mcpServers": {}, "name": "'),
      Buffer.from([0xff, 0xfe]),
      Buffer.from('"}'),
    ]);
    const path = await seed("mcp.json", original);
    const store = createConfigFileStore();

    expect(
      (await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false }))
        .kind,
    ).toBe("invalid-json");
    expect(await bytes(path)).toEqual(original);
  });
});

describe("ConfigFileStore: values that are not plain objects on the keyPath", () => {
  const shapes: Array<[string, string, readonly string[]]> = [
    ["a top-level array", "[]\n", ["mcpServers"]],
    ["a top-level string", '"text"\n', ["mcpServers"]],
    ["a top-level null", "null\n", ["mcpServers"]],
    ["an mcpServers array", '{\n  "mcpServers": []\n}\n', ["mcpServers"]],
    ["an mcpServers string", '{\n  "mcpServers": "none"\n}\n', ["mcpServers"]],
    ["an mcpServers null", '{\n  "mcpServers": null\n}\n', ["mcpServers"]],
    [
      "a deeper intermediate that is a number",
      '{\n  "mcp": {\n    "servers": 3\n  }\n}\n',
      ["mcp", "servers"],
    ],
  ];

  it.each(shapes)(
    "merge refuses %s and changes nothing",
    async (_label, content, keyPath) => {
      const path = await seed("mcp.json", content);
      const store = createConfigFileStore();

      const result = await store.merge({
        ...ref("mcp.json", keyPath),
        entry: ENTRY,
        replace: true,
      });

      expect(result.kind).toBe("invalid-shape");
      expect(result.kind === "invalid-shape" && result.message).toContain(path);
      expect(await text(path)).toBe(content);
      expect(await fsp.readdir(dir)).toEqual(["mcp.json"]);
    },
  );

  it.each(shapes)(
    "remove and read refuse %s",
    async (_label, content, keyPath) => {
      await seed("mcp.json", content);
      const store = createConfigFileStore();

      expect((await store.remove(ref("mcp.json", keyPath))).kind).toBe(
        "invalid-shape",
      );
      expect((await store.read(ref("mcp.json", keyPath))).kind).toBe(
        "invalid-shape",
      );
    },
  );

  it("adds a missing intermediate to an existing file", async () => {
    const path = await seed("mcp.json", '{\n  "theme": "dark"\n}\n');
    const store = createConfigFileStore();

    const result = await store.merge({
      ...ref("mcp.json"),
      entry: ENTRY,
      replace: false,
    });

    expect(result.kind).toBe("added");
    expect(await text(path)).toBe(
      JSON.stringify(
        { theme: "dark", mcpServers: { "agent-cost-analyzer": ENTRY } },
        null,
        2,
      ) + "\n",
    );
  });
});

describe("ConfigFileStore.read", () => {
  it("reports a missing file", async () => {
    expect(await createConfigFileStore().read(ref("mcp.json"))).toEqual({
      kind: "missing-file",
    });
  });

  it("reports an absent entry, also when the container is missing", async () => {
    await seed("a.json", '{"mcpServers": {"other": {}}}');
    await seed("b.json", "{}");
    const store = createConfigFileStore();

    expect(await store.read(ref("a.json"))).toEqual({ kind: "absent" });
    expect(await store.read(ref("b.json"))).toEqual({ kind: "absent" });
  });

  it("returns a present entry", async () => {
    await seed(
      "mcp.json",
      JSON.stringify({ mcpServers: { "agent-cost-analyzer": ENTRY } }),
    );

    expect(await createConfigFileStore().read(ref("mcp.json"))).toEqual({
      kind: "present",
      entry: ENTRY,
    });
  });

  it("does not mistake inherited Object.prototype members for keys", async () => {
    await seed("mcp.json", '{"mcpServers": {}}');
    const store = createConfigFileStore();

    expect(
      await store.read({
        path: join(dir, "mcp.json"),
        keyPath: ["constructor"],
        name: "x",
      }),
    ).toEqual({
      kind: "absent",
    });
    expect(
      await store.read({
        path: join(dir, "mcp.json"),
        keyPath: ["mcpServers"],
        name: "toString",
      }),
    ).toEqual({
      kind: "absent",
    });
  });
});

describe("ConfigFileStore.merge: an existing entry", () => {
  it("is unchanged when deep-equal (key order aside), with no write and no backup", async () => {
    const original = JSON.stringify({
      mcpServers: {
        "agent-cost-analyzer": { args: ENTRY.args, command: "npx" },
      },
    });
    const path = await seed("mcp.json", original);
    const before = await fsp.stat(path);
    const store = createConfigFileStore();

    expect(
      await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false }),
    ).toEqual({ kind: "unchanged" });
    expect(await text(path)).toBe(original);
    expect((await fsp.stat(path)).mtimeMs).toBe(before.mtimeMs);
    expect(await fsp.readdir(dir)).toEqual(["mcp.json"]);
  });

  it("is a conflict carrying the existing value when it differs and replace is false", async () => {
    const existing = { command: "node", args: ["/opt/old/server.js"] };
    const original =
      JSON.stringify(
        { mcpServers: { "agent-cost-analyzer": existing } },
        null,
        2,
      ) + "\n";
    const path = await seed("mcp.json", original);
    const store = createConfigFileStore();

    expect(
      await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false }),
    ).toEqual({
      kind: "conflict",
      existing,
    });
    expect(await text(path)).toBe(original);
    expect(await fsp.readdir(dir)).toEqual(["mcp.json"]);
  });

  it("is replaced in place, keeping its position, when replace is true", async () => {
    const path = await seed(
      "mcp.json",
      JSON.stringify(
        {
          mcpServers: {
            a: {},
            "agent-cost-analyzer": { command: "old" },
            z: {},
          },
        },
        null,
        2,
      ) + "\n",
    );
    const store = createConfigFileStore();

    expect(
      await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: true }),
    ).toEqual({
      kind: "replaced",
      backupPath: path + BACKUP_SUFFIX,
    });
    expect(await text(path)).toBe(
      JSON.stringify(
        { mcpServers: { a: {}, "agent-cost-analyzer": ENTRY, z: {} } },
        null,
        2,
      ) + "\n",
    );
  });
});

describe("ConfigFileStore: backup and atomic write", () => {
  it("copies the original to <file>.agent-cost-analyzer.bak before adding, overwriting an earlier backup", async () => {
    const original = JSON.stringify(DESKTOP_FIXTURE, null, 2) + "\n";
    const path = await seed("claude_desktop_config.json", original);
    await seed("claude_desktop_config.json" + BACKUP_SUFFIX, "stale backup");
    const store = createConfigFileStore();

    const result = await store.merge({
      ...ref("claude_desktop_config.json"),
      entry: ENTRY,
      replace: false,
    });

    expect(result).toEqual({ kind: "added", backupPath: path + BACKUP_SUFFIX });
    expect(await text(path + BACKUP_SUFFIX)).toBe(original);
  });

  // MC9 review R1: a link at the backup name (say, committed next to
  // .cursor/mcp.json in a cloned repository, for a project-scope install)
  // made copyFile write the config's bytes through it to any file.
  it.skipIf(isWindows).each([
    ["merge", '{"mcpServers":{}}'],
    ["remove", '{"mcpServers":{"agent-cost-analyzer":{}}}'],
  ] as const)(
    "%s replaces a link at the backup path instead of writing through it",
    async (operation, original) => {
      const path = await seed("mcp.json", original);
      const victim = await seed("victim.txt", "precious");
      await fsp.symlink(victim, path + BACKUP_SUFFIX);
      const store = createConfigFileStore();

      if (operation === "merge")
        await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false });
      else await store.remove(ref("mcp.json"));

      expect(await text(victim)).toBe("precious");
      expect((await fsp.lstat(path + BACKUP_SUFFIX)).isFile()).toBe(true);
      expect(await text(path + BACKUP_SUFFIX)).toBe(original);
    },
  );

  it("leaves no temporary file behind after a successful write", async () => {
    await seed("mcp.json", "{}");
    const store = createConfigFileStore();

    await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false });

    expect((await fsp.readdir(dir)).sort()).toEqual([
      "mcp.json",
      "mcp.json" + BACKUP_SUFFIX,
    ]);
  });

  // 0666 is one the usual umasks (022, 002) would cut down on a fresh file.
  it.skipIf(isWindows).each([0o640, 0o666])(
    "keeps the original file's permission bits (%o), and the backup gets the same",
    async (bits) => {
      const path = await seed("mcp.json", "{}");
      await fsp.chmod(path, bits);
      const store = createConfigFileStore();

      await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false });

      expect(await mode(path)).toBe(bits);
      expect(await mode(path + BACKUP_SUFFIX)).toBe(bits);
    },
  );

  it("leaves the original byte-identical and removes the temp file when the rename fails", async () => {
    const original = Buffer.from(JSON.stringify(DESKTOP_FIXTURE, null, "\t"));
    const path = await seed("mcp.json", original);
    const failingFs: ConfigFs = {
      ...fsp,
      rename: async () => {
        throw Object.assign(new Error("simulated rename failure"), {
          code: "EPERM",
        });
      },
    };
    const store = createConfigFileStore({
      fs: failingFs,
      randomSuffix: () => "fixed",
    });

    await expect(
      store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false }),
    ).rejects.toThrow("simulated rename failure");

    expect(await bytes(path)).toEqual(original);
    expect((await fsp.readdir(dir)).sort()).toEqual([
      "mcp.json",
      "mcp.json" + BACKUP_SUFFIX,
    ]);
  });

  it("leaves the original byte-identical and removes a half-written temp file when the write fails", async () => {
    const original = Buffer.from(
      JSON.stringify(DESKTOP_FIXTURE, null, 2) + "\n",
    );
    const path = await seed("mcp.json", original);
    const failingFs: ConfigFs = {
      ...fsp,
      writeFile: async (file, data, options) => {
        await fsp.writeFile(file, String(data).slice(0, 5), options);
        throw Object.assign(new Error("simulated disk full"), {
          code: "ENOSPC",
        });
      },
    };
    const store = createConfigFileStore({ fs: failingFs });

    await expect(
      store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false }),
    ).rejects.toThrow("simulated disk full");

    expect(await bytes(path)).toEqual(original);
    expect((await fsp.readdir(dir)).sort()).toEqual([
      "mcp.json",
      "mcp.json" + BACKUP_SUFFIX,
    ]);
  });

  it("removes a half-written new file when creating it fails", async () => {
    const failingFs: ConfigFs = {
      ...fsp,
      writeFile: async (file, data, options) => {
        await fsp.writeFile(file, String(data).slice(0, 5), options);
        throw new Error("simulated disk full");
      },
    };
    const store = createConfigFileStore({ fs: failingFs });

    await expect(
      store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false }),
    ).rejects.toThrow();

    expect(await fsp.readdir(dir)).toEqual([]);
  });
});

describe("ConfigFileStore: formatting is preserved", () => {
  it("keeps other keys and servers in order and adds the entry last", async () => {
    const path = await seed(
      "claude_desktop_config.json",
      JSON.stringify(DESKTOP_FIXTURE, null, 2) + "\n",
    );
    const store = createConfigFileStore();

    await store.merge({
      ...ref("claude_desktop_config.json"),
      entry: ENTRY,
      replace: false,
    });

    const expected = {
      mcpServers: {
        ...DESKTOP_FIXTURE.mcpServers,
        "agent-cost-analyzer": ENTRY,
      },
      preferences: DESKTOP_FIXTURE.preferences,
    };
    expect(await text(path)).toBe(JSON.stringify(expected, null, 2) + "\n");
  });

  it("keeps a tab indent and a missing final newline", async () => {
    const path = await seed(
      "mcp.json",
      JSON.stringify({ mcpServers: {} }, null, "\t"),
    );
    const store = createConfigFileStore();

    await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false });

    expect(await text(path)).toBe(
      JSON.stringify(
        { mcpServers: { "agent-cost-analyzer": ENTRY } },
        null,
        "\t",
      ),
    );
  });

  it("keeps a four-space indent", async () => {
    const path = await seed(
      "mcp.json",
      JSON.stringify({ servers: {} }, null, 4) + "\n",
    );
    const store = createConfigFileStore();

    await store.merge({
      ...ref("mcp.json", ["servers"]),
      entry: ENTRY,
      replace: false,
    });

    expect(await text(path)).toBe(
      JSON.stringify({ servers: { "agent-cost-analyzer": ENTRY } }, null, 4) +
        "\n",
    );
  });

  it("keeps a UTF-8 BOM and CRLF line endings", async () => {
    const crlf = (s: string) => s.replace(/\n/g, "\r\n");
    const path = await seed(
      "mcp.json",
      "\uFEFF" + crlf(JSON.stringify({ mcpServers: {} }, null, 2) + "\n"),
    );
    const store = createConfigFileStore();

    await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false });

    expect(await text(path)).toBe(
      "\uFEFF" +
        crlf(
          JSON.stringify(
            { mcpServers: { "agent-cost-analyzer": ENTRY } },
            null,
            2,
          ) + "\n",
        ),
    );
  });

  it("keeps non-ASCII text as it was", async () => {
    const path = await seed(
      "mcp.json",
      JSON.stringify({ mcpServers: {}, note: "Mõõk ✓ 日本" }, null, 2) + "\n",
    );
    const store = createConfigFileStore();

    await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false });

    expect(JSON.parse(await text(path)).note).toBe("Mõõk ✓ 日本");
  });

  it("normalizes a hand-formatted file (compact arrays, odd spacing) to JSON.stringify style with its indent", async () => {
    const path = await seed(
      "mcp.json",
      '{\n  "mcpServers": { "other": { "args": ["a", "b"] } },\n  "x" : 1\n}\n',
    );
    const store = createConfigFileStore();

    await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false });

    expect(await text(path)).toBe(
      JSON.stringify(
        {
          mcpServers: {
            other: { args: ["a", "b"] },
            "agent-cost-analyzer": ENTRY,
          },
          x: 1,
        },
        null,
        2,
      ) + "\n",
    );
  });
});

describe("ConfigFileStore: symlinked config files", () => {
  it.skipIf(isWindows)(
    "writes through to the link's real target and keeps the link",
    async () => {
      await fsp.mkdir(join(dir, "dotfiles"));
      const real = await seed(
        join("dotfiles", "mcp.json"),
        '{\n  "mcpServers": {}\n}\n',
      );
      const link = join(dir, "mcp.json");
      await fsp.symlink(real, link);
      const store = createConfigFileStore();

      await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false });

      expect((await fsp.lstat(link)).isSymbolicLink()).toBe(true);
      expect(JSON.parse(await text(real))).toEqual({
        mcpServers: { "agent-cost-analyzer": ENTRY },
      });
      expect(await fsp.readdir(join(dir, "dotfiles"))).toEqual(["mcp.json"]);
    },
  );

  it.skipIf(isWindows)(
    "creates the target of a dangling link instead of replacing the link",
    async () => {
      await fsp.mkdir(join(dir, "dotfiles"));
      const real = join(dir, "dotfiles", "mcp.json");
      const link = join(dir, "mcp.json");
      await fsp.symlink(real, link);
      const store = createConfigFileStore();

      expect(
        await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false }),
      ).toEqual({ kind: "created-file" });

      expect((await fsp.lstat(link)).isSymbolicLink()).toBe(true);
      expect(JSON.parse(await text(real))).toEqual({
        mcpServers: { "agent-cost-analyzer": ENTRY },
      });
    },
  );
});

describe("ConfigFileStore.remove", () => {
  it("deletes only the named key, keeps an emptied container, and backs up first", async () => {
    const original =
      JSON.stringify(
        { mcpServers: { "agent-cost-analyzer": ENTRY }, other: true },
        null,
        2,
      ) + "\n";
    const path = await seed("mcp.json", original);
    const store = createConfigFileStore();

    expect(await store.remove(ref("mcp.json"))).toEqual({
      kind: "removed",
      backupPath: path + BACKUP_SUFFIX,
    });

    expect(await text(path)).toBe(
      JSON.stringify({ mcpServers: {}, other: true }, null, 2) + "\n",
    );
    expect(await text(path + BACKUP_SUFFIX)).toBe(original);
  });

  it("reports a missing file, and an absent entry or container without writing", async () => {
    await seed("a.json", '{"mcpServers": {"other": {}}}');
    await seed("b.json", "{}");
    const store = createConfigFileStore();

    expect(await store.remove(ref("missing.json"))).toEqual({
      kind: "missing-file",
    });
    expect(await store.remove(ref("a.json"))).toEqual({ kind: "absent" });
    expect(await store.remove(ref("b.json"))).toEqual({ kind: "absent" });
    expect((await fsp.readdir(dir)).sort()).toEqual(["a.json", "b.json"]);
  });
});

describe("ConfigFileStore: merge then remove round-trips", () => {
  it.each([
    ["two-space", 2 as const],
    ["tab", "\t" as const],
  ])(
    "returns the exact original bytes of a %s-indented Claude Desktop file",
    async (_label, indent) => {
      const original = Buffer.from(
        JSON.stringify(DESKTOP_FIXTURE, null, indent) + "\n",
      );
      const path = await seed("claude_desktop_config.json", original);
      const store = createConfigFileStore();

      await store.merge({
        ...ref("claude_desktop_config.json"),
        entry: ENTRY,
        replace: false,
      });
      await store.remove(ref("claude_desktop_config.json"));

      expect(await bytes(path)).toEqual(original);
    },
  );
});

describe("ConfigFileStore: hostile keys stay data", () => {
  it("keeps __proto__ and constructor keys as plain keys and pollutes no prototype", async () => {
    const original =
      '{\n  "mcpServers": {\n    "other": {\n      "__proto__": {\n        "polluted": true\n      },\n' +
      '      "constructor": {\n        "prototype": {\n          "polluted": true\n        }\n      },\n' +
      '      "command": "x"\n    }\n  },\n  "__proto__": {\n    "polluted": true\n  }\n}\n';
    const path = await seed("mcp.json", original);
    const store = createConfigFileStore();

    expect(
      (await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: false }))
        .kind,
    ).toBe("added");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(await text(path)).toContain(
      '"__proto__": {\n        "polluted": true',
    );

    await store.remove(ref("mcp.json"));
    expect(await text(path)).toBe(original);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("can write and remove an entry or keyPath named __proto__ without touching a prototype", async () => {
    const path = await seed("mcp.json", "{}");
    const store = createConfigFileStore();
    const hostile = { path, keyPath: ["__proto__"], name: "__proto__" };

    await store.merge({
      ...hostile,
      entry: { polluted: true },
      replace: false,
    });

    expect(await text(path)).toBe(
      '{\n  "__proto__": {\n    "__proto__": {\n      "polluted": true\n    }\n  }\n}',
    );
    expect(await store.read(hostile)).toEqual({
      kind: "present",
      entry: { polluted: true },
    });
    expect(await store.remove(hostile)).toMatchObject({ kind: "removed" });
    expect(await text(path)).toBe('{\n  "__proto__": {}\n}');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

// MC9 review R6: a project config committed as a link (or inside a linked
// folder) would send our write anywhere the link points.
describe.skipIf(isWindows)("ConfigFileStore: links inside a project", () => {
  const project = () => join(dir, "proj");
  const inProject = (...parts: string[]): JsonEntryRef => ({
    path: join(project(), ...parts),
    keyPath: ["mcpServers"],
    name: "agent-cost-analyzer",
    projectRoot: project(),
  });

  beforeEach(async () => {
    await fsp.mkdir(project());
    await fsp.mkdir(join(dir, "elsewhere"));
  });

  it("refuses to read, merge or remove through a linked file and names its target", async () => {
    const real = await seed(join("elsewhere", "mcp.json"), "{}");
    await fsp.mkdir(join(project(), ".cursor"));
    const linked = inProject(".cursor", "mcp.json");
    await fsp.symlink(real, linked.path);
    const store = createConfigFileStore();
    const refusal = {
      kind: "unsafe-file",
      message: `${linked.path} is a link to ${real}; a project's config that is a link is refused`,
    };

    expect(await store.read(linked)).toEqual(refusal);
    expect(
      await store.merge({ ...linked, entry: ENTRY, replace: true }),
    ).toEqual(refusal);
    expect(await store.remove(linked)).toEqual(refusal);
    expect(await text(real)).toBe("{}");
  });

  it("refuses a linked folder between the project and the file, creating nothing", async () => {
    const elsewhere = join(dir, "elsewhere");
    await fsp.symlink(elsewhere, join(project(), ".cursor"));
    const store = createConfigFileStore();

    expect(
      await store.merge({
        ...inProject(".cursor", "mcp.json"),
        entry: ENTRY,
        replace: false,
      }),
    ).toMatchObject({
      kind: "unsafe-file",
      message: expect.stringContaining(
        `${join(project(), ".cursor")} is a link to ${elsewhere}`,
      ),
    });
    expect(await fsp.readdir(elsewhere)).toEqual([]);
  });

  it("refuses a dangling link and leaves its target uncreated", async () => {
    const linked = inProject(".mcp.json");
    const missing = join(dir, "elsewhere", "new.json");
    await fsp.symlink(missing, linked.path);

    expect(
      await createConfigFileStore().merge({
        ...linked,
        entry: ENTRY,
        replace: false,
      }),
    ).toMatchObject({ kind: "unsafe-file" });
    await expect(fsp.access(missing)).rejects.toThrow();
  });

  it("does not check the project folder itself, which may be a link", async () => {
    const real = join(dir, "real-proj");
    await fsp.mkdir(real);
    await fsp.rm(project(), { recursive: true });
    await fsp.symlink(real, project());

    expect(
      await createConfigFileStore().merge({
        ...inProject(".mcp.json"),
        entry: ENTRY,
        replace: false,
      }),
    ).toEqual({ kind: "created-file" });
  });
});

// MC9 review R6: `/dev/zero` behind a config path hung the status read.
describe("ConfigFileStore: only regular files of a sane size are read", () => {
  it.skipIf(isWindows)(
    "refuses a path that is not a regular file",
    async () => {
      const path = join(dir, "mcp.json");
      await fsp.symlink("/dev/zero", path);
      const store = createConfigFileStore();
      const refusal = {
        kind: "unsafe-file",
        message: `${path} is not a regular file`,
      };

      expect(await store.read(ref("mcp.json"))).toEqual(refusal);
      expect(
        await store.merge({ ...ref("mcp.json"), entry: ENTRY, replace: true }),
      ).toEqual(refusal);
    },
  );

  it("refuses a folder at the config path", async () => {
    await fsp.mkdir(join(dir, "mcp.json"));
    expect(await createConfigFileStore().read(ref("mcp.json"))).toMatchObject({
      kind: "unsafe-file",
    });
  });

  it("refuses a file over 10 MB without reading it", async () => {
    const path = await seed("mcp.json", "");
    await fsp.truncate(path, 10 * 1024 * 1024 + 1);
    const reads: string[] = [];
    const store = createConfigFileStore({
      fs: {
        ...fsp,
        readFile: async (file: string) => {
          reads.push(file);
          return fsp.readFile(file);
        },
      },
    });

    expect(await store.read(ref("mcp.json"))).toEqual({
      kind: "unsafe-file",
      message: `${path} is larger than 10 MB, too large for a config file`,
    });
    expect(reads).toEqual([]);
  });

  it("reads a file of exactly 10 MB", async () => {
    const path = await seed("mcp.json", "{}");
    await fsp.truncate(path, 10 * 1024 * 1024);
    // The NUL padding makes it invalid JSON: proof it was read and parsed.
    expect(await createConfigFileStore().read(ref("mcp.json"))).toMatchObject({
      kind: "invalid-json",
    });
  });
});
