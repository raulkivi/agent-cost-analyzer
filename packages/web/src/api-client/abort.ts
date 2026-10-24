// What a call rejects with when its AbortSignal fires: the same AbortError
// fetch rejects with, so the HTTP and webview transports look alike.
export function abortError(): Error {
  return new DOMException("The request was cancelled.", "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}
