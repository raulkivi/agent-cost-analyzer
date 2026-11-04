// Lets a test hold the host's reply to chosen webview requests, so a load is
// slow enough to cancel (UI automation, manual check 1.6). Test mode only:
// composition.ts creates it, but only the Test-mode hooks ever hold anything,
// so in production every method passes at once.
export interface RequestGate {
  // Resolves when the method may be answered.
  waitFor(method: string): Promise<void>;
}

export class HoldableRequestGate implements RequestGate {
  private held = new Set<string>();
  private waiters: (() => void)[] = [];

  hold(methods: readonly string[]): void {
    this.held = new Set(methods);
  }

  // Frees everything waiting, and stops holding.
  release(): void {
    this.held.clear();
    const waiting = this.waiters;
    this.waiters = [];
    for (const open of waiting) open();
  }

  waitFor(method: string): Promise<void> {
    if (!this.held.has(method)) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
