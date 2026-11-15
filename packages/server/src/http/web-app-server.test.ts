// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentSecurityPolicy, inlineScriptHashes } from "./security-headers.js";
import { createWebAppServer } from "./web-app-server.js";

const INLINE = "document.documentElement.dataset.x = '1';";
const INDEX = `<!doctype html><html><head><script>${INLINE}</script></head><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>`;
const sha = (text: string) => `'sha256-${createHash("sha256").update(text).digest("base64")}'`;
const HOST = { Host: "127.0.0.1:5199" };

describe("inlineScriptHashes", () => {
  it("hashes inline scripts only, not scripts with a src", () => {
    expect(inlineScriptHashes(INDEX)).toEqual([sha(INLINE)]);
  });

  it("finds nothing in a page without inline scripts", () => {
    expect(inlineScriptHashes('<script src="/a.js"></script>')).toEqual([]);
  });
});

describe("contentSecurityPolicy", () => {
  it("allows only 'self' plus the given inline script hashes", () => {
    const policy = contentSecurityPolicy([sha(INLINE)]);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain(`script-src 'self' ${sha(INLINE)}`);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toMatch(/unsafe-|https?:|\*/);
  });
});

// A raw request: http.request sends the path unnormalised, which supertest's
// URL handling would not.
function rawGet(app: Express, urlPath: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => {
      const { port } = listening.address() as { port: number };
      const req = httpRequest({ host: "127.0.0.1", port, path: urlPath, headers: { Host: `127.0.0.1:${port}` } }, (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => (text += chunk));
        res.on("end", () => listening.close(() => resolve({ status: res.statusCode ?? 0, text })));
      });
      req.on("error", reject);
      req.end();
    });
  });
}

describe("createWebAppServer", () => {
  let root: string;
  let webDir: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "web-app-server-"));
    webDir = path.join(root, "dist", "web");
    mkdirSync(path.join(webDir, "assets"), { recursive: true });
    writeFileSync(path.join(webDir, "index.html"), INDEX);
    writeFileSync(path.join(webDir, "assets", "app.js"), "console.log(1);");
    writeFileSync(path.join(webDir, "assets", "app.css"), "body{}");
    writeFileSync(path.join(webDir, ".secret"), "dotfile-secret");
    writeFileSync(path.join(root, "package.json"), '{"name":"outside-web-dir"}');
    writeFileSync(path.join(root, "dist", "outside.txt"), "outside-web-dir");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function server(): Express {
    const api = express();
    api.get("/api/ping", (_req, res) => void res.json({ pong: true }));
    return createWebAppServer({ api, webDir, allowedHostPorts: [5199] });
  }

  it("serves index.html at / as HTML", async () => {
    const response = await request(server()).get("/").set(HOST);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.text).toBe(INDEX);
  });

  it("serves an asset with its content type", async () => {
    const js = await request(server()).get("/assets/app.js").set(HOST);
    expect(js.status).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect((await request(server()).get("/assets/app.css").set(HOST)).headers["content-type"]).toMatch(/text\/css/);
  });

  it("falls back to index.html for an extensionless client route", async () => {
    const response = await request(server()).get("/sessions/abc").set({ Host: "localhost:5199" });
    expect(response.status).toBe(200);
    expect(response.text).toBe(INDEX);
  });

  it("answers 404 for a missing asset and an unknown API route", async () => {
    expect((await request(server()).get("/assets/missing.js").set(HOST)).status).toBe(404);
    expect((await request(server()).get("/api/unknown").set(HOST)).status).toBe(404);
  });

  it("routes /api to the API app", async () => {
    expect((await request(server()).get("/api/ping").set(HOST)).body).toEqual({ pong: true });
  });

  it("sends nosniff and the CSP with the inline script hash on HTML, assets, API and 404 responses", async () => {
    for (const url of ["/", "/assets/app.js", "/api/ping", "/api/unknown"]) {
      const response = await request(server()).get(url).set(HOST);
      expect(response.headers["x-content-type-options"], url).toBe("nosniff");
      expect(response.headers["content-security-policy"], url).toBe(contentSecurityPolicy([sha(INLINE)]));
    }
    // send's own 404 carries a stricter `default-src 'none'`.
    const missing = await request(server()).get("/assets/missing.js").set(HOST);
    expect(missing.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("does not serve dotfiles", async () => {
    const response = await request(server()).get("/.secret").set(HOST);
    expect(response.status).toBe(404);
    expect(response.text).not.toContain("dotfile-secret");
  });

  it("lists no directory: a folder URL gets the app shell, never its entries", async () => {
    const response = await request(server()).get("/assets/").set(HOST);
    expect(response.text).toBe(INDEX);
  });

  it.each([
    "/../package.json",
    "/%2e%2e/package.json",
    "/..%2f..%2fpackage.json",
    "/assets/../../outside.txt",
    "/assets/%2e%2e/%2e%2e/outside.txt",
    "/%2e%2e/outside.txt",
  ])("refuses the traversal %s", async (urlPath) => {
    const response = await rawGet(createWebAppServer({ api: express(), webDir }), urlPath);
    expect(response.text).not.toContain("outside-web-dir");
    expect([301, 400, 403, 404]).toContain(response.status);
  });

  it("answers 403 for another Host name and for another port, on every route", async () => {
    for (const url of ["/", "/api/ping", "/assets/app.js"]) {
      expect((await request(server()).get(url).set({ Host: "evil.example" })).status, url).toBe(403);
      expect((await request(server()).get(url).set({ Host: "127.0.0.1:5200" })).status, url).toBe(403);
    }
  });

  it("keeps nosniff on a 403", async () => {
    const response = await request(server()).get("/").set({ Host: "evil.example" });
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
