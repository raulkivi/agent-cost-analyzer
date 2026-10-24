// Typed failures ApiService throws instead of HTTP statuses, so the Express
// adapter (app.ts) and the extension's message dispatcher map them the same
// way (vscode-extension.md D2/§4). The message is the one the API sends to
// the client as-is. Any other error is an internal failure.
export class ApiError extends Error {}

// The caller's input is invalid (bad turn index, threshold, provider id or
// query) — 400.
export class BadRequestError extends ApiError {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

// The session, turn, scenario or artifact asked for doesn't exist — 404.
export class NotFoundError extends ApiError {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// A source read failed and the service has already worded the failure for
// the client ("Failed to load …") — 500.
export class InternalError extends ApiError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "InternalError";
  }
}

// The status both transports report for an error ApiService threw
// (vscode-extension.md §4: the webview RPC uses the HTTP API's numbers).
export function statusForApiError(error: unknown): 400 | 404 | 500 {
  if (error instanceof BadRequestError) {
    return 400;
  }
  if (error instanceof NotFoundError) {
    return 404;
  }
  return 500;
}
