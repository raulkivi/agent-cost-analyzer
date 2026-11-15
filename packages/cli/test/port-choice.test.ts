// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, choosePort, portCandidates, type PortProbes } from "../src/port-choice.js";

// `busy` ports refuse to listen; `running` ones also answer as this app.
function probes(busy: number[], running: number[] = [], free = 40123) {
  const listened: number[] = [];
  const impl: PortProbes<string> = {
    listen: async (port) => {
      listened.push(port);
      if (busy.includes(port)) return { status: "busy" };
      const bound = port === 0 ? free : port;
      return { status: "listening", port: bound, server: `server@${bound}` };
    },
    isThisApp: async (port) => running.includes(port),
  };
  return { impl, listened };
}

describe("portCandidates (D4)", () => {
  it("defaults to 5199 and the next ten ports", () => {
    expect(DEFAULT_PORT).toBe(5199);
    expect(portCandidates(undefined)).toEqual([5199, 5200, 5201, 5202, 5203, 5204, 5205, 5206, 5207, 5208, 5209]);
  });

  it("is exactly the given port otherwise, 0 included", () => {
    expect(portCandidates(5300)).toEqual([5300]);
    expect(portCandidates(0)).toEqual([0]);
  });
});

describe("choosePort", () => {
  it("binds the default port when it is free", async () => {
    const { impl, listened } = probes([]);
    expect(await choosePort(undefined, impl)).toEqual({ kind: "bound", port: 5199, server: "server@5199", fellBack: false });
    expect(listened).toEqual([5199]);
  });

  it("reuses a running instance on the default port and binds nothing else", async () => {
    const { impl, listened } = probes([5199], [5199]);
    expect(await choosePort(undefined, impl)).toEqual({ kind: "running", port: 5199 });
    expect(listened).toEqual([5199]);
  });

  it("falls back to the next free port when another program holds the default", async () => {
    const { impl } = probes([5199, 5200]);
    expect(await choosePort(undefined, impl)).toEqual({ kind: "bound", port: 5201, server: "server@5201", fellBack: true });
  });

  it("reuses an instance that an earlier fallback left on a later port", async () => {
    const { impl } = probes([5199, 5200], [5200]);
    expect(await choosePort(undefined, impl)).toEqual({ kind: "running", port: 5200 });
  });

  it("fails with a clear message when all eleven ports are taken", async () => {
    const { impl } = probes(portCandidates(undefined));
    const choice = await choosePort(undefined, impl);
    expect(choice.kind).toBe("unavailable");
    expect(choice).toMatchObject({ message: expect.stringMatching(/5199.*5209.*--port/s) });
  });

  it("--port binds exactly that port", async () => {
    const { impl, listened } = probes([]);
    expect(await choosePort(5300, impl)).toEqual({ kind: "bound", port: 5300, server: "server@5300", fellBack: false });
    expect(listened).toEqual([5300]);
  });

  it("--port busy fails without a fallback or a reuse", async () => {
    const { impl, listened } = probes([5300], [5300]);
    const choice = await choosePort(5300, impl);
    expect(choice).toMatchObject({ kind: "unavailable", message: expect.stringContaining("Port 5300 is already in use") });
    expect(listened).toEqual([5300]);
  });

  it("--port 0 takes the port the system gives", async () => {
    const { impl } = probes([]);
    expect(await choosePort(0, impl)).toEqual({ kind: "bound", port: 40123, server: "server@40123", fellBack: false });
  });
});
