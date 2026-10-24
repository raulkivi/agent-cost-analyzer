import { HttpTransport } from "./http-transport.js";
import type { ApiTransport } from "./transport.js";
import { WebviewTransport, type HostMessagePoster, type MessageSource } from "./webview-transport.js";

// What startup needs from `window`: message events, plus the global that
// VS Code injects into webviews (and only there).
export interface TransportHost extends MessageSource {
  acquireVsCodeApi?: () => HostMessagePoster;
}

// Webview transport inside VS Code, HTTP to the standalone server otherwise.
export function selectTransport(host: TransportHost): ApiTransport {
  return host.acquireVsCodeApi
    ? new WebviewTransport(host.acquireVsCodeApi(), host)
    : new HttpTransport();
}
