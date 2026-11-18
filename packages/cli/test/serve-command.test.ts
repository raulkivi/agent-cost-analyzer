// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { RequestListener } from "node:http";
import { describe, expect, it } from "vitest";
import { createServeCommand, MCP_SETUP_HINT, type ServeDeps, type ServerHandle } from "../src/serve-command.js";

function fakes(options: { busy?: number[]; running?: number[]; composeFails?: boolean; stdoutIsTty?: boolean } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const opened: { port: number; open: boolean }[] = [];
  const composed: number[] = [];
  const events: string[] = [];
  let signal: (() => void) | undefined;
  let unregistered = false;
  const listener: RequestListener = () => undefined;
  const handle: ServerHandle & { mounted?: RequestListener } = {
    mount(l) {
      this.mounted = l;
    },
    close: async () => void events.push("closed"),
  };
  const deps: ServeDeps = {
    listen: async (port) => (options.busy?.includes(port) ? { status: "busy" } : { status: "listening", port: port || 41000, server: handle }),
    isThisApp: async (port) => options.running?.includes(port) ?? false,
    compose: (port) => {
      composed.push(port);
      if (options.composeFails) throw new Error("compose failed");
      return { listener, version: "1.2.3" };
    },
    open: async (port, open) => void opened.push({ port, open }),
    onSignal: (fn) => {
      signal = fn;
      return () => void (unregistered = true);
    },
    stdout: (text) => void out.push(text),
    stderr: (text) => void err.push(text),
    stdoutIsTty: options.stdoutIsTty ?? false,
  };
  return { serve: createServeCommand(deps), out, err, opened, composed, events, handle, listener, fire: () => signal?.(), unregistered: () => unregistered, hasSignal: () => signal !== undefined };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("serve command", () => {
  it("binds, composes with the bound port, mounts, prints exactly one start line, then opens the browser", async () => {
    const f = fakes();
    const done = f.serve({ kind: "serve", open: true });
    await tick();
    expect(f.composed).toEqual([5199]);
    expect(f.handle.mounted).toBe(f.listener);
    expect(f.out).toEqual(["Agent Cost Analyzer 1.2.3 on http://127.0.0.1:5199 (Ctrl+C to stop)\n"]);
    expect(f.err).toEqual([]);
    expect(f.opened).toEqual([{ port: 5199, open: true }]);
    f.fire();
    expect(await done).toBe(0);
  });

  it("passes --no-open on to the opener", async () => {
    const f = fakes();
    const done = f.serve({ kind: "serve", open: false });
    await tick();
    expect(f.opened).toEqual([{ port: 5199, open: false }]);
    f.fire();
    await done;
  });

  it("composes with the port --port 0 was given by the system", async () => {
    const f = fakes();
    const done = f.serve({ kind: "serve", port: 0, open: false });
    await tick();
    expect(f.composed).toEqual([41000]);
    expect(f.out[0]).toContain("http://127.0.0.1:41000 ");
    f.fire();
    await done;
  });

  it("says on stderr which port it took when the default was busy", async () => {
    const f = fakes({ busy: [5199] });
    const done = f.serve({ kind: "serve", open: false });
    await tick();
    expect(f.out).toEqual(["Agent Cost Analyzer 1.2.3 on http://127.0.0.1:5200 (Ctrl+C to stop)\n"]);
    expect(f.err.join("")).toMatch(/5199.*in use.*5200/);
    f.fire();
    await done;
  });

  it("closes the server on a signal, then resolves 0 and stops listening for signals", async () => {
    const f = fakes();
    const done = f.serve({ kind: "serve", open: false });
    await tick();
    expect(f.events).toEqual([]);
    f.fire();
    expect(await done).toBe(0);
    expect(f.events).toEqual(["closed"]);
    expect(f.unregistered()).toBe(true);
  });

  it("opens a running instance instead of starting one, and exits 0", async () => {
    const f = fakes({ busy: [5199], running: [5199] });
    expect(await f.serve({ kind: "serve", open: true })).toBe(0);
    expect(f.composed).toEqual([]);
    expect(f.hasSignal()).toBe(false);
    expect(f.out).toEqual(["Agent Cost Analyzer is already running on http://127.0.0.1:5199 (opening it)\n"]);
    expect(f.opened).toEqual([{ port: 5199, open: true }]);
  });

  it("respects --no-open when reusing", async () => {
    const f = fakes({ busy: [5199], running: [5199] });
    await f.serve({ kind: "serve", open: false });
    expect(f.opened).toEqual([{ port: 5199, open: false }]);
  });

  it("--port busy: message on stderr, exit 1, nothing on stdout", async () => {
    const f = fakes({ busy: [5300] });
    expect(await f.serve({ kind: "serve", port: 5300, open: true })).toBe(1);
    expect(f.err.join("")).toContain("Port 5300 is already in use");
    expect(f.out).toEqual([]);
    expect(f.opened).toEqual([]);
  });

  it("closes the server and rethrows when composing fails", async () => {
    const f = fakes({ composeFails: true });
    await expect(f.serve({ kind: "serve", open: false })).rejects.toThrow("compose failed");
    expect(f.events).toEqual(["closed"]);
  });
  it("prints the MCP setup hint after the start line when stdout is a TTY and the browser opens", async () => {
    const f = fakes({ stdoutIsTty: true });
    const done = f.serve({ kind: "serve", open: true });
    await tick();
    expect(f.out).toEqual(["Agent Cost Analyzer 1.2.3 on http://127.0.0.1:5199 (Ctrl+C to stop)\n", `${MCP_SETUP_HINT}\n`]);
    expect(MCP_SETUP_HINT).toBe("MCP: npx agent-cost-analyzer mcp install");
    f.fire();
    await done;
  });

  it("keeps the start line as the first line when the hint is printed", async () => {
    const f = fakes({ stdoutIsTty: true });
    const done = f.serve({ kind: "serve", open: true });
    await tick();
    expect(f.out[0]).toMatch(/^Agent Cost Analyzer 1\.2\.3 on http:\/\/127\.0\.0\.1:5199 \(Ctrl\+C to stop\)\n$/);
    f.fire();
    await done;
  });

  it("does not print the hint when stdout is not a TTY", async () => {
    const f = fakes({ stdoutIsTty: false });
    const done = f.serve({ kind: "serve", open: true });
    await tick();
    expect(f.out).toEqual(["Agent Cost Analyzer 1.2.3 on http://127.0.0.1:5199 (Ctrl+C to stop)\n"]);
    f.fire();
    await done;
  });

  it("does not print the hint with --no-open, even on a TTY", async () => {
    const f = fakes({ stdoutIsTty: true });
    const done = f.serve({ kind: "serve", open: false });
    await tick();
    expect(f.out).toEqual(["Agent Cost Analyzer 1.2.3 on http://127.0.0.1:5199 (Ctrl+C to stop)\n"]);
    f.fire();
    await done;
  });

  it("does not print the hint when it reuses a running instance", async () => {
    const f = fakes({ busy: [5199], running: [5199], stdoutIsTty: true });
    expect(await f.serve({ kind: "serve", open: true })).toBe(0);
    expect(f.out).toEqual(["Agent Cost Analyzer is already running on http://127.0.0.1:5199 (opening it)\n"]);
  });

  it("does not print the hint when composing fails", async () => {
    const f = fakes({ composeFails: true, stdoutIsTty: true });
    await expect(f.serve({ kind: "serve", open: true })).rejects.toThrow("compose failed");
    expect(f.out).toEqual([]);
  });
});
