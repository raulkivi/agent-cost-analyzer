import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTransport } from "../api-client/http-transport.js";
import type { ApiTransport } from "../api-client/transport.js";
import { getHostCapabilities, resetHostCapabilities, setHostCapabilities } from "./current-host-capabilities.js";
import { hostCapabilitiesFor, standaloneHostCapabilities } from "./host-capabilities.js";

describe("standaloneHostCapabilities (vscode-extension.md G8)", () => {
  it("copies through the browser clipboard, resolved when copying", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const capabilities = standaloneHostCapabilities(() => ({ writeText }));

    await capabilities.copyToClipboard("bundle");

    expect(writeText).toHaveBeenCalledWith("bundle");
  });

  it("has no host to open settings or documents in, so those affordances stay hidden", () => {
    const capabilities = standaloneHostCapabilities(() => ({ writeText: vi.fn() }));

    expect(capabilities.openSetting).toBeUndefined();
    expect(capabilities.openTextDocument).toBeUndefined();
  });

  it("defaults to navigator.clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await standaloneHostCapabilities().copyToClipboard("x");

    expect(writeText).toHaveBeenCalledWith("x");
  });
});

describe("hostCapabilitiesFor", () => {
  it("is the standalone set over HTTP, which has no host commands", () => {
    const capabilities = hostCapabilitiesFor(new HttpTransport());

    expect(capabilities.openSetting).toBeUndefined();
    expect(capabilities.openTextDocument).toBeUndefined();
    expect(capabilities.copyToClipboard).toBeTypeOf("function");
  });

  it("sends every capability to the host as a command when the transport has one", async () => {
    const command = vi.fn().mockResolvedValue(undefined);
    const transport: ApiTransport = { call: vi.fn(), command };
    const capabilities = hostCapabilitiesFor(transport);

    await capabilities.openSetting?.("github.copilot.chat.agentDebugLog.fileLogging.enabled");
    await capabilities.copyToClipboard("bundle");
    await capabilities.openTextDocument?.("prompt", "plaintext");

    expect(command.mock.calls).toEqual([
      ["openSetting", { settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled" }],
      ["copyToClipboard", { text: "bundle" }],
      ["openTextDocument", { content: "prompt", language: "plaintext" }],
    ]);
  });

  it("passes a host refusal on to the caller", async () => {
    const transport: ApiTransport = { call: vi.fn(), command: vi.fn().mockRejectedValue(new Error("status 400")) };

    await expect(hostCapabilitiesFor(transport).openSetting?.("x")).rejects.toThrow("status 400");
  });
});

describe("current host capabilities", () => {
  afterEach(() => {
    resetHostCapabilities();
  });

  it("defaults to the standalone set", () => {
    expect(getHostCapabilities().openSetting).toBeUndefined();
    expect(getHostCapabilities().copyToClipboard).toBeTypeOf("function");
  });

  it("returns what startup installed, until reset", () => {
    const installed = { copyToClipboard: vi.fn(), openSetting: vi.fn() };
    setHostCapabilities(installed);

    expect(getHostCapabilities()).toBe(installed);
    resetHostCapabilities();
    expect(getHostCapabilities()).not.toBe(installed);
  });
});
