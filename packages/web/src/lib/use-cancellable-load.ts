import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "../api-client/abort.js";

export type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "error"; message: string }
  // The person pressed Cancel: not a failure, so no error alert.
  | { kind: "cancelled" };

// Runs `load` whenever the function changes (wrap it in useCallback over what
// it depends on) and again on retry(). cancel() aborts the request's signal
// and shows the cancelled state; a request that is superseded or outlived by
// its component is aborted too, and whatever it later answers is ignored.
// Not loading while `enabled` is false.
export function useCancellableLoad<T>(load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [state, setState] = useState<LoadState<T>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const own = new AbortController();
    controller.current = own;
    setState({ kind: "loading" });
    load(own.signal)
      .then((data) => {
        if (!own.signal.aborted) setState({ kind: "ready", data });
      })
      .catch((error: unknown) => {
        if (own.signal.aborted) return;
        setState(
          isAbortError(error)
            ? { kind: "cancelled" }
            : { kind: "error", message: error instanceof Error ? error.message : String(error) },
        );
      });
    return () => own.abort();
  }, [load, enabled, attempt]);

  const cancel = useCallback(() => {
    controller.current?.abort();
    setState({ kind: "cancelled" });
  }, []);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  return { state, cancel, retry };
}
