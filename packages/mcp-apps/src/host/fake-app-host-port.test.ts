// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { FakeAppHostPort } from "./fake-app-host-port.js";
import type { HostContext } from "./app-host-port.js";

// The fake answers requestDisplayMode the way a host does: it switches to a
// mode it lists and tells the view through the host context; otherwise it
// declines and keeps the current mode.

function contextsOf(port: FakeAppHostPort): HostContext[] {
  const seen: HostContext[] = [];
  port.onHostContext((context) => seen.push(context));
  return seen;
}

describe("FakeAppHostPort.requestDisplayMode", () => {
  it("switches to a listed mode and pushes it in the host context", async () => {
    const port = new FakeAppHostPort();
    port.pushHostContext({ displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] });
    const seen = contextsOf(port);

    await expect(port.requestDisplayMode("fullscreen")).resolves.toBe("fullscreen");

    expect(seen.at(-1)?.displayMode).toBe("fullscreen");
    expect(port.calls).toContainEqual({ method: "requestDisplayMode", args: ["fullscreen"] });
  });

  it("declines a mode the host does not list and keeps the current one", async () => {
    const port = new FakeAppHostPort();
    port.pushHostContext({ displayMode: "inline", availableDisplayModes: ["inline"] });

    await expect(port.requestDisplayMode("fullscreen")).resolves.toBe("inline");
  });

  it("declines when the host has not sent any display modes", async () => {
    const port = new FakeAppHostPort();
    await expect(port.requestDisplayMode("fullscreen")).resolves.toBe("inline");
  });
});
