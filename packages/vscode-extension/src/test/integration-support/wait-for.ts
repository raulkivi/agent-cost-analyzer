export interface WaitForOptions {
  timeoutMs: number;
  // How long to wait between reads; 50 ms by default.
  intervalMs?: number;
  // What is being waited for, for the timeout's message.
  description: string;
}

const DEFAULT_INTERVAL_MS = 50;

function describeValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// Reads until `accept` takes the value, or rejects after `timeoutMs` with
// what it waited for and the last value (or error) it saw. A read that
// throws is retried: in a real VS Code, a command or view may not exist
// yet. The integration suite's only way to wait on the extension.
export async function waitFor<T>(
  read: () => T | PromiseLike<T>,
  accept: (value: T) => boolean,
  { timeoutMs, intervalMs = DEFAULT_INTERVAL_MS, description }: WaitForOptions,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: { value: T } | { error: unknown } | undefined;
  for (;;) {
    try {
      const value = await read();
      if (accept(value)) {
        return value;
      }
      last = { value };
    } catch (error) {
      last = { error };
    }
    if (Date.now() >= deadline) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const seen =
    last === undefined
      ? "nothing read"
      : "error" in last
        ? `last error: ${last.error instanceof Error ? last.error.message : String(last.error)}`
        : `last value: ${describeValue(last.value)}`;
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}; ${seen}`);
}
