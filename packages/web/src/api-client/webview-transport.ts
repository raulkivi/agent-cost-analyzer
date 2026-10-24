import type { ApiMethodName, ApiTransport } from "./transport.js";

// The slice of acquireVsCodeApi()'s result this transport needs.
export interface HostMessagePoster {
  postMessage(message: unknown): void;
}

// The slice of `window` this transport needs to hear the host's messages.
export interface MessageSource {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

// Unsolicited host -> webview notifications (plan §4 `HostEvent`).
export type HostEventName = "configChanged" | "themeChanged" | "selectSession";

export interface WebviewTransportOptions {
  // How long a request may wait for its response; insights over large
  // histories can be slow, hence the generous default.
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

interface Pending {
  method: ApiMethodName;
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ApiTransport over the VS Code webview <-> extension host message channel.
// Requests carry a unique id; the host's responses are matched back by it,
// so replies may arrive in any order.
export class WebviewTransport implements ApiTransport {
  private readonly pending = new Map<string, Pending>();
  private readonly eventHandlers = new Map<HostEventName, Set<(payload: unknown) => void>>();
  private readonly timeoutMs: number;
  private nextId = 0;

  constructor(
    private readonly host: HostMessagePoster,
    source: MessageSource,
    options: WebviewTransportOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    source.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  call<T>(method: ApiMethodName, params?: unknown): Promise<T> {
    const id = `req-${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request to ${method} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      // Registered before posting: a host may answer synchronously.
      this.pending.set(id, { method, resolve: resolve as (result: unknown) => void, reject, timer });
      this.host.postMessage({ kind: "request", id, method, params });
    });
  }

  // Subscribes to a host-pushed event; returns the unsubscribe function.
  onEvent(name: HostEventName, handler: (payload: unknown) => void): () => void {
    const handlers = this.eventHandlers.get(name) ?? new Set();
    handlers.add(handler);
    this.eventHandlers.set(name, handlers);
    return () => {
      handlers.delete(handler);
    };
  }

  private handleMessage(data: unknown): void {
    if (!isRecord(data)) return;
    if (data.kind === "event") {
      for (const handler of this.eventHandlers.get(data.name as HostEventName) ?? []) {
        handler(data.payload);
      }
      return;
    }
    if (data.kind !== "response" || typeof data.id !== "string") return;
    const entry = this.pending.get(data.id);
    if (!entry) return; // unknown, already answered or timed out
    this.pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.ok === true) {
      entry.resolve(data.result);
      return;
    }
    const status = isRecord(data.error) ? data.error.status : undefined;
    entry.reject(new Error(`Request to ${entry.method} failed with status ${String(status)}`));
  }
}
