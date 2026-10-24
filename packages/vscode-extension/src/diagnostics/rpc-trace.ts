export interface RpcTraceEntry {
  // The ApiService method the webview asked for.
  method: string;
  ok: boolean;
  // The error status of a failed reply.
  status?: number;
  // The session the request was about (its `id` or `sessionId` param).
  sessionId?: string;
}

const DEFAULT_CAPACITY = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sessionIdOf(params: unknown): string | undefined {
  if (!isRecord(params)) {
    return undefined;
  }
  const id = params.sessionId ?? params.id;
  return typeof id === "string" ? id : undefined;
}

// Which requests the webview made and how each was answered, so step
// 10.9's integration tests can check that the real webview round-tripped
// them (getHealth, getProductProfile, a selected session's getSession...).
// Only the method, outcome and session id are kept, never a result, and
// only the most recent entries. Free of `vscode`; composition.ts feeds it
// each webview message with the dispatcher's reply.
export class RpcTrace {
  private readonly recorded: RpcTraceEntry[] = [];

  constructor(private readonly capacity = DEFAULT_CAPACITY) {}

  // A request with the reply posted for it. Anything else (host commands,
  // cancels, timing marks, a cancelled request's dropped reply) is ignored.
  observe(message: unknown, reply: unknown): void {
    if (!isRecord(message) || message.kind !== "request" || typeof message.method !== "string") {
      return;
    }
    if (!isRecord(reply) || reply.kind !== "response" || reply.id !== message.id) {
      return;
    }
    const entry: RpcTraceEntry = { method: message.method, ok: reply.ok === true };
    if (isRecord(reply.error) && typeof reply.error.status === "number") {
      entry.status = reply.error.status;
    }
    const sessionId = sessionIdOf(message.params);
    if (sessionId !== undefined) {
      entry.sessionId = sessionId;
    }
    this.recorded.push(entry);
    if (this.recorded.length > this.capacity) {
      this.recorded.splice(0, this.recorded.length - this.capacity);
    }
  }

  // Oldest first; a copy.
  entries(): RpcTraceEntry[] {
    return this.recorded.map((entry) => ({ ...entry }));
  }

  clear(): void {
    this.recorded.length = 0;
  }
}
