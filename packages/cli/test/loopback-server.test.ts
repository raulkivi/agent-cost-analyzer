// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { isThisApp, listenOnLoopback } from "../src/loopback-server.js";

const open: Server[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

function serveOnEphemeralPort(handler: Parameters<typeof createServer>[1]): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    open.push(server);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

describe("listenOnLoopback", () => {
  it("binds 127.0.0.1 on a free system port for 0 and serves what is mounted", async () => {
    const outcome = await listenOnLoopback(0);
    if (outcome.status !== "listening") throw new Error("expected listening");
    try {
      expect(outcome.port).toBeGreaterThan(0);
      outcome.server.mount((_req, res) => void res.end("mounted"));
      const response = await fetch(`http://127.0.0.1:${outcome.port}/`);
      expect(await response.text()).toBe("mounted");
    } finally {
      await outcome.server.close();
    }
  });

  it("reports a busy port as busy, not as an error", async () => {
    const port = await serveOnEphemeralPort((_req, res) => void res.end());
    expect(await listenOnLoopback(port)).toEqual({ status: "busy" });
  });

  it("frees the port on close", async () => {
    const first = await listenOnLoopback(0);
    if (first.status !== "listening") throw new Error("expected listening");
    await first.server.close();
    const again = await listenOnLoopback(first.port);
    expect(again.status).toBe("listening");
    if (again.status === "listening") await again.server.close();
  });

  it("closes while a keep-alive client is still connected", async () => {
    const outcome = await listenOnLoopback(0);
    if (outcome.status !== "listening") throw new Error("expected listening");
    outcome.server.mount((_req, res) => void res.end("ok"));
    await fetch(`http://127.0.0.1:${outcome.port}/`);
    await expect(outcome.server.close()).resolves.toBeUndefined();
  });
});

describe("isThisApp", () => {
  it("is true for a server whose /api/health names this app", async () => {
    const port = await serveOnEphemeralPort((_req, res) => void res.end(JSON.stringify({ app: "agent-cost-analyzer", status: "ok", version: "1" })));
    expect(await isThisApp(port)).toBe(true);
  });

  it.each([
    ["another JSON health answer", JSON.stringify({ status: "ok" })],
    ["an HTML page", "<html></html>"],
    ["an empty body", ""],
  ])("is false for %s", async (_name, body) => {
    const port = await serveOnEphemeralPort((_req, res) => void res.end(body));
    expect(await isThisApp(port)).toBe(false);
  });

  // Another program on the port could otherwise send the probe to any host,
  // off the machine included (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/npm-package.md §2: no network call by the app).
  it("follows no redirect: false, and the redirect target is never asked", async () => {
    let targetHits = 0;
    const target = await serveOnEphemeralPort((_req, res) => {
      targetHits++;
      res.end(JSON.stringify({ app: "agent-cost-analyzer" }));
    });
    const port = await serveOnEphemeralPort((_req, res) => void res.writeHead(302, { Location: `http://localhost:${target}/api/health` }).end());
    expect(await isThisApp(port)).toBe(false);
    expect(targetHits).toBe(0);
  });

  it("is false for a server that answers with an error status", async () => {
    const port = await serveOnEphemeralPort((_req, res) => void res.writeHead(403).end(JSON.stringify({ app: "agent-cost-analyzer" })));
    expect(await isThisApp(port)).toBe(false);
  });

  it("is false when nothing listens", async () => {
    const port = await serveOnEphemeralPort((_req, res) => void res.end());
    await new Promise((resolve) => open.pop()!.close(resolve));
    expect(await isThisApp(port)).toBe(false);
  });

  it("is false for a server that never answers (times out)", async () => {
    const port = await serveOnEphemeralPort(() => undefined);
    expect(await isThisApp(port, 100)).toBe(false);
  });
});
