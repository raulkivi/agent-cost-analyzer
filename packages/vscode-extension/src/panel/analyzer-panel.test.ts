import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AnalyzerPanel,
  type AnalyzerPanelDeps,
  type Disposable,
  type PanelWebview,
  type WebviewPanelHandle,
  type WebviewPanelOptions,
} from "./analyzer-panel.js";

const MEDIA_DIR = path.join("/ext", "media");

class FakeWebview implements PanelWebview {
  readonly cspSource = "vscode-webview://fake";
  html = "";
  readonly posted: unknown[] = [];
  messageListener: ((message: unknown) => void) | undefined;
  readonly messageSubscription = { dispose: vi.fn(() => (this.messageListener = undefined)) };

  asWebviewUri(fsPath: string): string {
    return `vscode-webview://fake${fsPath}`;
  }

  async postMessage(message: unknown): Promise<boolean> {
    this.posted.push(message);
    return true;
  }

  onDidReceiveMessage(listener: (message: unknown) => void): Disposable {
    this.messageListener = listener;
    return this.messageSubscription;
  }
}

class FakePanel implements WebviewPanelHandle {
  readonly webview = new FakeWebview();
  readonly reveal = vi.fn();
  disposed = false;
  private disposeListener: (() => void) | undefined;
  private visibilityListener: ((visible: boolean) => void) | undefined;

  onDidChangeVisibility(listener: (visible: boolean) => void): Disposable {
    this.visibilityListener = listener;
    return { dispose: () => undefined };
  }

  // Like VS Code, with retainContextWhenHidden off: hiding destroys the
  // webview's page, and showing it loads the page again.
  setVisible(visible: boolean): void {
    this.visibilityListener?.(visible);
  }

  onDidDispose(listener: () => void): Disposable {
    this.disposeListener = listener;
    return { dispose: () => undefined };
  }

  // Like VS Code: disposing (or the user closing the tab) fires onDidDispose.
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeListener?.();
  }
}

function setup(overrides: Partial<AnalyzerPanelDeps> = {}) {
  const panels: FakePanel[] = [];
  const createPanel = vi.fn((options: WebviewPanelOptions) => {
    void options;
    const panel = new FakePanel();
    panels.push(panel);
    return panel;
  });
  const renderHtml = vi.fn((webview: { cspSource: string; assetUri(relativePath: string): string }) =>
    `<html>${webview.cspSource} ${webview.assetUri("assets/index.js")}</html>`,
  );
  const handleMessage = vi.fn(async (message: unknown) => ({ kind: "response", echo: message }));
  const panel = new AnalyzerPanel({ createPanel, mediaDir: MEDIA_DIR, renderHtml, handleMessage, ...overrides });
  return { panel, panels, createPanel, renderHtml, handleMessage };
}

describe("AnalyzerPanel", () => {
  it("creates a script-enabled panel whose only local resource root is media/, without retainContextWhenHidden", () => {
    const { panel, createPanel } = setup();

    panel.open();

    expect(createPanel).toHaveBeenCalledWith({
      viewType: "aiCreditsAnalyzer.panel",
      title: "AI Credits Analyzer",
      enableScripts: true,
      localResourceRoots: [MEDIA_DIR],
      retainContextWhenHidden: false,
    });
  });

  it("renders the HTML with the webview's CSP source and media/ asset URIs", () => {
    const { panel, panels } = setup();

    panel.open();

    expect(panels[0]?.webview.html).toBe(
      `<html>vscode-webview://fake vscode-webview://fake${path.join(MEDIA_DIR, "assets", "index.js")}</html>`,
    );
  });

  it("reveals the open panel instead of creating a second one", () => {
    const { panel, panels, createPanel } = setup();

    panel.open();
    panel.open();

    expect(createPanel).toHaveBeenCalledTimes(1);
    expect(panels[0]?.reveal).toHaveBeenCalledTimes(1);
  });

  it("answers each webview message with the handler's reply", async () => {
    const { panel, panels, handleMessage } = setup();
    panel.open();
    const webview = panels[0]!.webview;

    webview.messageListener?.({ kind: "request", id: "req-1" });
    await vi.waitFor(() => expect(webview.posted).toHaveLength(1));

    expect(handleMessage).toHaveBeenCalledWith({ kind: "request", id: "req-1" });
    expect(webview.posted[0]).toEqual({ kind: "response", echo: { kind: "request", id: "req-1" } });
  });

  it("posts nothing when the handler has no reply", async () => {
    const handleMessage = vi.fn(async () => undefined);
    const { panel, panels } = setup({ handleMessage });
    panel.open();

    panels[0]!.webview.messageListener?.({ kind: "event" });
    await vi.waitFor(() => expect(handleMessage).toHaveBeenCalled());

    expect(panels[0]!.webview.posted).toEqual([]);
  });

  it("drops a reply that can't be delivered rather than leaving a rejection unhandled", async () => {
    const handleMessage = vi.fn(async () => {
      throw new Error("dispatcher bug");
    });
    const onUnhandled = vi.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      const { panel, panels } = setup({ handleMessage });
      panel.open();

      panels[0]!.webview.messageListener?.({ kind: "request", id: "req-1" });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onUnhandled).not.toHaveBeenCalled();
      expect(panels[0]!.webview.posted).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("opens a fresh panel after the user closes it, and drops the old message listener", () => {
    const { panel, panels, createPanel } = setup();
    panel.open();

    panels[0]!.dispose();
    panel.open();

    expect(createPanel).toHaveBeenCalledTimes(2);
    expect(panels[0]!.webview.messageSubscription.dispose).toHaveBeenCalled();
    expect(panels[1]!.reveal).not.toHaveBeenCalled();
  });

  it("closes the panel again when its HTML can't be built, so the next open retries", () => {
    const renderHtml = vi.fn(() => {
      throw new Error("no manifest");
    });
    const { panel, panels, createPanel } = setup({ renderHtml });

    expect(() => panel.open()).toThrow("no manifest");
    expect(panels[0]!.disposed).toBe(true);
    expect(() => panel.open()).toThrow("no manifest");
    expect(createPanel).toHaveBeenCalledTimes(2);
  });

  it("disposes the open panel when it's disposed itself (deactivate)", () => {
    const { panel, panels } = setup();
    panel.open();

    panel.dispose();

    expect(panels[0]!.disposed).toBe(true);
    expect(panels[0]!.webview.messageSubscription.dispose).toHaveBeenCalled();
    expect(() => panel.dispose()).not.toThrow();
  });

  describe("post (host events)", () => {
    it("posts the message to the open panel's webview", async () => {
      const { panel, panels } = setup();
      panel.open();

      panel.post({ kind: "event", name: "configChanged" });

      await vi.waitFor(() => expect(panels[0]!.webview.posted).toEqual([{ kind: "event", name: "configChanged" }]));
    });

    it("does nothing when no panel is open, or after it was closed", () => {
      const { panel, panels } = setup();

      expect(() => panel.post({ kind: "event", name: "configChanged" })).not.toThrow();
      panel.open();
      panels[0]!.dispose();
      panel.post({ kind: "event", name: "configChanged" });

      expect(panels[0]!.webview.posted).toEqual([]);
    });

    it("drops a message that can't be delivered rather than leaving a rejection unhandled", async () => {
      const onUnhandled = vi.fn();
      process.on("unhandledRejection", onUnhandled);
      try {
        const { panel, panels } = setup();
        panel.open();
        panels[0]!.webview.postMessage = () => Promise.reject(new Error("webview disposed"));

        panel.post({ kind: "event", name: "configChanged" });
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(onUnhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });

  describe("postWhenReady (a host event that must not be lost, e.g. selectSession)", () => {
    const selectSession = { kind: "event", name: "selectSession", payload: { sessionId: "s1" } };

    it("posts at once when the webview has already sent a message", async () => {
      const { panel, panels } = setup();
      panel.open();
      panels[0]!.webview.messageListener?.({ kind: "request", id: "1" });

      panel.postWhenReady(selectSession);

      await vi.waitFor(() => expect(panels[0]!.webview.posted).toContainEqual(selectSession));
    });

    it("holds the message of a just-created panel until the webview's first message, then posts it once", async () => {
      const { panel, panels } = setup();
      panel.open();

      panel.postWhenReady(selectSession);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(panels[0]!.webview.posted).toEqual([]);

      panels[0]!.webview.messageListener?.({ kind: "request", id: "1" });
      panels[0]!.webview.messageListener?.({ kind: "request", id: "2" });

      await vi.waitFor(() => expect(panels[0]!.webview.posted.filter((m) => m === selectSession)).toHaveLength(1));
    });

    it("keeps only the latest held message", async () => {
      const { panel, panels } = setup();
      panel.open();
      const other = { kind: "event", name: "selectSession", payload: { sessionId: "s2" } };

      panel.postWhenReady(selectSession);
      panel.postWhenReady(other);
      panels[0]!.webview.messageListener?.({ kind: "request", id: "1" });

      await vi.waitFor(() => expect(panels[0]!.webview.posted).toContainEqual(other));
      expect(panels[0]!.webview.posted).not.toContainEqual(selectSession);
    });

    it("holds the message again while the panel is hidden, because its page reloads when shown", async () => {
      const { panel, panels } = setup();
      panel.open();
      panels[0]!.webview.messageListener?.({ kind: "request", id: "1" });
      await vi.waitFor(() => expect(panels[0]!.webview.posted).toHaveLength(1));
      panels[0]!.setVisible(false);

      panel.postWhenReady(selectSession);
      panels[0]!.setVisible(true);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(panels[0]!.webview.posted).not.toContainEqual(selectSession);

      panels[0]!.webview.messageListener?.({ kind: "request", id: "2" });

      await vi.waitFor(() => expect(panels[0]!.webview.posted).toContainEqual(selectSession));
    });

    it("does not carry a held message, or readiness, over to a panel opened later", async () => {
      const { panel, panels } = setup();
      panel.open();
      panel.postWhenReady(selectSession);
      panels[0]!.dispose();

      panel.open();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(panels[1]!.webview.posted).toEqual([]);
      panel.postWhenReady(selectSession);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(panels[1]!.webview.posted).toEqual([]);

      panels[1]!.webview.messageListener?.({ kind: "request", id: "1" });

      await vi.waitFor(() => expect(panels[1]!.webview.posted).toContainEqual(selectSession));
    });

    it("does nothing when no panel is open", () => {
      const { panel } = setup();

      expect(() => panel.postWhenReady(selectSession)).not.toThrow();
    });
  });

  // When the webview's timing marks start (performance/performance-recorder.ts).
  describe("onPageLoad", () => {
    it("fires once as a new panel's page is loaded, before its HTML is set", () => {
      const htmlAtLoad: string[] = [];
      let created: FakePanel[] = [];
      const onPageLoad = vi.fn(() => htmlAtLoad.push(created[0]?.webview.html ?? "no panel"));
      const { panel, panels } = setup({ onPageLoad });
      created = panels;

      panel.open();

      expect(onPageLoad).toHaveBeenCalledTimes(1);
      expect(htmlAtLoad).toEqual([""]);
      expect(panels[0]!.webview.html).not.toBe("");
    });

    it("fires again when a hidden panel is shown (its page loads afresh), but not for a reveal of a visible one", () => {
      const onPageLoad = vi.fn();
      const { panel, panels } = setup({ onPageLoad });
      panel.open();

      panel.open();
      expect(onPageLoad).toHaveBeenCalledTimes(1);

      panels[0]!.setVisible(false);
      expect(onPageLoad).toHaveBeenCalledTimes(1);
      panels[0]!.setVisible(true);
      expect(onPageLoad).toHaveBeenCalledTimes(2);
    });

    it("doesn't fire for a view-state change of a panel that stays visible (e.g. it became active)", () => {
      const onPageLoad = vi.fn();
      const { panel, panels } = setup({ onPageLoad });
      panel.open();

      panels[0]!.setVisible(true);

      expect(onPageLoad).toHaveBeenCalledTimes(1);
    });
  });
});
