// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Real sockets and the real composition over a temp package layout
// (npm-package.md §4.4): what `agent-cost-analyzer` does, short of the bundle.
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isolatedLogProviders } from "../../server/src/test-support/isolated-log-providers.js";
import { TEMP_LAYOUT, writeTempPackageLayout, type TempPackageLayout } from "../../server/src/test-support/temp-package-layout.js";
import { createServe } from "../src/serve-wiring.js";

interface Run {
  out: string[];
  err: string[];
  opened: { port: number; open: boolean }[];
  signal(): void;
  done: Promise<number>;
  port(): number;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

describe("serve, with real sockets", () => {
  let temp: TempPackageLayout;
  let settings: string;
  const blockers: Server[] = [];

  beforeEach(() => {
    temp = writeTempPackageLayout();
    settings = mkdtempSync(path.join(tmpdir(), "serve-integration-"));
  });
  afterEach(async () => {
    await Promise.all(blockers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
    temp.remove();
    rmSync(settings, { recursive: true, force: true });
  });

  function start(options: { port?: number; open?: boolean }): Run {
    const out: string[] = [];
    const err: string[] = [];
    const opened: { port: number; open: boolean }[] = [];
    let signal = () => undefined as void;
    const serve = createServe({
      layout: temp.layout,
      appOptions: isolatedLogProviders(settings),
      stdout: (text) => void out.push(text),
      stderr: (text) => void err.push(text),
      stdoutIsTty: false,
      onSignal: (handler) => {
        signal = handler;
        return () => undefined;
      },
      open: async (port, open) => void opened.push({ port, open }),
    });
    const done = serve({ kind: "serve", ...(options.port === undefined ? {} : { port: options.port }), open: options.open ?? false });
    return { out, err, opened, signal: () => signal(), done, port: () => Number(/:(\d+) /.exec(out[0] ?? "")?.[1]) };
  }

  type Reply = { status: number; body: string; headers: Record<string, unknown> };

  const send = (port: number, method: string, urlPath: string, host: string, json?: string) =>
    new Promise<Reply>((resolve, reject) => {
      const headers = { Host: host, ...(json === undefined ? {} : { "Content-Type": "application/json" }) };
      const req = httpRequest({ host: "127.0.0.1", port, method, path: urlPath, headers, agent: false }, (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      });
      req.on("error", reject);
      req.end(json);
    });

  const get = (port: number, urlPath: string, host = `127.0.0.1:${port}`) => send(port, "GET", urlPath, host);

  async function occupy(port = 0): Promise<number> {
    const server = createServer((_req, res) => void res.end("not this app"));
    blockers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    return (server.address() as AddressInfo).port;
  }

  it("--port 0 serves the web app and API on one origin, prints one start line, and stops on a signal", async () => {
    const run = start({ port: 0, open: true });
    await tick();
    const port = run.port();
    expect(run.out).toEqual([`Agent Cost Analyzer ${TEMP_LAYOUT.version} on http://127.0.0.1:${port} (Ctrl+C to stop)\n`]);
    expect(run.opened).toEqual([{ port, open: true }]);

    const page = await get(port, "/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("<title>web</title>");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(page.headers["content-security-policy"])).toContain("default-src 'self'");
    const health = await get(port, "/api/health");
    expect(JSON.parse(health.body)).toEqual({ app: "agent-cost-analyzer", status: "ok", version: TEMP_LAYOUT.version });
    expect(health.headers["content-security-policy"]).toBe(page.headers["content-security-policy"]);

    run.signal();
    expect(await run.done).toBe(0);
    await expect(get(port, "/api/health")).rejects.toThrow();
  });

  it("the Host guard allows only the bound port", async () => {
    const run = start({ port: 0 });
    await tick();
    const port = run.port();
    expect((await get(port, "/api/health", "evil.example")).status).toBe(403);
    expect((await get(port, "/api/health", `127.0.0.1:${port + 1}`)).status).toBe(403);
    expect((await get(port, "/", "evil.example")).status).toBe(403);
    expect((await get(port, "/api/health", `localhost:${port}`)).status).toBe(200);
    run.signal();
    await run.done;
  });

  it("answers a malformed JSON body with 400 and no stack, and names no framework", async () => {
    const run = start({ port: 0 });
    await tick();
    const port = run.port();
    const response = await send(port, "PUT", "/api/projects", `127.0.0.1:${port}`, "{not json");
    expect(response.status).toBe(400);
    expect(response.body).not.toMatch(/SyntaxError|\bat \S/);
    for (const reply of [response, await get(port, "/"), await get(port, "/api/health")]) {
      expect(reply.headers["x-powered-by"]).toBeUndefined();
    }
    run.signal();
    await run.done;
  });

  it("refuses static traversal out of the web folder", async () => {
    const run = start({ port: 0 });
    await tick();
    const port = run.port();
    for (const urlPath of ["/../package.json", "/%2e%2e/package.json", "/..%2f..%2fpackage.json"]) {
      const response = await get(port, urlPath);
      expect(response.body, urlPath).not.toContain(TEMP_LAYOUT.version);
    }
    run.signal();
    await run.done;
  });

  it("--port on a busy port fails with exit 1 and a message", async () => {
    const busy = await occupy();
    const run = start({ port: busy });
    expect(await run.done).toBe(1);
    expect(run.err.join("")).toContain(`Port ${busy} is already in use`);
    expect(run.out).toEqual([]);
  });

  // The default port is fixed, so the two tests below need it free on this
  // machine; they stand down when something (say a running instance) has it.
  async function defaultPortIsFree(): Promise<boolean> {
    try {
      await occupy(5199);
      await Promise.all(blockers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
      return true;
    } catch {
      return false;
    }
  }

  it("takes the next port when another program holds the default one, and says so", async () => {
    if (!(await defaultPortIsFree())) return;
    await occupy(5199);
    const run = start({});
    await tick();
    expect(run.port()).toBe(5200);
    expect(run.err.join("")).toMatch(/5199.*in use.*5200/);
    expect((await get(5200, "/api/health")).status).toBe(200);
    run.signal();
    expect(await run.done).toBe(0);
  });

  it("opens a running instance of this app instead of starting a second one", async () => {
    if (!(await defaultPortIsFree())) return;
    const first = start({});
    await tick();
    expect(first.port()).toBe(5199);

    const second = start({ open: true });
    expect(await second.done).toBe(0);
    expect(second.out).toEqual(["Agent Cost Analyzer is already running on http://127.0.0.1:5199 (opening it)\n"]);
    expect(second.opened).toEqual([{ port: 5199, open: true }]);

    first.signal();
    expect(await first.done).toBe(0);
  });
});
