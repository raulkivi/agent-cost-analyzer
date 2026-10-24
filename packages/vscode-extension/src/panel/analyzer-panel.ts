import path from "node:path";

export interface Disposable {
  dispose(): void;
}

// The slices of vscode.Webview / vscode.WebviewPanel the panel needs, so
// it's testable without VS Code; vscode/vscode-webview-panel.ts adapts the
// real ones.
export interface PanelWebview {
  readonly cspSource: string;
  html: string;
  // An absolute file path under a local resource root -> its webview URI.
  asWebviewUri(fsPath: string): string;
  postMessage(message: unknown): PromiseLike<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
}

export interface WebviewPanelHandle {
  readonly webview: PanelWebview;
  reveal(): void;
  // Fires when the panel is hidden (false) or shown again (true).
  onDidChangeVisibility(listener: (visible: boolean) => void): Disposable;
  onDidDispose(listener: () => void): Disposable;
  dispose(): void;
}

export interface WebviewPanelOptions {
  viewType: string;
  title: string;
  enableScripts: true;
  localResourceRoots: string[];
  retainContextWhenHidden: false;
}

// What renderHtml gets to build the page: the CSP source and an asset
// mapper for paths relative to media/.
export interface PanelHtmlContext {
  cspSource: string;
  assetUri(relativePath: string): string;
}

export interface AnalyzerPanelDeps {
  createPanel(options: WebviewPanelOptions): WebviewPanelHandle;
  // The webview build and learn fixtures; the webview's only resource root.
  mediaDir: string;
  renderHtml(context: PanelHtmlContext): string;
  // Each message from the webview; a defined result is posted back.
  handleMessage(message: unknown): Promise<unknown>;
}

interface OpenPanel {
  panel: WebviewPanelHandle;
  subscriptions: Disposable[];
  // True once the current page of the webview has sent a message, i.e. its
  // script is running and listening. False for a new panel, and again while
  // it's hidden, since a hidden panel's page is destroyed (§5) and loads
  // afresh when shown.
  ready: boolean;
  // The latest message postWhenReady held back until the page is ready.
  pending: { message: unknown } | undefined;
}

const VIEW_TYPE = "aiCreditsAnalyzer.panel";
const TITLE = "AI Credits Analyzer";

// The analyzer's editor panel (vscode-extension.md D10), at most one at a
// time: open() reveals it if it's already open. Settings follow §5 —
// scripts on, media/ as the only local resource root (the webview never
// gets file URIs for user logs), and no retainContextWhenHidden.
export class AnalyzerPanel implements Disposable {
  private current: OpenPanel | undefined;

  constructor(private readonly deps: AnalyzerPanelDeps) {}

  open(): void {
    if (this.current) {
      this.current.panel.reveal();
      return;
    }
    const panel = this.deps.createPanel({
      viewType: VIEW_TYPE,
      title: TITLE,
      enableScripts: true,
      localResourceRoots: [this.deps.mediaDir],
      retainContextWhenHidden: false,
    });
    const { webview } = panel;
    const current: OpenPanel = {
      panel,
      subscriptions: [],
      ready: false,
      pending: undefined,
    };
    current.subscriptions.push(
      webview.onDidReceiveMessage((message) => {
        this.markReady(current);
        void this.reply(webview, message);
      }),
      panel.onDidChangeVisibility((visible) => {
        if (!visible) {
          current.ready = false;
        }
      }),
      panel.onDidDispose(() => this.release(current)),
    );
    this.current = current;
    try {
      webview.html = this.deps.renderHtml({
        cspSource: webview.cspSource,
        assetUri: (relativePath) => webview.asWebviewUri(path.join(this.deps.mediaDir, ...relativePath.split("/"))),
      });
    } catch (error) {
      // Don't leave a blank panel behind for open() to reveal.
      panel.dispose();
      throw error;
    }
  }

  // Pushes an unsolicited message (a host event, plan §4) to the open
  // panel, if any. Dropped when there's no panel or it can't be delivered:
  // a hidden panel isn't retained (§5), so it reloads and fetches fresh
  // state when it's shown again.
  post(message: unknown): void {
    this.current?.panel.webview.postMessage(message).then(undefined, () => undefined);
  }

  // Like post, for a message that must arrive (the sidebar's selectSession):
  // a webview that is still loading, or was hidden and is loading again,
  // isn't listening yet, so the latest such message is held and delivered
  // when the page first writes to the host. Its first request is a reliable
  // signal: the web app subscribes to host events in the same effect pass
  // that makes its first request.
  postWhenReady(message: unknown): void {
    const { current } = this;
    if (!current) {
      return;
    }
    if (current.ready) {
      this.post(message);
    } else {
      current.pending = { message };
    }
  }

  dispose(): void {
    // Disposing fires onDidDispose, which releases it.
    this.current?.panel.dispose();
  }

  private markReady(current: OpenPanel): void {
    current.ready = true;
    const held = current.pending;
    current.pending = undefined;
    if (held && this.current === current) {
      this.post(held.message);
    }
  }

  private release(current: OpenPanel): void {
    if (this.current === current) {
      this.current = undefined;
    }
    for (const subscription of current.subscriptions) {
      subscription.dispose();
    }
  }

  // Replies only to the panel that asked, if it's still open. A reply that
  // can't be produced or delivered is dropped: the webview's transport
  // times the request out.
  private async reply(webview: PanelWebview, message: unknown): Promise<void> {
    try {
      const response = await this.deps.handleMessage(message);
      if (response !== undefined && this.current?.panel.webview === webview) {
        await webview.postMessage(response);
      }
    } catch {
      // Dropped, as above.
    }
  }
}
