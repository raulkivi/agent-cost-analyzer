// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { assertLoopbackBindHost } from "./loopback-bind.js";

// threat-model.md §5.1: the server is trusted because it is loopback-only
// (architecture.md §11.2), so binding to anything else must fail at start,
// not pass silently.
describe("assertLoopbackBindHost", () => {
  it.each(["127.0.0.1", "::1", "localhost"])("accepts the loopback host %s", (host) => {
    expect(() => assertLoopbackBindHost(host)).not.toThrow();
  });

  it.each(["0.0.0.0", "::", "", "192.168.1.10", "10.0.0.5", "example.com", "127.0.0.1.example.com", " 127.0.0.1"])(
    "refuses %j, which would expose the server beyond this machine",
    (host) => {
      expect(() => assertLoopbackBindHost(host)).toThrow(/loopback/);
    },
  );
});
