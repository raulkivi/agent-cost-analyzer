import { HttpTransport } from "./http-transport.js";
import type { ApiTransport } from "./transport.js";

// How api-client gets its transport: a module-level setter/getter rather
// than a React context. The api-client functions are plain async functions
// called from effects and handlers, so a module-level seam keeps every
// component untouched; main.tsx installs the transport once at startup, and
// the HTTP default keeps the standalone app and existing tests working.
let current: ApiTransport | undefined;

export function setApiTransport(transport: ApiTransport): void {
  current = transport;
}

export function getApiTransport(): ApiTransport {
  current ??= new HttpTransport();
  return current;
}

// Test helper: back to the default HTTP transport.
export function resetApiTransport(): void {
  current = undefined;
}
