// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Browser opener (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/npm-package.md §4.5): one opener per OS, no shell, skip rules.
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { loopbackUrl, openBrowser, type OpenOptions, type Spawner } from "../src/open-browser.js";

type Call = { program: string; args: readonly string[]; options: Record<string, unknown> };

function fakeSpawner(behavior: "spawn" | "error" | "throw" = "spawn") {
  const calls: Call[] = [];
  let unrefs = 0;
  const spawner: Spawner = (program, args, options) => {
    calls.push({ program, args, options: { ...options } });
    if (behavior === "throw") throw new Error("boom");
    const child = Object.assign(new EventEmitter(), {
      unref: () => {
        unrefs += 1;
      },
    });
    queueMicrotask(() =>
      behavior === "error" ? child.emit("error", new Error("ENOENT")) : child.emit("spawn"),
    );
    return child;
  };
  return { spawner, calls, unrefs: () => unrefs };
}

const URL_ = "http://127.0.0.1:4317/";
const OPTS = { shell: false, detached: true, stdio: "ignore" };

describe("loopbackUrl", () => {
  it("builds the loopback URL from a port", () => {
    expect(loopbackUrl(4317)).toBe(URL_);
    expect(loopbackUrl(1)).toBe("http://127.0.0.1:1/");
    expect(loopbackUrl(65535)).toBe("http://127.0.0.1:65535/");
  });
  it.each([0, -1, 65536, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (p) => {
    expect(() => loopbackUrl(p)).toThrow(RangeError);
  });
  it("rejects non-numbers", () => {
    expect(() => loopbackUrl("80; rm -rf" as unknown as number)).toThrow(RangeError);
  });
});

describe("openBrowser spawning", () => {
  it.each([
    ["darwin", "open", [URL_], {}],
    ["linux", "xdg-open", [URL_], { DISPLAY: ":0" }],
    ["win32", "rundll32", ["url.dll,FileProtocolHandler", URL_], {}],
  ] as const)("%s runs %s without a shell", async (platform, program, args, env) => {
    const f = fakeSpawner();
    const result = await openBrowser({ port: 4317, platform, env, spawner: f.spawner });
    expect(result).toEqual({ status: "opened" });
    expect(f.calls).toEqual([{ program, args, options: OPTS }]);
    expect(f.calls[0]?.options.shell).toBe(false);
    expect(f.unrefs()).toBe(1);
  });

  it("opens on Linux with only WAYLAND_DISPLAY", async () => {
    const f = fakeSpawner();
    const result = await openBrowser({
      port: 4317,
      platform: "linux",
      env: { WAYLAND_DISPLAY: "wayland-0" },
      spawner: f.spawner,
    });
    expect(result.status).toBe("opened");
    expect(f.calls[0]?.program).toBe("xdg-open");
  });
});

describe("openBrowser skip rules", () => {
  const cases: [string, Partial<OpenOptions>][] = [
    ["open:false", { open: false, platform: "darwin", env: {} }],
    ["CI", { platform: "darwin", env: { CI: "true" } }],
    ["no-display", { platform: "linux", env: {} }],
    ["unsupported-platform", { platform: "freebsd", env: { DISPLAY: ":0" } }],
  ];

  it.each(cases)("skips: %s", async (reason, options) => {
    const f = fakeSpawner();
    const result = await openBrowser({ port: 4317, ...options, spawner: f.spawner });
    expect(result).toEqual({ status: "skipped", reason });
    expect(f.calls).toHaveLength(0);
  });

  it("ignores an empty CI value", async () => {
    const f = fakeSpawner();
    const result = await openBrowser({ port: 1, platform: "darwin", env: { CI: "" }, spawner: f.spawner });
    expect(result.status).toBe("opened");
  });
});

describe("openBrowser failures", () => {
  it("reports an error event as failed", async () => {
    const f = fakeSpawner("error");
    const result = await openBrowser({ port: 4317, platform: "darwin", env: {}, spawner: f.spawner });
    expect(result).toEqual({ status: "failed", message: "ENOENT" });
  });
  it("reports a synchronous throw as failed", async () => {
    const f = fakeSpawner("throw");
    const result = await openBrowser({ port: 4317, platform: "win32", env: {}, spawner: f.spawner });
    expect(result).toEqual({ status: "failed", message: "boom" });
  });
  it("rejects an invalid port before spawning", async () => {
    const f = fakeSpawner();
    await expect(
      openBrowser({ port: 0, platform: "darwin", env: {}, spawner: f.spawner }),
    ).rejects.toThrow(RangeError);
    expect(f.calls).toHaveLength(0);
  });
});
