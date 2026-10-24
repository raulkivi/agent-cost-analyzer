import { standaloneHostCapabilities, type HostCapabilities } from "./host-capabilities.js";

// Like api-client/current-transport.ts: main.tsx installs the host's
// capabilities once at startup; the standalone default keeps existing
// tests and the standalone app working unchanged.
let current: HostCapabilities | undefined;

export function setHostCapabilities(capabilities: HostCapabilities): void {
  current = capabilities;
}

export function getHostCapabilities(): HostCapabilities {
  current ??= standaloneHostCapabilities();
  return current;
}

// Test helper: back to the standalone default.
export function resetHostCapabilities(): void {
  current = undefined;
}
