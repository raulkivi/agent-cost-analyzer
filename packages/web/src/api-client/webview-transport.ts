import type { HostCommand, HostCommandArgs, HostEventName, PerformanceMarkName } from "@agent-cost-analyzer/domain";
import { abortError } from "./abort.js";
import type { ApiMethodName, ApiTransport, ViewStatePersistence } from "./transport.js";

// The slice of acquireVsCodeApi()'s result this transport needs; the state
// methods are optional so a bare poster (tests, other hosts) still works.
export interface HostMessagePoster extends Partial<ViewStatePersistence> {
  postMessage(message: unknown): void;
}

// The slice of `window` this transport needs to hear the host's messages.
export interface MessageSource {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export interface WebviewTransportOptions {
  // How long a request may wait for its response; insights over large
  // histories can be slow, hence the generous default.
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

interface Pending {
  // The method or host command, for error messages.
  method: ApiMethodName | HostCommand;
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
  // The webview's own state persistence, when its API has one: the
  // transport holds the only acquireVsCodeApi() result there can be.
  readonly viewState?: ViewStatePersistence;

  constructor(
    private readonly host: HostMessagePoster,
    source: MessageSource,
    options: WebviewTransportOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { getState, setState } = host;
    if (getState && setState) {
      this.viewState = { getState: () => getState.call(host), setState: (state) => setState.call(host, state) };
    }
    source.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  // With a signal, aborting rejects the call with an AbortError, forgets its
  // id (a late reply is then ignored like any unknown one) and posts
  // { kind: "cancel", id } so the host drops the request too.
  call<T>(method: ApiMethodName, params?: unknown, signal?: AbortSignal): Promise<T> {
    return this.send<T>(method, (id) => ({ kind: "request", id, method, params }), signal);
  }

  // A host command (domain rpc.ts, G8): same ids, timeout and errors as a
  // request; the host's reply carries no result.
  async command<C extends HostCommand>(command: C, args: HostCommandArgs[C]): Promise<void> {
    await this.send<unknown>(command, (id) => ({ kind: "command", id, command, args }));
  }

  // One of the web app's timing marks (domain rpc.ts, perfMark), for the
  // host to record. One-way: no id, no reply, nothing pending.
  reportPerformanceMark(name: PerformanceMarkName, timeMs: number): void {
    this.host.postMessage({ kind: "perfMark", name, timeMs });
  }

  private send<T>(name: ApiMethodName | HostCommand, envelope: (id: string) => unknown, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError());
    const id = `req-${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer);
        this.host.postMessage({ kind: "cancel", id });
        reject(abortError());
      };
      const release = () => signal?.removeEventListener("abort", onAbort);
      const timer = setTimeout(() => {
        this.pending.delete(id);
        release();
        reject(new Error(`Request to ${name} timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      // Registered before posting: a host may answer synchronously.
      this.pending.set(id, {
        method: name,
        resolve: (result) => {
          release();
          resolve(result as T);
        },
        reject: (error) => {
          release();
          reject(error);
        },
        timer,
      });
      this.host.postMessage(envelope(id));
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
