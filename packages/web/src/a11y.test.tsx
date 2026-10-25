import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus, ProductProfile, Session } from "@agent-cost-analyzer/domain";
import { App } from "./App.js";
import { resetApiTransport } from "./api-client/current-transport.js";
import { AsyncView, cancelledEmptyState } from "./components/ui/AsyncView.js";
import { resetHostCapabilities, setHostCapabilities } from "./host/current-host-capabilities.js";
import { resetViewStateStorage } from "./state/current-view-state-storage.js";
import { makeAuditRollup, makeSessionAudit } from "./test-support/audit-fixture.js";
import { axeViolations } from "./test-support/axe.js";
import { sampleInsightsDataset } from "./test-support/insights-fixture.js";
import { makeTurn } from "./test-support/turn-fixture.js";
import themeCss from "./theme.css?raw";
import vscodeThemeCss from "./theme-vscode.css?raw";

// vscode-extension.md §3.5 Accessibility: axe-core finds no WCAG 2.2 A/AA
// violation in any view, in VS Code's dark, light and high-contrast themes
// and in the standalone app. Each theme fixture is what a webview gets: a
// body class and the theme's --vscode-* variables (VS Code's Dark Modern,
// Light Modern and Dark High Contrast values), with both stylesheets
// loaded.
const THEMES = {
  standalone: { className: "", vars: {} },
  "vscode-dark": {
    className: "vscode-dark",
    vars: {
      "--vscode-editor-background": "#1f1f1f",
      "--vscode-editor-foreground": "#cccccc",
      "--vscode-descriptionForeground": "#9d9d9d",
      "--vscode-focusBorder": "#0078d4",
      "--vscode-button-background": "#0078d4",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-input-background": "#313131",
      "--vscode-panel-border": "#2b2b2b",
      "--vscode-textLink-foreground": "#4daafc",
      "--vscode-font-family": "system-ui, sans-serif",
      "--vscode-font-size": "13px",
    },
  },
  "vscode-light": {
    className: "vscode-light",
    vars: {
      "--vscode-editor-background": "#ffffff",
      "--vscode-editor-foreground": "#3b3b3b",
      "--vscode-descriptionForeground": "#3b3b3b",
      "--vscode-focusBorder": "#005fb8",
      "--vscode-button-background": "#005fb8",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-input-background": "#ffffff",
      "--vscode-panel-border": "#e5e5e5",
      "--vscode-textLink-foreground": "#005fb8",
      "--vscode-font-family": "system-ui, sans-serif",
      "--vscode-font-size": "13px",
    },
  },
  "vscode-high-contrast": {
    className: "vscode-high-contrast",
    vars: {
      "--vscode-editor-background": "#000000",
      "--vscode-editor-foreground": "#ffffff",
      "--vscode-descriptionForeground": "#ffffff",
      "--vscode-focusBorder": "#f38518",
      "--vscode-contrastBorder": "#6fc3df",
      "--vscode-button-background": "#000000",
      "--vscode-button-foreground": "#ffffff",
      "--vscode-input-background": "#000000",
      "--vscode-panel-border": "#6fc3df",
      "--vscode-textLink-foreground": "#21a6ff",
      "--vscode-font-family": "system-ui, sans-serif",
      "--vscode-font-size": "13px",
    },
  },
} as const;

type ThemeName = keyof typeof THEMES;

function applyTheme(name: ThemeName): void {
  const theme = THEMES[name];
  document.body.className = theme.className;
  document.body.removeAttribute("style");
  for (const [variable, value] of Object.entries(theme.vars)) {
    document.body.style.setProperty(variable, value);
  }
}

let styles: HTMLStyleElement[] = [];

const scenario: Session = {
  id: "cache-basics",
  mode: "learn",
  title: "Cache Basics",
  model: "example-model",
  category: "caching",
  usageDataAvailable: true,
  turns: [makeTurn({ index: 1, explanation: "first turn explanation" }), makeTurn({ index: 2 })],
  turnCount: 2,
  costAiCredits: { known: true, value: 0.02 },
};

const sessionSummary: Session = {
  id: "session-1",
  mode: "analyze",
  title: "Fix the bug",
  model: "claude-sonnet",
  startedAt: "2026-10-24T10:00:00.000Z",
  usageDataAvailable: true,
  turns: [],
  turnCount: 1,
  costAiCredits: { known: true, value: 0.01 },
};

const fullSession: Session = {
  ...sessionSummary,
  turns: [
    makeTurn({
      index: 0,
      triggeredEvent: "model-switch",
      explanation: "analyze turn explanation",
      toolCalls: [
        { name: "Bash", argsSummary: "ls", shell: { command: "ls", program: "ls" }, outcome: { status: "error", failureCategory: "command-not-found", exitCode: 127 } },
      ],
    }),
  ],
  systemPrompt: [{ kind: "built-in", label: "Base system prompt", tokenCount: { known: true, value: 1200 } }],
  toolInventory: [{ name: "Bash", loaded: true, invokedInTurns: [0] }],
};

const loggingWarning = {
  code: "logging-disabled" as const,
  severity: "required" as const,
  settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
  currentValue: false,
  recommendedValue: true,
  message: "GitHub Copilot Chat debug logging is disabled.",
  helpSteps: ["Turn it on."],
};

const extensionProfile: ProductProfile = {
  productId: "vscode-extension",
  displayName: "AI Credits Analyzer",
  version: "0.1.0",
  features: { providerSelect: false, crossProviderInsights: false, settingFixes: true, openInEditor: true, sessionSidebar: false },
};

interface Backend {
  sessions: Session[];
  warnings: ConfigStatus["warnings"];
  profile: ProductProfile | null;
}

let backend: Backend;

function json(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body), text: () => Promise.resolve(String(body)) });
}

function fakeFetch(url: string) {
  if (url === "/api/product") return backend.profile ? json(backend.profile) : json({ error: "Not found" }, false, 404);
  if (url === "/api/health") return json({ status: "ok", version: "0.8.0" });
  if (url === "/api/learn/scenarios") return json([scenario]);
  if (url === "/api/log-providers")
    return json({ providers: [{ id: "vscode", label: "VS Code", available: true }], activeProviderId: "vscode" });
  if (url === "/api/sessions") return json(backend.sessions);
  if (url === "/api/sessions/session-1") return json(fullSession);
  if (url === "/api/sessions/session-1/audit") return json(makeSessionAudit({ sessionId: "session-1" }));
  if (url === "/api/sessions/session-1/system-prompt")
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("You are helpful.\n<rules>Be brief.</rules>") });
  if (url === "/api/sessions/session-1/turns/0")
    return json({
      turnIndex: 0,
      userMessage: [{ kind: "text", text: "Fix it" }],
      rounds: [
        {
          request: { index: 0, addedMessages: [{ kind: "text", text: "{\"a\":1}" }], toolCalls: [] },
          response: { index: 0, response: [{ kind: "text", text: "Done." }] },
        },
      ],
    });
  if (url.startsWith("/api/insights")) return json(sampleInsightsDataset());
  if (url.startsWith("/api/audit"))
    return json(makeAuditRollup({ sessions: [{ sessionId: "session-1", title: "Fix the bug", toolCalls: 4, failed: 3, unknown: 0 }] }));
  if (url === "/api/config/status")
    return json({
      checkedAt: "2026-10-24T00:00:00.000Z",
      vscodeUserSettingsPath: "/home/user/.config/Code/User/settings.json",
      loggingEnabled: backend.warnings.length === 0,
      maxRetainedSessionLogs: 200,
      minRetainedSessionLogsThreshold: 200,
      warnings: backend.warnings,
    });
  return Promise.reject(new Error(`Unhandled fetch url in test: ${url}`));
}

async function expectNoViolations(): Promise<void> {
  expect(await axeViolations(document.body)).toEqual([]);
}

// Below wide widths the explanation sits in a closed drawer, so wait for the
// turns table instead.
async function openAnalyzeSession(): Promise<void> {
  render(<App />);
  fireEvent.click(screen.getByLabelText("Analyze"));
  fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
  await screen.findAllByRole("columnheader");
}

describe.each(Object.keys(THEMES) as ThemeName[])("axe: no WCAG 2.2 AA violations (%s)", (theme) => {
  beforeEach(() => {
    backend = { sessions: [sessionSummary], warnings: [], profile: null };
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
    styles = [themeCss, vscodeThemeCss].map((css) => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
      return style;
    });
    applyTheme(theme);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiTransport();
    resetHostCapabilities();
    resetViewStateStorage();
    for (const style of styles) style.remove();
    document.body.className = "";
    document.body.removeAttribute("style");
  });

  it("Learn mode, a scenario's turns", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Cache Basics" }));
    await screen.findByText("first turn explanation");

    await expectNoViolations();
  });

  it("Analyze mode, a session's turns, with each right-column tab and the column chooser open", async () => {
    await openAnalyzeSession();
    await expectNoViolations();

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    await expectNoViolations();

    fireEvent.click(screen.getByLabelText("System prompt"));
    await expectNoViolations();
    fireEvent.click(screen.getByLabelText("Tools"));
    await expectNoViolations();
  });

  it("Tool audit", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByLabelText("Tool audit"));
    await screen.findByRole("group", { name: "Failure rate" });

    await expectNoViolations();
  });

  it("All sessions", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByLabelText("All sessions"));
    await screen.findByRole("table", { name: "Sessions" });

    await expectNoViolations();
  });

  it("Dashboard", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByLabelText("Dashboard"));
    await screen.findByRole("group", { name: "AI Credits" });

    await expectNoViolations();
  });

  it("TurnInspector", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByRole("button", { name: "Inspect request/response" }));
    await screen.findByText("Request · round 0");

    await expectNoViolations();
  });

  it("SystemPromptInspector, in each format", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByLabelText("System prompt"));
    fireEvent.click(screen.getByRole("button", { name: "Open system prompt inspector" }));
    await screen.findByRole("button", { name: /rules/i });
    await expectNoViolations();

    fireEvent.click(screen.getByLabelText("Raw"));
    await expectNoViolations();
    fireEvent.click(screen.getByLabelText("Icicle"));
    await expectNoViolations();
  });

  // "View as table" (§3.5): every chart's table twin passes axe too.
  function viewAllChartsAsTables(): number {
    const toggles = screen.getAllByRole("button", { name: "View as table" });
    for (const toggle of toggles) fireEvent.click(toggle);
    return toggles.length;
  }

  it("Dashboard, every chart viewed as a table", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByLabelText("Dashboard"));
    await screen.findByRole("group", { name: "AI Credits" });

    const count = viewAllChartsAsTables();

    expect(count).toBeGreaterThan(1);
    expect(screen.getAllByRole("table", { name: /./ }).length).toBeGreaterThanOrEqual(count);
    await expectNoViolations();
  });

  it("Tool audit, every chart viewed as a table", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByLabelText("Tool audit"));
    await screen.findByRole("group", { name: "Failure rate" });

    viewAllChartsAsTables();

    await expectNoViolations();
  });

  it("All sessions, every chart viewed as a table", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByLabelText("All sessions"));
    await screen.findByRole("table", { name: "Sessions" });

    viewAllChartsAsTables();

    await expectNoViolations();
  });

  it("the AI Credits sparkline viewed as a table", async () => {
    await openAnalyzeSession();

    fireEvent.click(screen.getByRole("button", { name: "View as table" }));

    expect(screen.getByRole("table", { name: "AI Credits per turn" })).toBeInTheDocument();
    await expectNoViolations();
  });

  it("the system prompt icicle viewed as a table", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByLabelText("System prompt"));
    fireEvent.click(screen.getByRole("button", { name: "Open system prompt inspector" }));
    await screen.findByRole("button", { name: /rules/i });
    fireEvent.click(screen.getByLabelText("Icicle"));

    fireEvent.click(screen.getByRole("button", { name: "View as table" }));

    expect(screen.getByRole("table", { name: "Prompt composition" })).toBeInTheDocument();
    await expectNoViolations();
  });

  it("AdviceExportDialog, with its preview", async () => {
    await openAnalyzeSession();
    fireEvent.click(screen.getByRole("checkbox", { name: /Fix the bug/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export advice" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Preview" }));

    await expectNoViolations();
  });

  it("ConfigWarningBanner, with the extension's Fix buttons", async () => {
    backend = { ...backend, warnings: [loggingWarning], profile: extensionProfile };
    setHostCapabilities({
      copyToClipboard: vi.fn().mockResolvedValue(undefined),
      openSetting: vi.fn().mockResolvedValue(undefined),
      openTextDocument: vi.fn().mockResolvedValue(undefined),
    });
    render(<App />);
    await screen.findByRole("button", { name: /^Enable / });

    await expectNoViolations();
  });

  it("first run: no sessions yet (empty state)", async () => {
    backend = { ...backend, sessions: [], warnings: [loggingWarning] };
    render(<App />);
    fireEvent.click(screen.getByLabelText("Analyze"));
    await screen.findByRole("heading", { name: "No Copilot Chat sessions found yet" });

    await expectNoViolations();
  });

  it("loading, with the header held for the profile", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
      render(<App />);
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.getAllByTestId("async-skeleton").length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
    await expectNoViolations();
  });

  it("error, partial and cancelled AsyncView states", async () => {
    render(
      <main>
        <AsyncView
          status="error"
          loadingText="Loading…"
          error={{ title: "Couldn't load the session list", details: "SQLITE_BUSY", onRetry: vi.fn() }}
        />
        <AsyncView status="ready" loadingText="Loading…" partial="AI Credits are unknown for 1 of 4 sessions.">
          <p>totals</p>
        </AsyncView>
        <AsyncView status="empty" loadingText="Loading…" empty={cancelledEmptyState(vi.fn())} />
      </main>,
    );

    await expectNoViolations();
  });

  describe("narrow and medium panels", () => {
    function panelWidth(width: number) {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private readonly callback: ResizeObserverCallback) {}
          observe(target: Element) {
            this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
          }
          unobserve() {}
          disconnect() {}
        },
      );
    }

    it("640 px, with the details drawer open", async () => {
      panelWidth(640);
      await openAnalyzeSession();
      fireEvent.click(screen.getByRole("button", { name: "Details" }));
      await waitFor(() => expect(screen.getByRole("region", { name: /details/ })).toBeInTheDocument());

      await expectNoViolations();
    });

    it("900 px, with the right column's drawer open", async () => {
      panelWidth(900);
      await openAnalyzeSession();
      fireEvent.click(screen.getByRole("button", { name: "Details" }));

      await expectNoViolations();
    });
  });
});
