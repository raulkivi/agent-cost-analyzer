import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus, ProductProfile } from "@agent-cost-analyzer/domain";
import { App } from "./App.js";
import { getApiTransport, resetApiTransport, setApiTransport } from "./api-client/current-transport.js";
import { resetHostCapabilities, setHostCapabilities } from "./host/current-host-capabilities.js";
import { resetViewStateStorage, setViewStateStorage } from "./state/current-view-state-storage.js";
import { memoryViewStateStorage } from "./state/view-state-storage.js";
import { makeTurn } from "./test-support/turn-fixture.js";
import { makeAuditRollup, makeSessionAudit } from "./test-support/audit-fixture.js";
import { sampleInsightsDataset } from "./test-support/insights-fixture.js";

const scenario = {
  id: "cache-basics",
  mode: "learn" as const,
  title: "Cache Basics",
  model: "example-model",
  usageDataAvailable: true,
  turns: [
    makeTurn({ index: 1, explanation: "first turn explanation" }),
    makeTurn({ index: 2, explanation: "second turn explanation" }),
  ],
  turnCount: 2,
  costAiCredits: { known: false as const, reason: "not extracted" },
};

const sessionSummary = {
  id: "session-1",
  mode: "analyze" as const,
  title: "Fix the bug",
  model: "unknown",
  usageDataAvailable: false,
  turns: [],
  turnCount: 0,
  costAiCredits: { known: false as const, reason: "not extracted" },
};

const fullSession = {
  ...sessionSummary,
  turns: [
    makeTurn({
      index: 0,
      explanation: "analyze turn explanation",
      toolCalls: [
        {
          name: "read_file",
          argsSummary: "src/a.ts",
          filesTouched: ["src/a.ts"],
          tokenCount: { known: false, reason: "not recorded" },
        },
      ],
    }),
  ],
  turnCount: 1,
  systemPrompt: [
    {
      kind: "built-in" as const,
      label: "Base system prompt (100 characters)",
      tokenCount: { known: false, reason: "not broken down" },
    },
  ],
  toolInventory: [{ name: "read_file", loaded: true, invokedInTurns: [0] }],
};

// A session whose main.jsonl never parsed (toolInventory empty), but whose
// turn's toolCalls came from SQLite session_files independently — finding
// #4: toolCallsAvailable must not gate solely on toolInventory.
const sessionSummaryNoInventory = {
  id: "session-2",
  mode: "analyze" as const,
  title: "No system-prompt data",
  model: "unknown",
  usageDataAvailable: false,
  turns: [],
  turnCount: 1,
  costAiCredits: { known: false as const, reason: "not extracted" },
};

const fullSessionNoInventory = {
  ...sessionSummaryNoInventory,
  turns: [
    makeTurn({
      index: 0,
      explanation: "no-inventory turn explanation",
      toolCalls: [
        {
          name: "run_in_terminal",
          argsSummary: "",
          tokenCount: { known: false, reason: "not recorded" },
        },
      ],
    }),
  ],
  systemPrompt: [],
  toolInventory: [],
};

const sessionSummaryError = {
  id: "session-error",
  mode: "analyze" as const,
  title: "Broken session",
  model: "unknown",
  usageDataAvailable: false,
  turns: [],
  turnCount: 0,
  costAiCredits: { known: false as const, reason: "not extracted" },
};

const cleanConfigStatus = {
  checkedAt: "2026-08-08T00:00:00.000Z",
  vscodeUserSettingsPath: "/home/user/.config/Code/User/settings.json",
  loggingEnabled: true,
  maxRetainedSessionLogs: 200,
  minRetainedSessionLogsThreshold: 200,
  warnings: [],
};

let configStatus: ConfigStatus = cleanConfigStatus;
let logProviderStatus = {
  providers: [
    { id: "vscode", label: "VS Code", available: true },
    { id: "mitmproxy", label: "mitmproxy", available: true },
  ],
  activeProviderId: "vscode",
};

// GET /api/product; null answers 404 (an older server), so the app falls
// back to today's standalone UI — which every test outside the "product
// profile" block below relies on.
let productProfile: ProductProfile | null = null;
const SYSTEM_PROMPT_TEXT = "You are a helpful assistant.\n<rules>Be brief.</rules>";

function fakeFetch(url: string, init?: { method?: string; body?: string }) {
  if (url === "/api/product") {
    return Promise.resolve(
      productProfile
        ? { ok: true, json: () => Promise.resolve(productProfile) }
        : { ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) },
    );
  }
  if (url === "/api/sessions/session-1/system-prompt") {
    return Promise.resolve({ ok: true, text: () => Promise.resolve(SYSTEM_PROMPT_TEXT) });
  }
  if (url === "/api/health") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ status: "ok", version: "0.1.0" }),
    });
  }
  if (url === "/api/learn/scenarios") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve([scenario]) });
  }
  if (url === "/api/log-providers") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(logProviderStatus) });
  }
  if (url === "/api/log-providers/active") {
    const { id } = JSON.parse(init?.body ?? "{}") as { id: string };
    logProviderStatus = { ...logProviderStatus, activeProviderId: id };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(logProviderStatus) });
  }
  if (url === "/api/sessions") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve([sessionSummary, sessionSummaryNoInventory, sessionSummaryError]),
    });
  }
  if (url === "/api/sessions/session-1") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fullSession) });
  }
  if (url === "/api/sessions/session-2") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(fullSessionNoInventory) });
  }
  if (url === "/api/sessions/session-error") {
    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "boom" }) });
  }
  if (url === "/api/sessions/session-1/audit") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(makeSessionAudit({ sessionId: "session-1" })) });
  }
  if (url.startsWith("/api/insights")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(sampleInsightsDataset()) });
  }
  if (url.startsWith("/api/audit")) {
    const rollup = makeAuditRollup({
      sessions: [{ sessionId: "session-1", title: "Fix the bug", toolCalls: 4, failed: 3, unknown: 0 }],
    });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(rollup) });
  }
  if (url === "/api/config/status") {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(configStatus) });
  }
  if (url === "/api/config/retention-threshold") {
    const { value } = JSON.parse(init?.body ?? "{}") as { value: number };
    const warnings =
      value > (configStatus.maxRetainedSessionLogs ?? 0)
        ? [
            {
              code: "retention-too-low" as const,
              severity: "required" as const,
              settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
              currentValue: configStatus.maxRetainedSessionLogs,
              recommendedValue: value,
              message: `Only the last ${configStatus.maxRetainedSessionLogs} sessions' logs are retained on disk.`,
              helpSteps: [`Set maxRetainedSessionLogs to ${value} in settings.json`],
            },
          ]
        : [];
    configStatus = { ...configStatus, minRetainedSessionLogsThreshold: value, warnings };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(configStatus) });
  }
  return Promise.reject(new Error(`Unhandled fetch url in test: ${url}`));
}

function switchToAnalyze() {
  fireEvent.click(screen.getByLabelText("Analyze"));
}

describe("App", () => {
  beforeEach(() => {
    configStatus = cleanConfigStatus;
    productProfile = null;
    logProviderStatus = {
      providers: [
        { id: "vscode", label: "VS Code", available: true },
        { id: "mitmproxy", label: "mitmproxy", available: true },
      ],
      activeProviderId: "vscode",
    };
    vi.stubGlobal("fetch", vi.fn(fakeFetch));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetApiTransport();
    resetHostCapabilities();
    resetViewStateStorage();
  });

  it("renders a successful health check from the server, including the app version", async () => {
    render(<App />);

    await waitFor(() => expect(screen.getByText(/status: ok/i)).toBeInTheDocument());
    expect(screen.getByText(/v0\.1\.0/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/health");
  });

  it("lets the user pick a learn scenario and renders the shared layout", async () => {
    render(<App />);

    const scenarioCard = await screen.findByRole("button", { name: "Cache Basics" });
    fireEvent.click(scenarioCard);

    expect(await screen.findByText("first turn explanation")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 turns
  });

  it("moving the scrubber updates both the turns table selection and the explanation panel", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cache Basics" }));
    await screen.findByText("first turn explanation");

    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });

    expect(await screen.findByText("second turn explanation")).toBeInTheDocument();
    expect(screen.getAllByRole("row")[2]).toHaveAttribute("aria-selected", "true");
  });

  it("switching to Analyze mode shows the sessions list instead of scenarios", async () => {
    render(<App />);

    await screen.findByRole("button", { name: "Cache Basics" });
    switchToAnalyze();

    expect(await screen.findByRole("button", { name: "Fix the bug" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cache Basics" })).not.toBeInTheDocument();
  });

  it("selecting a different log provider clears the selected session and refetches the session list", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    const providerSelect = await screen.findByLabelText("Log provider");
    const fetchCallsBefore = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;

    fireEvent.change(providerSelect, { target: { value: "mitmproxy" } });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/log-providers/active",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    await waitFor(() => {
      const fetchCallsAfter = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
      expect(fetchCallsAfter).toBeGreaterThan(fetchCallsBefore);
    });
    expect(screen.queryByText("analyze turn explanation")).not.toBeInTheDocument();
  });

  it("does not render a provider select in Learn mode", async () => {
    render(<App />);

    await screen.findByRole("button", { name: "Cache Basics" });

    expect(screen.queryByLabelText("Log provider")).not.toBeInTheDocument();
  });

  it("lets the user pick a real Analyze session and renders the shared layout", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));

    expect(await screen.findByText("analyze turn explanation")).toBeInTheDocument();
  });

  it("folds tool-call detail for the selected turn into the Explanation tab in Analyze mode", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
  });

  it("shows a visible error message instead of failing silently when fetching a session fails", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    fireEvent.click(await screen.findByRole("button", { name: "Broken session" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/failed/i);
  });

  // §3.5 States: the session list and the turns view use AsyncView.
  describe("loading, error and empty states", () => {
    it("reports a failed session list with Retry, which loads it again", async () => {
      let failures = 1;
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: { body?: string }) =>
          url === "/api/sessions" && failures-- > 0
            ? Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "locked" }) })
            : fakeFetch(url, init),
        ),
      );
      render(<App />);
      switchToAnalyze();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't load the session list");
      expect(alert).toHaveTextContent(/nothing was changed/i);
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

      expect(await screen.findByRole("button", { name: "Fix the bug" })).toBeInTheDocument();
    });

    it("reports a failed session in the turns view, with Retry", async () => {
      render(<App />);
      switchToAnalyze();
      fireEvent.click(await screen.findByRole("button", { name: "Broken session" }));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't open this session");
      const fetchCalls = () =>
        (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(([url]) => url === "/api/sessions/session-error").length;
      expect(fetchCalls()).toBe(1);
      fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(fetchCalls()).toBe(2));
    });

    it("says why the session list is empty, with a next step (AsyncView's empty state)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: { body?: string }) =>
          url === "/api/sessions" ? Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) : fakeFetch(url, init),
        ),
      );
      render(<App />);
      switchToAnalyze();

      expect(await screen.findByRole("heading", { name: "No Copilot Chat sessions found yet" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open the dashboard across all providers" })).toBeInTheDocument();
    });
  });

  it("shows only the most-recently-selected session when an earlier session's fetch resolves after a later one", async () => {
    let resolveFirst: () => void = () => {};
    let resolveSecond: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/sessions/session-1") {
          return firstGate.then(() => ({ ok: true, json: () => Promise.resolve(fullSession) }));
        }
        if (url === "/api/sessions/session-2") {
          return secondGate.then(() => ({
            ok: true,
            json: () => Promise.resolve(fullSessionNoInventory),
          }));
        }
        return fakeFetch(url);
      }),
    );

    render(<App />);
    switchToAnalyze();

    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    fireEvent.click(await screen.findByRole("button", { name: "No system-prompt data" }));

    // Resolve out of order: the earlier click's request (session-1) settles
    // last, after the later click's request (session-2) already settled.
    await act(async () => {
      resolveSecond();
      await Promise.resolve();
    });
    await screen.findByText("no-inventory turn explanation");

    await act(async () => {
      resolveFirst();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByText("no-inventory turn explanation")).toBeInTheDocument();
    expect(screen.queryByText("analyze turn explanation")).not.toBeInTheDocument();
  });

  it("renders tool-call detail from the turn's own toolCalls even when the session's toolInventory is empty", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "No system-prompt data" }));
    await screen.findByText("no-inventory turn explanation");

    expect(screen.getByText("run_in_terminal")).toBeInTheDocument();
    expect(screen.queryByText("Tool-call detail unavailable for this session.")).not.toBeInTheDocument();
  });

  it("renders the system prompt breakdown when that tab is selected", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    fireEvent.click(screen.getByLabelText("System prompt"));

    expect(screen.getByText("Base system prompt (100 characters)")).toBeInTheDocument();
  });

  it("renders the tool inventory when that tab is selected", async () => {
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    fireEvent.click(screen.getByLabelText("Tools"));

    expect(screen.getByText("Tools: loaded vs. used")).toBeInTheDocument();
    expect(screen.getAllByText("read_file").length).toBeGreaterThan(0);
  });

  it("does not render a tab switcher or Analyze-only panels for a Learn scenario", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cache Basics" }));
    await screen.findByText("first turn explanation");

    expect(screen.queryByLabelText("System prompt")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Tools")).not.toBeInTheDocument();
    expect(screen.queryByText(/system prompt breakdown/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tools: loaded vs\. used/i)).not.toBeInTheDocument();
  });

  it("renders the config warning banner when prerequisites aren't met", async () => {
    configStatus = {
      ...cleanConfigStatus,
      loggingEnabled: false,
      maxRetainedSessionLogs: null,
      warnings: [
        {
          code: "retention-too-low",
          severity: "required",
          settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
          currentValue: 50,
          recommendedValue: 200,
          message: "Only the last 50 sessions' logs are retained on disk.",
          helpSteps: ["Set maxRetainedSessionLogs to 200 in settings.json"],
        },
      ],
    };
    render(<App />);

    expect(
      await screen.findByText("Only the last 50 sessions' logs are retained on disk."),
    ).toBeInTheDocument();
  });

  it("re-fetches the config status when the host reports configChanged (extension webview)", async () => {
    // The HTTP transport's requests, plus the host-event subscription a
    // WebviewTransport has.
    const http = getApiTransport();
    const handlers = new Set<(payload: unknown) => void>();
    setApiTransport({
      call: (method, params) => http.call(method, params),
      onEvent: (name, handler) => {
        if (name !== "configChanged") return () => undefined;
        handlers.add(handler);
        return () => void handlers.delete(handler);
      },
    });
    render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/config/status"));
    expect(screen.queryByText("Only the last 50 sessions' logs are retained on disk.")).not.toBeInTheDocument();

    configStatus = {
      ...cleanConfigStatus,
      maxRetainedSessionLogs: null,
      warnings: [
        {
          code: "retention-too-low",
          severity: "required",
          settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
          currentValue: 50,
          recommendedValue: 200,
          message: "Only the last 50 sessions' logs are retained on disk.",
          helpSteps: ["Set maxRetainedSessionLogs to 200 in settings.json"],
        },
      ],
    };
    act(() => handlers.forEach((handler) => handler(undefined)));

    expect(await screen.findByText("Only the last 50 sessions' logs are retained on disk.")).toBeInTheDocument();
  });

  it("stops listening for host events when unmounted", async () => {
    const http = getApiTransport();
    const unsubscribe = vi.fn();
    setApiTransport({ call: (method, params) => http.call(method, params), onEvent: () => unsubscribe });
    const { unmount } = render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/config/status"));

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });

  it("shows the fetched retention threshold in the header on load", async () => {
    configStatus = { ...cleanConfigStatus, minRetainedSessionLogsThreshold: 300 };
    render(<App />);

    expect(await screen.findByLabelText("Retention threshold")).toHaveValue(300);
  });

  it("changing the retention threshold triggers the PUT and updates the header and warning state", async () => {
    configStatus = { ...cleanConfigStatus, maxRetainedSessionLogs: 250, warnings: [] };
    render(<App />);

    const input = await screen.findByLabelText("Retention threshold");
    expect(input).toHaveValue(200);
    expect(screen.queryByText(/sessions' logs are retained on disk/)).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/config/retention-threshold",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ value: 300 }) }),
      ),
    );
    expect(await screen.findByLabelText("Retention threshold")).toHaveValue(300);
    expect(
      await screen.findByText("Only the last 250 sessions' logs are retained on disk."),
    ).toBeInTheDocument();
  });

  it("dismisses the config warning banner via its Dismiss button and can reopen it via the Config button", async () => {
    configStatus = {
      ...cleanConfigStatus,
      warnings: [
        {
          code: "retention-too-low",
          severity: "required",
          settingId: "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs",
          currentValue: 50,
          recommendedValue: 200,
          message: "Only the last 50 sessions' logs are retained on disk.",
          helpSteps: ["Set maxRetainedSessionLogs to 200 in settings.json"],
        },
      ],
    };
    render(<App />);

    await screen.findByText("Only the last 50 sessions' logs are retained on disk.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Config" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("shows a static Config ✓ tag instead of a button when there are no warnings", async () => {
    render(<App />);

    expect(await screen.findByText("Config ✓")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Config" })).not.toBeInTheDocument();
  });

  it("lets the user select sessions for an AI advice bundle, open the export dialog, and copy it", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("checkbox", { name: /Fix the bug/ }));

    expect(await screen.findByText("1 session selected for advice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export advice" }));

    expect(screen.getByText("Export advice bundle")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy advice prompt" })).toBeInTheDocument();
  });

  it("uses the fully-fetched session detail (turns, system prompt) for the advice bundle, not the lightweight list summary", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    render(<App />);

    switchToAnalyze();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    fireEvent.click(screen.getByRole("checkbox", { name: /Fix the bug/ }));
    fireEvent.click(screen.getByRole("button", { name: "Export advice" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(screen.getByTestId("advice-preview")).toHaveTextContent("Base system prompt (100 characters)");
  });

  it("clears the advice selection when switching modes", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /Cache Basics/ }));
    expect(await screen.findByText("1 session selected for advice")).toBeInTheDocument();

    switchToAnalyze();

    await screen.findByRole("button", { name: "Fix the bug" });
    expect(screen.queryByText(/selected for advice/)).not.toBeInTheDocument();
  });

  // §3.5 Accessibility: Escape closes an inspector and focus goes back to
  // the control that opened it (the page behind is kept, not rebuilt).
  it("closes the turn inspector on Escape and returns focus to its opener", async () => {
    const user = userEvent.setup();
    render(<App />);
    switchToAnalyze();
    await user.click(await screen.findByRole("button", { name: "Fix the bug" }));
    await screen.findByText("analyze turn explanation");

    await user.click(screen.getByRole("button", { name: "Inspect request/response" }));
    expect(await screen.findByRole("button", { name: /back to session/i })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("button", { name: /back to session/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inspect request/response" })).toHaveFocus();
  });

  // §3.5 Layout: by the panel's width (mock-up board 4 for narrow).
  describe("layout by panel width", () => {
    // A ResizeObserver that reports `width` for whatever it observes.
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

    async function openAnalyzeSession() {
      render(<App />);
      switchToAnalyze();
      fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
      await screen.findAllByRole("columnheader");
    }

    it("keeps today's three columns at 1280 px", async () => {
      panelWidth(1280);
      await openAnalyzeSession();

      expect(screen.getByRole("main")).toHaveAttribute("data-layout", "wide");
      expect(screen.getByLabelText("Explanation")).toBeVisible();
      expect(screen.getByLabelText("Tool audit")).toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "View" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Details" })).not.toBeInTheDocument();
      expect(screen.getAllByRole("columnheader")).toHaveLength(14);
    });

    it("moves the right column into a drawer at 900 px", async () => {
      const user = userEvent.setup();
      panelWidth(900);
      await openAnalyzeSession();

      expect(screen.getByRole("main")).toHaveAttribute("data-layout", "medium");
      expect(screen.queryByLabelText("Explanation")).not.toBeInTheDocument();
      const details = screen.getByRole("button", { name: "Details" });
      expect(details).toHaveAttribute("aria-expanded", "false");

      await user.click(details);
      const drawer = screen.getByRole("region", { name: /^Turn 0 details$/ });
      expect(within(drawer).getByText("analyze turn explanation")).toBeInTheDocument();
      expect(within(drawer).getByLabelText("System prompt")).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("region", { name: /details/ })).not.toBeInTheDocument();
      expect(details).toHaveFocus();
    });

    it("at 640 px: 2×2 KPIs, a view select, the priority columns and a details drawer with the rest", async () => {
      const user = userEvent.setup();
      panelWidth(640);
      await openAnalyzeSession();

      expect(screen.getByRole("main")).toHaveAttribute("data-layout", "narrow");
      for (const name of ["AI Credits", "Cache read", "Turns", "Tool calls"]) {
        expect(screen.getByRole("group", { name })).toBeInTheDocument();
      }
      expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
        "Turn",
        "Trigger",
        "AI Credits",
        "Cumulative",
      ]);
      expect(screen.queryByRole("button", { name: "Columns" })).not.toBeInTheDocument();

      screen.getAllByRole("row")[1]!.focus();
      await user.keyboard("{Enter}");
      const drawer = screen.getByRole("region", { name: /^Turn 0 details$/ });
      expect(within(drawer).getByText("Model")).toBeInTheDocument();
      expect(within(drawer).getByText("analyze turn explanation")).toBeInTheDocument();

      const view = screen.getByRole("combobox", { name: "View" });
      await user.selectOptions(view, "All sessions");
      expect(await screen.findByRole("table", { name: "Sessions" })).toBeInTheDocument();
    });

    it("lays out the narrowest supported panel, 360 px, as narrow", async () => {
      panelWidth(360);
      await openAnalyzeSession();

      expect(screen.getByRole("main")).toHaveAttribute("data-layout", "narrow");
      expect(screen.getByRole("combobox", { name: "View" })).toBeInTheDocument();
    });
  });

  // §3.5 Layout: "users choose and keep the visible columns".
  describe("turns table columns", () => {
    it("shows every column until the user chooses, as before", async () => {
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Cache Basics" }));

      expect(await screen.findAllByRole("columnheader")).toHaveLength(14);
      expect(screen.getByText("Showing 14 of 14 columns")).toBeInTheDocument();
    });

    it("restores the kept choice and keeps a new one in view-state storage", async () => {
      const storage = memoryViewStateStorage();
      storage.set("turnColumns", ["turn", "aiCredits"]);
      setViewStateStorage(storage);
      render(<App />);
      fireEvent.click(await screen.findByRole("button", { name: "Cache Basics" }));

      expect((await screen.findAllByRole("columnheader")).map((cell) => cell.textContent)).toEqual(["Turn", "AI Credits"]);

      fireEvent.click(screen.getByRole("button", { name: "Columns" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Model" }));

      expect(storage.get("turnColumns")).toEqual(["turn", "aiCredits", "model"]);
      expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    });
  });

  // vscode-extension.md §3.5 Performance: the host reads these (step 10.9).
  it("marks first-render on mount, then data-ready once the first list is on screen", async () => {
    const mark = vi.fn();
    render(<App performanceMarks={{ mark, read: () => ({}) }} />);

    expect(mark).toHaveBeenCalledWith("first-render");
    expect(mark).not.toHaveBeenCalledWith("data-ready");

    await screen.findByRole("button", { name: "Cache Basics" });
    await waitFor(() => expect(mark).toHaveBeenCalledWith("data-ready"));
    expect(mark.mock.calls.map(([name]) => name)).toEqual(["first-render", "data-ready"]);
  });

  describe("tool-call audit views (Phase 9.10)", () => {
    it("offers the audit view switch only in Analyze mode", async () => {
      render(<App />);
      await screen.findByRole("button", { name: "Cache Basics" });
      expect(screen.queryByLabelText("Tool audit")).not.toBeInTheDocument();

      switchToAnalyze();

      expect(screen.getByLabelText("Turns")).toBeChecked();
      expect(screen.getByLabelText("Tool audit")).toBeInTheDocument();
      expect(screen.getByLabelText("All sessions")).toBeInTheDocument();
    });

    it("shows the selected session's tool-call audit", async () => {
      render(<App />);
      switchToAnalyze();
      fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
      await screen.findByText("analyze turn explanation");

      fireEvent.click(screen.getByLabelText("Tool audit"));

      expect(await screen.findByRole("group", { name: "Failure rate" })).toHaveTextContent("75%");
      expect(fetch).toHaveBeenCalledWith("/api/sessions/session-1/audit");
    });

    it("asks for a session before showing a session audit", async () => {
      render(<App />);
      switchToAnalyze();
      await screen.findByRole("button", { name: "Fix the bug" });

      fireEvent.click(screen.getByLabelText("Tool audit"));

      expect(screen.getByText("Select a session to audit its tool calls.")).toBeInTheDocument();
    });

    it("shows the cross-session audit and opens a session from it into its own audit", async () => {
      render(<App />);
      switchToAnalyze();
      await screen.findByRole("button", { name: "Fix the bug" });

      fireEvent.click(screen.getByLabelText("All sessions"));
      const sessionsTable = await screen.findByRole("table", { name: "Sessions" });
      fireEvent.click(within(sessionsTable).getByRole("button", { name: "Fix the bug" }));

      expect(await screen.findByRole("group", { name: "Failure rate" })).toHaveTextContent("75%");
      expect(screen.getByLabelText("Tool audit")).toBeChecked();
    });

    it("resets to the turns view when switching modes", async () => {
      render(<App />);
      switchToAnalyze();
      await screen.findByRole("button", { name: "Fix the bug" });
      fireEvent.click(screen.getByLabelText("All sessions"));

      fireEvent.click(screen.getByLabelText("Learn"));
      switchToAnalyze();

      expect(screen.getByLabelText("Turns")).toBeChecked();
    });
  });

  describe("insights dashboard (Phase 9.11)", () => {
    it("offers a full-width Dashboard view in Analyze mode, across every provider", async () => {
      render(<App />);
      switchToAnalyze();
      await screen.findByRole("button", { name: "Fix the bug" });

      fireEvent.click(screen.getByLabelText("Dashboard"));

      expect(await screen.findByRole("group", { name: "AI Credits" })).toHaveTextContent("5.50");
      expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/insights\?since=\d{4}-\d{2}-\d{2}&limit=200$/), { signal: expect.any(AbortSignal) });
      // Full width: the session list and the right column step aside for the dashboard's own list boxes.
      expect(screen.getByLabelText("Explanation")).not.toBeVisible();
      expect(screen.getByRole("button", { name: "Fix the bug", hidden: true })).not.toBeVisible();
    });
  });

  describe("insights dashboard when the active provider has no sessions", () => {
    it("still reaches the cross-provider dashboard from the empty state", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: { body?: string }) =>
          url === "/api/sessions" ? Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) : fakeFetch(url, init),
        ),
      );
      render(<App />);
      switchToAnalyze();

      fireEvent.click(await screen.findByRole("button", { name: "Open the dashboard across all providers" }));

      expect(await screen.findByRole("group", { name: "AI Credits" })).toHaveTextContent("5.50");
      expect(screen.getByLabelText("Dashboard")).toBeChecked();
    });
  });

  // vscode-extension.md §3.3, G8, G10: the UI renders from the profile the
  // backend reports, and the host's capabilities, never from a product check.
  describe("product profile and host capabilities", () => {
    const loggingWarning = {
      code: "logging-disabled" as const,
      severity: "required" as const,
      settingId: "github.copilot.chat.agentDebugLog.fileLogging.enabled",
      currentValue: false,
      recommendedValue: true,
      message: "GitHub Copilot Chat debug logging is disabled.",
      helpSteps: ["Turn it on."],
    };
    const standaloneProfile: ProductProfile = {
      productId: "standalone",
      displayName: "Agent Cost Analyzer",
      version: "0.8.0",
      features: { providerSelect: true, crossProviderInsights: true, settingFixes: false, openInEditor: false, sessionSidebar: false },
    };
    const extensionProfile: ProductProfile = {
      productId: "vscode-extension",
      displayName: "AI Credits Analyzer",
      version: "0.1.0",
      features: { providerSelect: false, crossProviderInsights: false, settingFixes: true, openInEditor: true, sessionSidebar: false },
    };

    function editorHost() {
      const capabilities = {
        copyToClipboard: vi.fn().mockResolvedValue(undefined),
        openSetting: vi.fn().mockResolvedValue(undefined),
        openTextDocument: vi.fn().mockResolvedValue(undefined),
      };
      setHostCapabilities(capabilities);
      return capabilities;
    }

    it("fetches the profile once at startup", async () => {
      productProfile = standaloneProfile;
      render(<App />);

      expect(await screen.findByText("Agent Cost Analyzer")).toBeInTheDocument();
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/product")).toHaveLength(1);
    });

    it("holds the brand and provider select until the profile resolves, so neither product flashes", async () => {
      let resolveProfile: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        resolveProfile = resolve;
      });
      productProfile = extensionProfile;
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: { body?: string }) =>
          url === "/api/product" ? gate.then((): Promise<unknown> => fakeFetch(url, init)) : fakeFetch(url, init),
        ),
      );
      render(<App />);
      switchToAnalyze();
      await screen.findByRole("button", { name: "Fix the bug" });

      expect(screen.queryByText("Session Analyzer")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Log provider" })).not.toBeInTheDocument();

      resolveProfile();

      expect(await screen.findByText("AI Credits Analyzer")).toBeInTheDocument();
      expect(screen.queryByText("Session Analyzer")).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox", { name: "Log provider" })).not.toBeInTheDocument();
    });

    it("falls back to today's standalone UI, quietly, when the profile can't be fetched", async () => {
      configStatus = { ...cleanConfigStatus, warnings: [loggingWarning] };
      editorHost();
      render(<App />);

      expect(await screen.findByText(loggingWarning.message)).toBeInTheDocument();
      expect(screen.getByText("Session Analyzer")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Enable / })).not.toBeInTheDocument();
      expect(screen.queryByText(/failed with status 404/)).not.toBeInTheDocument();
      switchToAnalyze();
      expect(await screen.findByRole("combobox", { name: "Log provider" })).toBeInTheDocument();
    });

    describe("standalone profile", () => {
      it("shows its display name and the provider select, and no Fix buttons", async () => {
        productProfile = standaloneProfile;
        configStatus = { ...cleanConfigStatus, warnings: [loggingWarning] };
        render(<App />);

        expect(await screen.findByText("Agent Cost Analyzer")).toBeInTheDocument();
        expect(screen.getByText(loggingWarning.message)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Enable / })).not.toBeInTheDocument();
        switchToAnalyze();
        expect(await screen.findByRole("combobox", { name: "Log provider" })).toBeInTheDocument();
      });

      it("has no open-in-editor action in the system prompt inspector", async () => {
        productProfile = standaloneProfile;
        render(<App />);
        switchToAnalyze();
        fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
        await screen.findByText("analyze turn explanation");
        fireEvent.click(screen.getByLabelText("System prompt"));
        fireEvent.click(screen.getByRole("button", { name: "Open system prompt inspector" }));

        expect(await screen.findByRole("button", { name: /rules/i })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Open prompt in editor" })).not.toBeInTheDocument();
      });
    });

    describe("extension profile", () => {
      it("shows its display name and no provider select", async () => {
        productProfile = extensionProfile;
        editorHost();
        render(<App />);

        expect(await screen.findByText("AI Credits Analyzer")).toBeInTheDocument();
        switchToAnalyze();
        await screen.findByRole("button", { name: "Fix the bug" });
        expect(screen.queryByRole("combobox", { name: "Log provider" })).not.toBeInTheDocument();
      });

      it("Fix on a logging-disabled warning asks the host to open that setting", async () => {
        productProfile = extensionProfile;
        configStatus = { ...cleanConfigStatus, warnings: [loggingWarning] };
        const host = editorHost();
        render(<App />);

        fireEvent.click(
          await screen.findByRole("button", { name: "Enable github.copilot.chat.agentDebugLog.fileLogging.enabled" }),
        );

        expect(host.openSetting).toHaveBeenCalledWith("github.copilot.chat.agentDebugLog.fileLogging.enabled");
      });

      it("shows the error when the host refuses to open a setting", async () => {
        productProfile = extensionProfile;
        configStatus = { ...cleanConfigStatus, warnings: [loggingWarning] };
        const host = editorHost();
        host.openSetting.mockRejectedValue(new Error("Request to openSetting failed with status 400"));
        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: /^Enable / }));

        expect(await screen.findByText("Request to openSetting failed with status 400")).toBeInTheDocument();
      });

      it("hides Fix buttons when the host can't open settings, even if the product offers them", async () => {
        productProfile = extensionProfile;
        configStatus = { ...cleanConfigStatus, warnings: [loggingWarning] };
        setHostCapabilities({ copyToClipboard: vi.fn() });
        render(<App />);

        expect(await screen.findByText("AI Credits Analyzer")).toBeInTheDocument();
        expect(screen.getByText(loggingWarning.message)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Enable / })).not.toBeInTheDocument();
      });

      it("opens the raw system prompt in an editor from the inspector", async () => {
        productProfile = extensionProfile;
        const host = editorHost();
        render(<App />);
        await screen.findByText("AI Credits Analyzer");
        switchToAnalyze();
        fireEvent.click(await screen.findByRole("button", { name: "Fix the bug" }));
        await screen.findByText("analyze turn explanation");
        fireEvent.click(screen.getByLabelText("System prompt"));
        fireEvent.click(screen.getByRole("button", { name: "Open system prompt inspector" }));

        fireEvent.click(await screen.findByRole("button", { name: "Open prompt in editor" }));

        expect(host.openTextDocument).toHaveBeenCalledWith(SYSTEM_PROMPT_TEXT, "plaintext");
      });

      it("copies the advice bundle, naming the product, through the host's clipboard", async () => {
        productProfile = extensionProfile;
        const host = editorHost();
        render(<App />);
        await screen.findByText("AI Credits Analyzer");
        switchToAnalyze();
        fireEvent.click(await screen.findByRole("checkbox", { name: /Fix the bug/ }));
        fireEvent.click(await screen.findByRole("button", { name: "Export advice" }));

        fireEvent.click(screen.getByRole("button", { name: "Copy advice prompt" }));

        await waitFor(() => expect(host.copyToClipboard).toHaveBeenCalledTimes(1));
        expect(host.copyToClipboard.mock.calls[0]?.[0]).toContain("Exported from AI Credits Analyzer.");
      });

      it("titles the dashboard without cross-provider wording", async () => {
        productProfile = extensionProfile;
        editorHost();
        vi.stubGlobal(
          "fetch",
          vi.fn((url: string, init?: { body?: string }) =>
            url === "/api/sessions" ? Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) : fakeFetch(url, init),
          ),
        );
        render(<App />);
        await screen.findByText("AI Credits Analyzer");
        switchToAnalyze();

        fireEvent.click(await screen.findByRole("button", { name: "Open the dashboard" }));

        expect(await screen.findByRole("heading", { name: "Insights" })).toBeInTheDocument();
        expect(screen.queryByRole("listbox", { name: "Provider" })).not.toBeInTheDocument();
      });
    });
  });

  describe("selectSession host event (the extension's sidebar, D10)", () => {
    // The HTTP transport's requests, plus a WebviewTransport's host events.
    function hostEvents() {
      const http = getApiTransport();
      const handlers = new Set<(payload: unknown) => void>();
      setApiTransport({
        call: (method, params) => http.call(method, params),
        onEvent: (name, handler) => {
          if (name !== "selectSession") return () => undefined;
          handlers.add(handler);
          return () => void handlers.delete(handler);
        },
      });
      return (payload: unknown) => act(() => handlers.forEach((handler) => handler(payload)));
    }

    // Step 10.11: the extension's sidebar lists the sessions, so its
    // Analyze mode gives the panel's list column to the turns.
    describe("when the host lists the sessions in its sidebar (sessionSidebar)", () => {
      const sidebarProfile: ProductProfile = {
        productId: "vscode-extension",
        displayName: "AI Credits Analyzer",
        version: "0.1.0",
        features: { providerSelect: false, crossProviderInsights: false, settingFixes: true, openInEditor: true, sessionSidebar: true },
      };

      it("shows no session list of its own in Analyze mode, and points to the sidebar until a session is picked", async () => {
        productProfile = sidebarProfile;
        hostEvents();
        render(<App />);
        await screen.findByText("AI Credits Analyzer");
        switchToAnalyze();

        expect(await screen.findByText(/pick a session in the sessions view/i)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Fix the bug" })).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText("Search…")).not.toBeInTheDocument();
      });

      it("opens the session the sidebar picks", async () => {
        productProfile = sidebarProfile;
        const emit = hostEvents();
        render(<App />);
        await screen.findByText("AI Credits Analyzer");

        emit({ sessionId: "session-1" });

        expect(await screen.findByText("analyze turn explanation")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Fix the bug" })).not.toBeInTheDocument();
      });

      // Step 10.12: the sidebar's Learn view lists the scenarios too.
      it("shows no scenario list of its own in Learn mode, and points to the sidebar's Learn view", async () => {
        productProfile = sidebarProfile;
        hostEvents();
        render(<App />);
        await screen.findByText("AI Credits Analyzer");

        expect(await screen.findByText(/pick a scenario in the learn view/i)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Cache Basics" })).not.toBeInTheDocument();
      });

      it("opens the scenario the sidebar's Learn view picks, in Learn mode", async () => {
        productProfile = sidebarProfile;
        const emit = hostEvents();
        render(<App />);
        await screen.findByText("AI Credits Analyzer");
        switchToAnalyze();

        emit({ sessionId: "cache-basics", mode: "learn" });

        expect(await screen.findByText("first turn explanation")).toBeInTheDocument();
        expect(screen.getByLabelText("Learn")).toBeChecked();
      });

      it("opens a scenario picked before the scenarios have loaded, once they arrive", async () => {
        productProfile = sidebarProfile;
        const emit = hostEvents();
        render(<App />);

        emit({ sessionId: "cache-basics", mode: "learn" });

        expect(await screen.findByText("first turn explanation")).toBeInTheDocument();
      });
    });

    it("switches from Learn to Analyze mode, then selects and fetches the session like a click in the list", async () => {
      const emit = hostEvents();
      render(<App />);
      await screen.findByRole("button", { name: "Cache Basics" });

      emit({ sessionId: "session-1" });

      expect(await screen.findByText("analyze turn explanation")).toBeInTheDocument();
      expect(screen.getByLabelText("Analyze")).toBeChecked();
      expect(fetch).toHaveBeenCalledWith("/api/sessions/session-1");
    });

    it("selects the session when already in Analyze mode, keeping it selected", async () => {
      const emit = hostEvents();
      render(<App />);
      switchToAnalyze();
      await screen.findByRole("button", { name: "Fix the bug" });

      emit({ sessionId: "session-2" });

      expect(await screen.findByText("no-inventory turn explanation")).toBeInTheDocument();
    });

    it("shows the requested right-panel tab once the session has loaded", async () => {
      const emit = hostEvents();
      render(<App />);
      await screen.findByRole("button", { name: "Cache Basics" });

      emit({ sessionId: "session-1", tab: "tools" });

      await waitFor(() => expect(screen.getByLabelText("Tools")).toBeChecked());
      expect(await screen.findByText("read_file")).toBeInTheDocument();
    });

    it("shows the session's tool audit when asked for that view", async () => {
      const emit = hostEvents();
      render(<App />);
      await screen.findByRole("button", { name: "Cache Basics" });

      emit({ sessionId: "session-1", view: "session-audit" });

      expect(await screen.findByRole("group", { name: "Failure rate" })).toHaveTextContent("75%");
      expect(screen.getByLabelText("Tool audit")).toBeChecked();
    });

    it("opens the advice export dialog on just that session when asked", async () => {
      const emit = hostEvents();
      render(<App />);
      await screen.findByRole("button", { name: "Cache Basics" });

      emit({ sessionId: "session-1", adviceDialog: true });

      expect(await screen.findByText("Export advice bundle")).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /Fix the bug/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /No system-prompt data/ })).not.toBeChecked();
    });

    it("ignores a payload that isn't a valid selection", async () => {
      const emit = hostEvents();
      render(<App />);
      await screen.findByRole("button", { name: "Cache Basics" });
      vi.mocked(fetch).mockClear();

      emit({ sessionId: "" });
      emit({ sessionId: "session-1", tab: "settings" });
      emit(undefined);

      expect(screen.getByLabelText("Learn")).toBeChecked();
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});
