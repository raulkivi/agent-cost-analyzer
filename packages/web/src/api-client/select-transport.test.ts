import { describe, expect, it, vi } from "vitest";
import { HttpTransport } from "./http-transport.js";
import { selectTransport } from "./select-transport.js";
import { WebviewTransport } from "./webview-transport.js";

const fakeWindow = () => ({ addEventListener: vi.fn(), removeEventListener: vi.fn() });

describe("selectTransport", () => {
  it("uses HTTP when there is no acquireVsCodeApi (standalone browser)", () => {
    expect(selectTransport(fakeWindow())).toBeInstanceOf(HttpTransport);
  });

  it("uses the webview transport when acquireVsCodeApi exists", () => {
    const postMessage = vi.fn();
    const acquireVsCodeApi = vi.fn(() => ({ postMessage }));
    const transport = selectTransport({ ...fakeWindow(), acquireVsCodeApi });
    expect(transport).toBeInstanceOf(WebviewTransport);
    // VS Code allows acquireVsCodeApi to be called only once.
    expect(acquireVsCodeApi).toHaveBeenCalledTimes(1);
  });

  it("wires the webview transport to the injected API and window", () => {
    const postMessage = vi.fn();
    const win = { ...fakeWindow(), acquireVsCodeApi: () => ({ postMessage }) };
    void selectTransport(win).call("getHealth").catch(() => undefined);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "request", method: "getHealth" }));
    expect(win.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  });
});
