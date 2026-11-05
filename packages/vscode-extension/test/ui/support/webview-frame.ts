// Enters and leaves a VS Code webview with `browser.switchFrame`. The
// wdio-vscode-service `WebView.open()/close()` use the deprecated
// `switchToFrame`, whose notice printed hundreds of lines per run and buried
// real failures.

// The slice of the wdio `browser` used here.
export interface FrameDriver {
  switchFrame(context: unknown): Promise<unknown>;
}

// The slice of a wdio-vscode-service `WebView` page object used here.
export interface WebviewFrames {
  readonly elem: unknown;
  readonly activeFrame: { waitForExist(): Promise<unknown>; getElement(): Promise<unknown> };
}

// A webview is an outer iframe holding the real content iframe (active frame).
export async function enterWebview(driver: FrameDriver, webview: WebviewFrames): Promise<void> {
  await driver.switchFrame(webview.elem);
  await webview.activeFrame.waitForExist();
  await driver.switchFrame(await webview.activeFrame.getElement());
}

// `null` is the top-level browsing context, so one call leaves both frames.
export async function leaveWebview(driver: FrameDriver): Promise<void> {
  await driver.switchFrame(null);
}
