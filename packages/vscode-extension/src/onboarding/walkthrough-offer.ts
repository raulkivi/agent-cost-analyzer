// Where the extension remembers it offered the walkthrough (globalState).
export const WALKTHROUGH_OFFERED_KEY = "aiCreditsAnalyzer.walkthroughOffered";

// The slice of vscode.Memento (context.globalState) the offer needs.
export interface OfferMemory {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface WalkthroughLauncher {
  open(): Promise<void>;
}

export interface WalkthroughOfferOptions {
  // Hears every failure; the offer itself never throws or shows a message.
  onError?: (error: unknown) => void;
}

// The first-run offer of the Get Started walkthrough (vscode-extension.md
// §3.5 Onboarding): opened once, as an editor tab, and never as a
// notification (§3.5 VS Code fit). Free of `vscode`; vscode-walkthrough.ts
// opens the walkthrough itself.
export class WalkthroughOffer {
  constructor(
    private readonly memento: OfferMemory,
    private readonly walkthrough: WalkthroughLauncher,
    private readonly options: WalkthroughOfferOptions = {},
  ) {}

  // Remembers the offer before opening, so an editor that fails to open it
  // means no walkthrough, not a retry at every start; if the memory can't
  // be written there is no way to stop that repeating, so it isn't opened.
  async offerOnce(): Promise<void> {
    if (this.memento.get(WALKTHROUGH_OFFERED_KEY) === true) {
      return;
    }
    try {
      await this.memento.update(WALKTHROUGH_OFFERED_KEY, true);
      await this.walkthrough.open();
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}
