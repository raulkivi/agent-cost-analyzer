// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { keyringUnreachableMessage, secretServiceReachable } from "./keyring-check.mts";

describe("secretServiceReachable", () => {
  it("is true when the session bus says the secret service has an owner", () => {
    expect(secretServiceReachable(() => "method return time=1 sender=org.freedesktop.DBus\n   boolean true\n")).toBe(true);
  });
  it("is false when the secret service has no owner", () => {
    expect(secretServiceReachable(() => "method return\n   boolean false\n")).toBe(false);
  });
  it("is false when the session bus does not answer (a stale bus address, for one)", () => {
    expect(
      secretServiceReachable(() => {
        throw new Error('Failed to open connection to "session" message bus: Did not receive a reply.');
      }),
    ).toBe(false);
  });
  it("asks the bus daemon about org.freedesktop.secrets with dbus-send", () => {
    const calls: Array<[string, string[]]> = [];
    secretServiceReachable((file, args) => {
      calls.push([file, args]);
      return "boolean true";
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toBe("dbus-send");
    expect(calls[0]![1]).toEqual(expect.arrayContaining(["--session", "org.freedesktop.DBus.NameHasOwner", "string:org.freedesktop.secrets"]));
  });
});

describe("keyringUnreachableMessage", () => {
  it("says why the take stops and how to fix the bus address", () => {
    const message = keyringUnreachableMessage("unix:path=/run/user/1000/bus,guid=abc", "/run/user/1000");
    expect(message).toMatch(/signed out/);
    expect(message).toContain("unix:path=/run/user/1000/bus,guid=abc");
    expect(message).toContain("DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus");
  });
});
