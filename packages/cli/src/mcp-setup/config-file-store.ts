// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { randomBytes } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import {
  createFileExclusively,
  replaceFileAtomically,
  resolveWriteTarget,
} from "./atomic-write.js";
import { errorCode, type ConfigFs } from "./config-fs.js";
import { ensureContainer, findContainer } from "./json-key-path.js";
import {
  detectJsonTextFormat,
  formatJsonText,
  NEW_FILE_FORMAT,
  stripBom,
  type JsonTextFormat,
} from "./json-text-format.js";
import { getOwn, jsonEqual, setOwn, type JsonValue } from "./json-value.js";

export type { ConfigFs } from "./config-fs.js";
export type { JsonValue } from "./json-value.js";

export const BACKUP_SUFFIX = ".agent-cost-analyzer.bak";
// Other entries in these files can hold API keys and tokens.
const NEW_FILE_MODE = 0o600;

/** One named entry inside an object reached by `keyPath` in a JSON file. */
export interface JsonEntryRef {
  path: string;
  /** e.g. ["mcpServers"] (Claude Desktop, Cursor) or ["servers"] (VS Code). */
  keyPath: readonly string[];
  name: string;
}

type Refusal =
  | { kind: "invalid-json"; message: string }
  | { kind: "invalid-shape"; message: string };

export type ReadResult =
  | { kind: "missing-file" }
  | Refusal
  | { kind: "absent" }
  | { kind: "present"; entry: JsonValue };

export type MergeResult =
  | { kind: "created-file" }
  | { kind: "added"; backupPath: string }
  | { kind: "unchanged" }
  | { kind: "conflict"; existing: JsonValue }
  | { kind: "replaced"; backupPath: string }
  | Refusal;

export type RemoveResult =
  | { kind: "removed"; backupPath: string }
  | { kind: "absent" }
  | { kind: "missing-file" }
  | Refusal;

/**
 * The only writer of MCP clients' JSON config files. Files it cannot read as
 * plain JSON with plain objects along `keyPath` are refused unchanged;
 * every write of an existing file is backed up first and lands atomically.
 * I/O failures (permissions, a full disk) reject the promise.
 */
export interface ConfigFileStore {
  read(ref: JsonEntryRef): Promise<ReadResult>;
  merge(
    request: JsonEntryRef & { entry: JsonValue; replace: boolean },
  ): Promise<MergeResult>;
  remove(ref: JsonEntryRef): Promise<RemoveResult>;
}

export interface ConfigFileStoreDeps {
  fs?: ConfigFs;
  randomSuffix?: () => string;
}

type Loaded =
  | { kind: "missing-file"; target: string }
  | Refusal
  | { kind: "loaded"; target: string; root: JsonValue; format: JsonTextFormat };

export function createConfigFileStore(
  deps: ConfigFileStoreDeps = {},
): ConfigFileStore {
  const fs = deps.fs ?? nodeFs;
  const randomSuffix =
    deps.randomSuffix ?? (() => randomBytes(8).toString("hex"));

  async function load(path: string): Promise<Loaded> {
    const target = await resolveWriteTarget(fs, path);
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(target);
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return { kind: "missing-file", target };
      throw error;
    }
    return parse(path, target, bytes);
  }

  // Backs up the file as it is on disk, then swaps in the new text.
  async function save(
    path: string,
    loaded: Extract<Loaded, { kind: "loaded" }>,
  ): Promise<string> {
    const backupPath = path + BACKUP_SUFFIX;
    await fs.copyFile(loaded.target, backupPath);
    await replaceFileAtomically(
      fs,
      loaded.target,
      formatJsonText(loaded.root, loaded.format),
      randomSuffix,
    );
    return backupPath;
  }

  return {
    async read(ref) {
      const loaded = await load(ref.path);
      if (loaded.kind !== "loaded") return withoutTarget(loaded);
      const lookup = findContainer(loaded.root, ref.keyPath);
      if (lookup.kind === "invalid-shape")
        return shapeRefusal(ref.path, lookup.message);
      const entry =
        lookup.kind === "found"
          ? getOwn(lookup.container, ref.name)
          : undefined;
      return entry === undefined
        ? { kind: "absent" }
        : { kind: "present", entry };
    },

    async merge({ entry, replace, ...ref }) {
      const loaded = await load(ref.path);
      if (loaded.kind === "missing-file") {
        await createFileExclusively(
          fs,
          loaded.target,
          formatJsonText(newDocument(ref, entry), NEW_FILE_FORMAT),
          NEW_FILE_MODE,
        );
        return { kind: "created-file" };
      }
      if (loaded.kind !== "loaded") return loaded;
      const lookup = ensureContainer(loaded.root, ref.keyPath);
      if (lookup.kind === "invalid-shape")
        return shapeRefusal(ref.path, lookup.message);
      const existing = getOwn(lookup.container, ref.name);
      if (existing !== undefined && jsonEqual(existing, entry))
        return { kind: "unchanged" };
      if (existing !== undefined && !replace)
        return { kind: "conflict", existing };
      setOwn(lookup.container, ref.name, entry);
      const backupPath = await save(ref.path, loaded);
      return existing === undefined
        ? { kind: "added", backupPath }
        : { kind: "replaced", backupPath };
    },

    async remove(ref) {
      const loaded = await load(ref.path);
      if (loaded.kind !== "loaded") return withoutTarget(loaded);
      const lookup = findContainer(loaded.root, ref.keyPath);
      if (lookup.kind === "invalid-shape")
        return shapeRefusal(ref.path, lookup.message);
      if (
        lookup.kind === "missing" ||
        !Object.hasOwn(lookup.container, ref.name)
      )
        return { kind: "absent" };
      // An emptied container stays: the user (or the client) may expect the key.
      delete lookup.container[ref.name];
      return { kind: "removed", backupPath: await save(ref.path, loaded) };
    },
  };
}

function parse(path: string, target: string, bytes: Uint8Array): Loaded {
  let text: string;
  try {
    // fatal: bytes that are not UTF-8 would come back as U+FFFD and be
    // written out that way. ignoreBOM: keep the BOM so the rewrite keeps it.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return { kind: "invalid-json", message: `${path} is not UTF-8 text` };
  }
  try {
    // JSON.parse makes every key, "__proto__" included, an own data property.
    const root = JSON.parse(stripBom(text)) as JsonValue;
    return { kind: "loaded", target, root, format: detectJsonTextFormat(text) };
  } catch (error) {
    return {
      kind: "invalid-json",
      message: `${path} is not valid JSON: ${(error as Error).message}`,
    };
  }
}

function newDocument(ref: JsonEntryRef, entry: JsonValue): JsonValue {
  const root = {};
  const lookup = ensureContainer(root, ref.keyPath);
  if (lookup.kind === "found") setOwn(lookup.container, ref.name, entry);
  return root;
}

function shapeRefusal(path: string, message: string): Refusal {
  return { kind: "invalid-shape", message: `${path}: ${message}` };
}

function withoutTarget(
  loaded: Exclude<Loaded, { kind: "loaded" }>,
): { kind: "missing-file" } | Refusal {
  return loaded.kind === "missing-file" ? { kind: "missing-file" } : loaded;
}
