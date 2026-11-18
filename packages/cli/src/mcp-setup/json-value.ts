// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

export type JsonObject = { [key: string]: JsonValue };
export type JsonValue =
  null | boolean | number | string | JsonValue[] | JsonObject;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON.parse makes "__proto__" an own data property, but plain assignment
// with that key would set the object's prototype instead. Every write of a
// key that came from a user's file or a caller goes through here.
export function setOwn(
  target: JsonObject,
  key: string,
  value: JsonValue,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

export function getOwn(target: JsonObject, key: string): JsonValue | undefined {
  return Object.hasOwn(target, key) ? target[key] : undefined;
}

/** Deep equality of JSON data; object key order does not count. */
export function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => jsonEqual(item, b[i]))
    );
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
    );
  }
  return a === b;
}
