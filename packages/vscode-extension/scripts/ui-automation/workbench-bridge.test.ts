// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BRIDGE_EXTENSION_ID,
  BRIDGE_VERSION,
  bridgeManifest,
  installWorkbenchBridge,
  normalModeVscodeArgs,
  wdioProxyModule,
} from "./workbench-bridge.mts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "aica-bridge-test-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function readManifest(extensionsDir: string): { identifier: { id: string }; version: string; relativeLocation: string; location: { path: string; scheme: string } }[] {
  return JSON.parse(readFileSync(path.join(extensionsDir, "extensions.json"), "utf-8"));
}

describe("normal mode for the real-Copilot suite (G3)", () => {
  it("overrides the service's own extensionTestsPath key, so VS Code gets an empty tests path and keeps its storage on disk", () => {
    // wdio-vscode-service builds { ...its args, ...vscodeArgs }: only the same camelCase key replaces its value.
    const serviceArgs = { extensionTestsPath: "/node_modules/wdio-vscode-service/dist/proxy/cjs/entry.js", disableExtensions: true };

    expect({ ...serviceArgs, ...normalModeVscodeArgs("/run/storage") }).toMatchObject({ extensionTestsPath: "", disableExtensions: true });
  });

  it("keeps VS Code's shared storage in the run's own storage, not the owner's ~/.vscode-shared", () => {
    expect(normalModeVscodeArgs("/run/storage")["shared-data-dir"]).toBe(path.join("/run/storage", "shared-data"));
  });

  it("finds the service's proxy module, the one its test runner would load", () => {
    const proxy = wdioProxyModule();

    expect(proxy.endsWith(path.join("wdio-vscode-service", "dist", "proxy", "index.js"))).toBe(true);
    expect(existsSync(proxy)).toBe(true);
  });
});

describe("the workbench bridge extension", () => {
  it("is a test-only extension that starts with VS Code", () => {
    const manifest = bridgeManifest();

    expect(`${manifest.publisher}.${manifest.name}`).toBe(BRIDGE_EXTENSION_ID);
    expect(manifest.version).toBe(BRIDGE_VERSION);
    expect(manifest.main).toBe("./extension.js");
    expect(manifest.activationEvents).toEqual(["*"]);
  });

  it("installs into the launch's extensions dir and lists itself in extensions.json", () => {
    const extensionsDir = path.join(root, "extensions");

    installWorkbenchBridge({ extensionsDir, proxyModule: "/proxy/index.js" });

    const folder = `${BRIDGE_EXTENSION_ID}-${BRIDGE_VERSION}`;
    expect(JSON.parse(readFileSync(path.join(extensionsDir, folder, "package.json"), "utf-8"))).toEqual(bridgeManifest());
    expect(readManifest(extensionsDir)).toEqual([
      {
        identifier: { id: BRIDGE_EXTENSION_ID },
        version: BRIDGE_VERSION,
        location: { $mid: 1, path: path.join(extensionsDir, folder), scheme: "file" },
        relativeLocation: folder,
      },
    ]);
  });

  it("keeps the extensions already listed and lists itself once when installed twice", () => {
    const extensionsDir = path.join(root, "extensions");
    mkdirSync(extensionsDir);
    const other = { identifier: { id: "someone.other" }, version: "1.0.0", relativeLocation: "someone.other-1.0.0" };
    writeFileSync(path.join(extensionsDir, "extensions.json"), JSON.stringify([other]));

    installWorkbenchBridge({ extensionsDir, proxyModule: "/proxy/index.js" });
    installWorkbenchBridge({ extensionsDir, proxyModule: "/proxy/index.js" });

    expect(readManifest(extensionsDir).map((entry) => entry.identifier.id)).toEqual(["someone.other", BRIDGE_EXTENSION_ID]);
  });

  it("on activation, runs the proxy module with the vscode API, as the service's test runner would", async () => {
    const extensionsDir = path.join(root, "extensions");
    // A stand-in proxy that records what it was given, and a stand-in `vscode` module.
    const proxyModule = path.join(root, "proxy.mjs");
    writeFileSync(proxyModule, "export function run(vscode) { globalThis.bridgeRuns = [...(globalThis.bridgeRuns ?? []), vscode]; return new Promise(() => {}); }\n");
    mkdirSync(path.join(extensionsDir, "node_modules", "vscode"), { recursive: true });
    writeFileSync(path.join(extensionsDir, "node_modules", "vscode", "index.js"), "module.exports = { version: 'fake' };\n");
    installWorkbenchBridge({ extensionsDir, proxyModule });

    const requireBridge = createRequire(path.join(extensionsDir, `${BRIDGE_EXTENSION_ID}-${BRIDGE_VERSION}`, "package.json"));
    const bridge = requireBridge("./extension.js") as { activate(): Promise<void> };
    await bridge.activate();

    const runs = (globalThis as { bridgeRuns?: unknown[] }).bridgeRuns;
    expect(runs).toEqual([{ version: "fake" }]);
    delete (globalThis as { bridgeRuns?: unknown[] }).bridgeRuns;
  });
});
