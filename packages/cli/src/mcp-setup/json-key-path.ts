// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  getOwn,
  isJsonObject,
  setOwn,
  type JsonObject,
  type JsonValue,
} from "./json-value.js";

type Found = { kind: "found"; container: JsonObject };
type InvalidShape = { kind: "invalid-shape"; message: string };
type Missing = {
  kind: "missing";
  deepest: JsonObject;
  missingKeys: readonly string[];
};

/**
 * Walks `keyPath` from the root to the object that holds the entries. A
 * level that exists but is not a plain object is reported, never
 * overwritten: it may be the user's own data. Only own keys count, so
 * "constructor" or "__proto__" are found only when the file has them.
 */
export function findContainer(
  root: JsonValue,
  keyPath: readonly string[],
): Found | InvalidShape | Missing {
  if (!isJsonObject(root)) return invalidShape("the top level", root);
  let current: JsonObject = root;
  for (const [depth, key] of keyPath.entries()) {
    const next = getOwn(current, key);
    if (next === undefined)
      return {
        kind: "missing",
        deepest: current,
        missingKeys: keyPath.slice(depth),
      };
    if (!isJsonObject(next))
      return invalidShape(`"${keyPath.slice(0, depth + 1).join(".")}"`, next);
    current = next;
  }
  return { kind: "found", container: current };
}

/** As findContainer, but adds the missing levels to `root`. */
export function ensureContainer(
  root: JsonValue,
  keyPath: readonly string[],
): Found | InvalidShape {
  const lookup = findContainer(root, keyPath);
  if (lookup.kind !== "missing") return lookup;
  let container = lookup.deepest;
  for (const key of lookup.missingKeys) {
    const next: JsonObject = {};
    setOwn(container, key, next);
    container = next;
  }
  return { kind: "found", container };
}

function invalidShape(where: string, value: JsonValue): InvalidShape {
  return {
    kind: "invalid-shape",
    message: `${where} is ${describe(value)}, not an object`,
  };
}

function describe(value: JsonValue): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}
