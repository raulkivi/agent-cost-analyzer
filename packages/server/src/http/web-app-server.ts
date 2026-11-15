// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import { createLoopbackHostGuard } from "./loopback-host-guard.js";
import { contentSecurityPolicy, createSecurityHeaders, inlineScriptHashes } from "./security-headers.js";

export interface WebAppServerOptions {
  // The API (createApp's app), served under /api.
  api: Express;
  // The built web app (packages/web/dist, or the package's dist/web).
  webDir: string;
  // Ports a Host header may name; omitted accepts any loopback port (tests).
  allowedHostPorts?: readonly number[];
}

// A last segment with a dot is a file request (a missing asset is a 404, and
// a dotfile never becomes the app shell); anything else is a client route.
const isClientRoute = (urlPath: string): boolean => !/\.[^/]*$/.test(urlPath.split("/").pop() ?? "");

/**
 * The npm package's one origin (npm-package.md §4.4): security headers and
 * the Host guard first, then the API, then the web app read-only: no
 * directory listing, no dotfiles, traversal refused by `send`, and the app
 * shell for `/` and client routes.
 */
export function createWebAppServer({ api, webDir, allowedHostPorts }: WebAppServerOptions): Express {
  const root = path.resolve(webDir);
  // Read once: the shell served is the one the CSP's inline-script hash was
  // computed from, and serving it touches no file per request.
  const shell = readFileSync(path.join(root, "index.html"), "utf8");
  const policy = contentSecurityPolicy(inlineScriptHashes(shell));

  const server = express();
  server.disable("x-powered-by");
  server.use(createSecurityHeaders(policy));
  server.use(createLoopbackHostGuard({ allowedPorts: allowedHostPorts }));
  server.use(api);
  server.use("/api", (_req, res) => void res.status(404).json({ error: "Not found" }));
  server.use(express.static(root, { dotfiles: "ignore", index: false, redirect: false, etag: true }));
  server.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || !isClientRoute(req.path)) {
      next();
      return;
    }
    res.type("html").send(shell);
  });
  return server;
}
