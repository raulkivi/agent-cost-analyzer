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

const VIEW_TYPE = "aiCreditsAnalyzer.panel";
const TITLE = "AI Credits Analyzer";

// The analyzer's editor panel (vscode-extension.md D10), at most one at a
// time: open() reveals it if it's already open. Settings follow §5 —
// scripts on, media/ as the only local resource root (the webview never
// gets file URIs for user logs), and no retainContextWhenHidden.
export class AnalyzerPanel implements Disposable {
  private current: { panel: WebviewPanelHandle; subscriptions: Disposable[] } | undefined;

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
    const current = {
      panel,
      subscriptions: [
        webview.onDidReceiveMessage((message) => void this.reply(webview, message)),
        panel.onDidDispose(() => this.release(current)),
      ],
    };
    this.current = current;
    webview.html = this.deps.renderHtml({
      cspSource: webview.cspSource,
      assetUri: (relativePath) => webview.asWebviewUri(path.join(this.deps.mediaDir, ...relativePath.split("/"))),
    });
  }

  dispose(): void {
    // Disposing fires onDidDispose, which releases it.
    this.current?.panel.dispose();
  }

  private release(current: { subscriptions: Disposable[] }): void {
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
