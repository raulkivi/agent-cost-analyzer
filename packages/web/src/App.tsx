import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  selectSessionPayloadSchema,
  type ConfigWarning,
  type LogProviderDescriptor,
  type ProductFeatures,
  type ProductProfile,
  type Session,
} from "@copilot-cost-analyzer/domain";
import { fetchConfigStatus, updateRetentionThreshold } from "./api-client/config-status.js";
import { onHostEvent } from "./api-client/host-events.js";
import { fetchHealth, type HealthResponse } from "./api-client/health.js";
import { fetchLearnScenarios } from "./api-client/learn-scenarios.js";
import { fetchLogProviderStatus, setActiveLogProvider } from "./api-client/log-providers.js";
import { fetchProductProfile } from "./api-client/product-profile.js";
import { fetchSession, fetchSessions } from "./api-client/sessions.js";
import { AdviceExportDialog } from "./components/AdviceExportDialog.js";
import { AdviceExportTriggerBar } from "./components/AdviceExportTriggerBar.js";
import { AppHeader } from "./components/AppHeader.js";
import { AuditRollupPanel } from "./components/AuditRollupPanel.js";
import { ColumnChooser } from "./components/ColumnChooser.js";
import { SessionKpiTiles } from "./components/SessionKpiTiles.js";
import { TurnMetrics } from "./components/TurnMetrics.js";
import { Drawer } from "./components/ui/Drawer.js";
import { InsightsDashboard } from "./components/insights/InsightsDashboard.js";
import { SessionAuditPanel } from "./components/SessionAuditPanel.js";
import { ConfigWarningBanner } from "./components/ConfigWarningBanner.js";
import { ExplanationPanel } from "./components/ExplanationPanel.js";
import { SessionList } from "./components/SessionList.js";
import { SystemPromptBreakdown } from "./components/SystemPromptBreakdown.js";
import { SystemPromptInspector } from "./components/SystemPromptInspector.js";
import { TimelineScrubber } from "./components/TimelineScrubber.js";
import { ToolInventoryPanel } from "./components/ToolInventoryPanel.js";
import { TurnInspector } from "./components/TurnInspector.js";
import { TurnsTable } from "./components/TurnsTable.js";
import { AsyncView } from "./components/ui/AsyncView.js";
import { Blueprint } from "./components/ui/Blueprint.js";
import { SegmentedControl } from "./components/ui/SegmentedControl.js";
import { Tag } from "./components/ui/Tag.js";
import { AiCreditsSparkline } from "./charts/AiCreditsSparkline.js";
import { getHostCapabilities } from "./host/current-host-capabilities.js";
import { performanceMarks as pagePerformanceMarks, type PerformanceMarks } from "./lib/performance-marks.js";
import { layoutFor, type Layout } from "./lib/layout.js";
import { ALL_TURN_COLUMNS, hiddenTurnColumns, parseTurnColumns, turnColumnsFor, type TurnColumnId } from "./lib/turn-columns.js";
import { useContainerWidth } from "./lib/use-container-width.js";
import { getViewStateStorage } from "./state/current-view-state-storage.js";
import { useSessionStore, type RightTab } from "./state/session-store.js";

const RIGHT_TAB_OPTIONS = [
  { value: "explanation", label: "Explanation" },
  { value: "system-prompt", label: "System prompt" },
  { value: "tools", label: "Tools" },
] as const;

// Analyze-mode center views: the existing turns table, one session's
// tool-call audit, the cross-session audit (Phase 9.10), or the
// cross-provider associative insights dashboard (Phase 9.11).
const CENTER_VIEW_OPTIONS = [
  { value: "turns", label: "Turns" },
  { value: "session-audit", label: "Tool audit" },
  { value: "rollup", label: "All sessions" },
  { value: "dashboard", label: "Dashboard" },
] as const;

type CenterView = (typeof CENTER_VIEW_OPTIONS)[number]["value"];

// A session or scenario list's fetch (§3.5 States).
type ListLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: Session[] };

// The open Analyze session's fetch; idle once it's loaded (or none is).
type SessionLoad =
  | { status: "idle" }
  | { status: "loading"; sessionId: string }
  | { status: "error"; sessionId: string; message: string };

// The view-state storage key for the turns table's chosen columns.
const TURN_COLUMNS_KEY = "turnColumns";

// §3.5 Layout: list, centre and right column at wide widths (as always);
// list and centre at medium, with the right column in a drawer; one column
// at narrow widths.
const GRID_COLUMNS: Record<Layout, string> = {
  wide: "280px 1fr 340px",
  medium: "240px minmax(0, 1fr)",
  narrow: "minmax(0, 1fr)",
};

// The centre column spans whatever the session list and right column leave.
function centerColumnStyle(layout: Layout, showDashboard: boolean, hideRightColumn: boolean): CSSProperties | undefined {
  if (layout === "narrow") return undefined;
  if (showDashboard) return { gridColumn: layout === "wide" ? "1 / 4" : "1 / 3" };
  return layout === "wide" && hideRightColumn ? { gridColumn: "2 / 4" } : undefined;
}

// What the UI does until the product profile arrives, or when the backend
// can't report one: the standalone app as it has always been (no setting
// fixes or open-in-editor, which need a host). See vscode-extension.md §3.3.
const FALLBACK_FEATURES: ProductFeatures = {
  providerSelect: true,
  crossProviderInsights: true,
  settingFixes: false,
  openInEditor: false,
};

const EMPTY_STATES = {
  learn: {
    title: "No bundled Learn scenarios found",
    body: "Scenario fixtures ship with the app — if this list is empty, the bundled fixtures failed to load. Check packages/server/fixtures.",
  },
  analyze: {
    title: "No Copilot Chat sessions found yet",
    body: "This reads your local Copilot Chat session store. Run a chat session in VS Code, then reload this page.",
  },
} as const;

interface AppProps {
  // Where the §3.5 timing marks go; the page's own Performance API unless a
  // test passes a fake.
  performanceMarks?: PerformanceMarks;
}

export function App({ performanceMarks = pagePerformanceMarks }: AppProps = {}) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [scenarioList, setScenarioList] = useState<ListLoad>({ status: "loading" });
  const [scenarioAttempt, setScenarioAttempt] = useState(0);
  const [sessionList, setSessionList] = useState<ListLoad>({ status: "loading" });
  const [sessionAttempt, setSessionAttempt] = useState(0);
  // The open Analyze session's own fetch, for the turns view's states.
  const [sessionLoad, setSessionLoad] = useState<SessionLoad>({ status: "idle" });
  const [configWarnings, setConfigWarnings] = useState<ConfigWarning[]>([]);
  const [retentionThreshold, setRetentionThreshold] = useState<number | undefined>(undefined);
  const [showConfigBanner, setShowConfigBanner] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [adviceSelection, setAdviceSelection] = useState<Set<string>>(new Set());
  const [adviceDialogOpen, setAdviceDialogOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [turnInspectorOpen, setTurnInspectorOpen] = useState(false);
  const [providers, setProviders] = useState<LogProviderDescriptor[]>([]);
  const [centerView, setCenterView] = useState<CenterView>("turns");
  const [productProfile, setProductProfile] = useState<ProductProfile | null>(null);
  // Whether the profile has resolved or failed: until then the header holds
  // its brand area (no product's wordmark or provider select can flash).
  const [profileSettled, setProfileSettled] = useState(false);
  // The turns table's chosen columns, kept between visits (§3.5 Layout).
  const [chosenColumns, setChosenColumns] = useState<TurnColumnId[]>(
    () => parseTurnColumns(getViewStateStorage().get(TURN_COLUMNS_KEY)) ?? ALL_TURN_COLUMNS,
  );
  const {
    session,
    selectedTurnIndex,
    mode,
    rightTab,
    activeProviderId,
    loadSession,
    selectTurn,
    setMode,
    setRightTab,
    setActiveProviderId,
  } = useSessionStore();
  const latestSessionRequestId = useRef(0);
  // §3.5 Layout: by the panel's own width, not the window's.
  const [containerRef, containerWidth] = useContainerWidth<HTMLElement>();
  const layout = layoutFor(containerWidth);
  // The right column's drawer (medium) or the turn details drawer (narrow).
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    performanceMarks.mark("first-render");
  }, [performanceMarks]);

  // Once at startup. A failure is not an error the user can act on (e.g. an
  // older server without GET /api/product): the fallback features apply.
  useEffect(() => {
    fetchProductProfile()
      .then(setProductProfile)
      .catch(() => undefined)
      .finally(() => setProfileSettled(true));
  }, []);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((error: Error) => setFetchError(error.message));
  }, []);

  useEffect(() => {
    setScenarioList({ status: "loading" });
    fetchLearnScenarios()
      .then((items) => setScenarioList({ status: "ready", items }))
      .catch((error: Error) => setScenarioList({ status: "error", message: error.message }));
  }, [scenarioAttempt]);

  useEffect(() => {
    fetchLogProviderStatus()
      .then((status) => {
        setProviders(status.providers);
        setActiveProviderId(status.activeProviderId);
      })
      .catch((error: Error) => setFetchError(error.message));
    // Only ever needs to run once — subsequent provider changes go through
    // handleProviderChange below, which already has the fresh status.
  }, []);

  // Re-fetches whenever the active Analyze-mode provider changes, so the
  // list reflects whichever provider GET /api/sessions currently reads from
  // (architecture.md §5's "reloads the same GET /api/sessions resource").
  useEffect(() => {
    let cancelled = false;
    setSessionList({ status: "loading" });
    fetchSessions()
      .then((items) => !cancelled && setSessionList({ status: "ready", items }))
      .catch((error: Error) => !cancelled && setSessionList({ status: "error", message: error.message }));
    return () => {
      cancelled = true;
    };
  }, [activeProviderId, sessionAttempt]);

  // Loads on mount, and again whenever the host says the Copilot logging
  // settings changed (the extension's configChanged event; the standalone
  // app's HTTP transport never sends one).
  useEffect(() => {
    function loadConfigStatus(): void {
      fetchConfigStatus()
        .then((status) => {
          setConfigWarnings(status.warnings);
          setRetentionThreshold(status.minRetainedSessionLogsThreshold);
        })
        .catch((error: Error) => setFetchError(error.message));
    }
    loadConfigStatus();
    return onHostEvent("configChanged", loadConfigStatus);
  }, []);

  // The extension's sidebar picked a session (D10, the selectSession event):
  // handled like a click in the session list. The subscription is made once;
  // it calls whichever handler the latest render built.
  const selectSessionFromHost = useRef<(payload: unknown) => void>(() => undefined);
  useEffect(() => {
    selectSessionFromHost.current = handleSelectSessionEvent;
  });
  useEffect(() => onHostEvent("selectSession", (payload) => selectSessionFromHost.current(payload)), []);

  // The profile's flags and the host's capabilities become plain props:
  // each component only gets the callback or flag it needs (ISP), and an
  // affordance shows only when the product offers it and the host can do it.
  const features = productProfile?.features ?? FALLBACK_FEATURES;
  const host = getHostCapabilities();
  const { openSetting, openTextDocument } = host;
  const handleFixSetting =
    features.settingFixes && openSetting
      ? (settingId: string) => {
          openSetting(settingId).catch((error: Error) => setFetchError(error.message));
        }
      : undefined;
  const handleOpenPromptInEditor =
    features.openInEditor && openTextDocument
      ? (text: string) => {
          openTextDocument(text, "plaintext").catch((error: Error) => setFetchError(error.message));
        }
      : undefined;

  const selectedTurn = session?.turns[selectedTurnIndex] ?? null;
  const inspectorShown = session !== null && (inspectorOpen || turnInspectorOpen);
  // "All sessions" hides the right column; the dashboard brings its own
  // list boxes, so it hides the session list as well.
  const showDashboard = mode === "analyze" && centerView === "dashboard";
  const hideRightColumn = mode === "analyze" && (centerView === "rollup" || showDashboard);
  const visibleColumns = turnColumnsFor(layout, chosenColumns);
  const showDetailsDrawer = layout !== "wide" && detailsOpen && !hideRightColumn && selectedTurn !== null;
  const listLoad = mode === "learn" ? scenarioList : sessionList;
  const listForMode = listLoad.status === "ready" ? listLoad.items : [];
  const listLoaded = listLoad.status === "ready";

  // After the commit that put the first session or scenario list on screen.
  useEffect(() => {
    if (listLoaded) {
      performanceMarks.mark("data-ready");
    }
  }, [listLoaded, performanceMarks]);
  // The dashboard reads every provider, so an empty active provider must
  // not hide it.
  const showEmptyState = listLoaded && listForMode.length === 0 && !showDashboard;
  const allAiCreditsKnown =
    session !== null && session.turns.length > 0 && session.turns.every((turn) => turn.usage.costAiCredits.known);
  // toolInventory only comes from a parsed main.jsonl; a turn's toolCalls
  // come independently from SQLite session_files, so either source having
  // data means tool-call detail is available for the selected turn.
  const toolCallsAvailable =
    (selectedTurn?.toolCalls.length ?? 0) > 0 || (session?.toolInventory?.length ?? 0) > 0;
  // Use the fully-fetched session (with turns/systemPrompt/toolInventory) in
  // place of its lightweight list summary when it's the currently open one —
  // fetchSessions() only returns per-session summaries, so the advice bundle
  // would otherwise report an empty turn history for Analyze-mode sessions.
  const adviceSessions = listForMode
    .filter((candidate) => adviceSelection.has(candidate.id))
    .map((candidate) => (session?.id === candidate.id ? session : candidate));

  function handleProviderChange(id: string): void {
    setActiveLogProvider(id)
      .then((status) => {
        // The store drops the open session; drop its pending fetch too.
        latestSessionRequestId.current++;
        setSessionLoad({ status: "idle" });
        setProviders(status.providers);
        setActiveProviderId(status.activeProviderId);
      })
      .catch((error: Error) => setFetchError(error.message));
  }

  function handleRetentionThresholdChange(value: number): void {
    updateRetentionThreshold(value)
      .then((status) => {
        setConfigWarnings(status.warnings);
        setRetentionThreshold(status.minRetainedSessionLogsThreshold);
      })
      .catch((error: Error) => setFetchError(error.message));
  }

  function handleModeChange(next: typeof mode): void {
    // A pending or failed Analyze session fetch belongs to the old mode.
    latestSessionRequestId.current++;
    setSessionLoad({ status: "idle" });
    setAdviceSelection(new Set());
    setAdviceDialogOpen(false);
    setInspectorOpen(false);
    setTurnInspectorOpen(false);
    setCenterView("turns");
    setDetailsOpen(false);
    setMode(next);
  }

  function handleToggleAdvice(picked: Session): void {
    setAdviceSelection((current) => {
      const next = new Set(current);
      if (next.has(picked.id)) {
        next.delete(picked.id);
      } else {
        next.add(picked.id);
      }
      return next;
    });
  }

  function handleSelectSession(picked: Session): void {
    setInspectorOpen(false);
    setTurnInspectorOpen(false);
    if (mode === "analyze") {
      openAnalyzeSession(picked.id);
    } else {
      loadSession(picked);
    }
  }

  // `tab` is applied once the session has loaded: loading a session resets
  // the right column to its first tab.
  function openAnalyzeSession(sessionId: string, tab?: RightTab): void {
    const requestId = ++latestSessionRequestId.current;
    setSessionLoad({ status: "loading", sessionId });
    fetchSession(sessionId)
      .then((result) => {
        // Ignore a response for a session the user has since navigated
        // away from — otherwise a slower earlier request can resolve
        // after a faster later one and overwrite it.
        if (requestId === latestSessionRequestId.current) {
          loadSession(result);
          setSessionLoad({ status: "idle" });
          if (tab) {
            setRightTab(tab);
          }
        }
      })
      .catch((error: Error) => {
        if (requestId === latestSessionRequestId.current) {
          setSessionLoad({ status: "error", sessionId, message: error.message });
        }
      });
  }

  function handleSelectSessionEvent(payload: unknown): void {
    const parsed = selectSessionPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const { sessionId, tab, view, adviceDialog } = parsed.data;
    if (mode !== "analyze") {
      handleModeChange("analyze");
    }
    setInspectorOpen(false);
    setTurnInspectorOpen(false);
    // The dashboard and the all-sessions audit have no selected session to
    // show, so they give way to the turns; a session audit stays.
    setCenterView(view ?? (mode === "analyze" && centerView === "session-audit" ? "session-audit" : "turns"));
    if (adviceDialog) {
      setAdviceSelection(new Set([sessionId]));
      setAdviceDialogOpen(true);
    }
    openAnalyzeSession(sessionId, tab);
  }

  function handleOpenSessionAudit(sessionId: string): void {
    setInspectorOpen(false);
    setTurnInspectorOpen(false);
    setCenterView("session-audit");
    openAnalyzeSession(sessionId);
  }

  function handleColumnsChange(columns: TurnColumnId[]): void {
    setChosenColumns(columns);
    getViewStateStorage().set(TURN_COLUMNS_KEY, columns);
  }

  function handleInspectTurn(turnPosition: number): void {
    selectTurn(turnPosition);
    setTurnInspectorOpen(true);
  }

  // The right column: the tabs and their panels. Beside the table at wide
  // widths; in a drawer otherwise (§3.5 Layout).
  const rightColumn = (
    <>
      {mode === "analyze" ? (
        <SegmentedControl
          name="right-tab"
          options={RIGHT_TAB_OPTIONS}
          value={rightTab}
          onChange={setRightTab}
          className="right-tab-seg"
        />
      ) : (
        <h6 style={{ margin: "0 0 0 var(--space-1)" }}>Explanation</h6>
      )}
      <div style={{ marginTop: "var(--space-2)" }}>
        {(mode === "learn" || rightTab === "explanation") && (
          <ExplanationPanel
            turn={selectedTurn}
            mode={mode}
            toolCallsAvailable={toolCallsAvailable}
            onOpenTurnInspector={
              mode === "analyze" && session ? () => setTurnInspectorOpen(true) : undefined
            }
          />
        )}
        {mode === "analyze" && rightTab === "system-prompt" && (
          <SystemPromptBreakdown
            components={session?.systemPrompt ?? []}
            providerId={session?.providerId}
            onOpenInspector={session ? () => setInspectorOpen(true) : undefined}
          />
        )}
        {mode === "analyze" && rightTab === "tools" && (
          <ToolInventoryPanel entries={session?.toolInventory ?? []} />
        )}
      </div>
    </>
  );

  return (
    <main ref={containerRef} data-layout={layout}>
      <AppHeader
        mode={mode}
        onModeChange={handleModeChange}
        hasConfigWarnings={configWarnings.length > 0}
        onConfigClick={() => setShowConfigBanner(true)}
        providers={providers}
        activeProviderId={activeProviderId}
        onProviderChange={handleProviderChange}
        minRetainedSessionLogsThreshold={retentionThreshold}
        onRetentionThresholdChange={handleRetentionThresholdChange}
        displayName={productProfile?.displayName}
        providerSelect={features.providerSelect}
        profilePending={!profileSettled}
      />
      <p className="text-muted" style={{ fontSize: 11, margin: "var(--space-2) var(--space-4) 0" }}>
        {health ? `status: ${health.status} · v${health.version}` : "Checking server…"}
      </p>
      {fetchError && (
        <p
          role="alert"
          style={{ fontSize: 12, margin: "var(--space-2) var(--space-4) 0", color: "var(--color-accent-800)" }}
        >
          {fetchError}
        </p>
      )}
      {showConfigBanner && (
        <ConfigWarningBanner
          warnings={configWarnings}
          onDismiss={() => setShowConfigBanner(false)}
          onFixSetting={handleFixSetting}
        />
      )}

      {inspectorOpen && session ? (
        <SystemPromptInspector
          sessionId={session.id}
          sessionTitle={session.title}
          model={session.model}
          providerId={session.providerId}
          onClose={() => setInspectorOpen(false)}
          onOpenInEditor={handleOpenPromptInEditor}
        />
      ) : turnInspectorOpen && session ? (
        <TurnInspector
          sessionId={session.id}
          turnIndex={selectedTurnIndex}
          sessionTitle={session.title}
          triggeredEvent={selectedTurn?.triggeredEvent}
          usageDataAvailable={session.usageDataAvailable}
          onClose={() => setTurnInspectorOpen(false)}
        />
      ) : null}

      {/* Kept (hidden) while an inspector is open, so the control that opened
          it is still there to take focus back when it closes (§3.5). */}
      <div hidden={inspectorShown}>
        {showEmptyState ? (
          <div style={{ padding: "var(--space-8) var(--space-4)", display: "flex", justifyContent: "center" }}>
            <Blueprint style={{ maxWidth: 460 }}>
              <AsyncView
                status="empty"
                loadingText=""
                empty={{
                  title: EMPTY_STATES[mode].title,
                  body: EMPTY_STATES[mode].body,
                  action:
                    mode === "analyze"
                      ? {
                          label: features.crossProviderInsights
                            ? "Open the dashboard across all providers"
                            : "Open the dashboard",
                          onClick: () => setCenterView("dashboard"),
                        }
                      : undefined,
                }}
              />
            </Blueprint>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: GRID_COLUMNS[layout],
              gap: "var(--space-4)",
              padding: "var(--space-4)",
              alignItems: "start",
            }}
          >
            <div style={showDashboard ? { display: "none" } : undefined}>
              <AsyncView
                status={listLoad.status}
                loadingText={mode === "learn" ? "Loading scenarios…" : "Loading sessions…"}
                readyText={`${listForMode.length} ${mode === "learn" ? "scenarios" : "sessions"} loaded.`}
                skeleton="list"
                error={
                  listLoad.status === "error"
                    ? {
                        title: mode === "learn" ? "Couldn't load the Learn scenarios" : "Couldn't load the session list",
                        details: listLoad.message,
                        onRetry: () =>
                          mode === "learn"
                            ? setScenarioAttempt((current) => current + 1)
                            : setSessionAttempt((current) => current + 1),
                      }
                    : undefined
                }
              >
                <SessionList
                  mode={mode}
                  sessions={listForMode}
                  selectedSessionId={session?.id ?? null}
                  onSelect={handleSelectSession}
                  adviceSelection={adviceSelection}
                  onToggleAdvice={handleToggleAdvice}
                />
              </AsyncView>
              <AdviceExportTriggerBar count={adviceSessions.length} onExport={() => setAdviceDialogOpen(true)} />
              <AdviceExportDialog
                sessions={adviceSessions}
                open={adviceDialogOpen}
                onClose={() => setAdviceDialogOpen(false)}
                copyToClipboard={host.copyToClipboard}
                productName={productProfile?.displayName}
              />
            </div>

            <div style={centerColumnStyle(layout, showDashboard, hideRightColumn)}>
              {mode === "analyze" &&
                (layout === "narrow" ? (
                  <label className="view-select">
                    <span className="text-muted">View</span>
                    <select
                      className="input"
                      value={centerView}
                      onChange={(event) => setCenterView(event.target.value as CenterView)}
                    >
                      {CENTER_VIEW_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <SegmentedControl
                    name="center-view"
                    options={CENTER_VIEW_OPTIONS}
                    value={centerView}
                    onChange={setCenterView}
                    className="center-view-seg"
                  />
                ))}
              <div style={mode === "analyze" ? { marginTop: "var(--space-3)" } : undefined}>
              {showDashboard ? (
                <InsightsDashboard crossProvider={features.crossProviderInsights} />
              ) : mode === "analyze" && centerView === "rollup" ? (
                <AuditRollupPanel onOpenSession={handleOpenSessionAudit} key={activeProviderId} />
              ) : mode === "analyze" && centerView === "session-audit" ? (
                session ? (
                  <SessionAuditPanel
                    sessionId={session.id}
                    selectedTurnIndex={selectedTurnIndex}
                    onSelectTurn={selectTurn}
                    onInspectTurn={handleInspectTurn}
                    onShowAllSessions={() => setCenterView("rollup")}
                  />
                ) : (
                  <p className="text-muted" style={{ fontSize: 13 }}>
                    Select a session to audit its tool calls.
                  </p>
                )
              ) : sessionLoad.status !== "idle" ? (
                <AsyncView
                  status={sessionLoad.status}
                  loadingText="Loading session…"
                  skeleton="table"
                  error={
                    sessionLoad.status === "error"
                      ? {
                          title: "Couldn't open this session",
                          details: sessionLoad.message,
                          onRetry: () => openAnalyzeSession(sessionLoad.sessionId),
                        }
                      : undefined
                  }
                />
              ) : session ? (
                <>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      flexWrap: "wrap",
                      marginBottom: "var(--space-3)",
                    }}
                  >
                    <h3 className="truncate" style={{ margin: 0, maxWidth: 360 }}>
                      {session.title}
                    </h3>
                    <Tag variant="accent">{session.model}</Tag>
                    <Tag variant={session.usageDataAvailable ? "accent" : "outline"}>
                      {session.usageDataAvailable ? "usage: known" : "usage: unavailable"}
                    </Tag>
                    {allAiCreditsKnown ? (
                      <AiCreditsSparkline turns={session.turns} />
                    ) : (
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        AI Credits: unavailable
                      </span>
                    )}
                    <div style={{ marginLeft: "auto", display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
                      {layout !== "narrow" && <ColumnChooser visible={chosenColumns} onChange={handleColumnsChange} />}
                      {layout !== "wide" && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ fontSize: 12, padding: "2px 8px" }}
                          aria-expanded={showDetailsDrawer}
                          onClick={() => setDetailsOpen((current) => !current)}
                        >
                          Details
                        </button>
                      )}
                    </div>
                  </div>
                  {layout === "narrow" && <SessionKpiTiles turns={session.turns} />}
                  {/* Below wide widths the table scrolls inside its column;
                      at wide widths it sizes the column, as it always has. */}
                  <div className={layout === "wide" ? undefined : "table-scroll"}>
                    <TurnsTable
                      turns={session.turns}
                      selectedTurnIndex={selectedTurnIndex}
                      onSelectTurn={selectTurn}
                      onOpenTurn={layout === "wide" ? undefined : () => setDetailsOpen(true)}
                      columns={visibleColumns}
                    />
                  </div>
                  {showDetailsDrawer && selectedTurn && (
                    <Drawer
                      title={`Turn ${selectedTurn.index} details`}
                      placement={layout === "narrow" ? "inline" : "side"}
                      onClose={() => setDetailsOpen(false)}
                    >
                      {layout === "narrow" && (
                        <TurnMetrics
                          turns={session.turns}
                          turnIndex={selectedTurnIndex}
                          columns={hiddenTurnColumns(visibleColumns)}
                        />
                      )}
                      {rightColumn}
                    </Drawer>
                  )}
                  <div style={{ marginTop: "var(--space-4)" }}>
                    <TimelineScrubber
                      turnCount={session.turns.length}
                      selectedTurnIndex={selectedTurnIndex}
                      onSelectTurn={selectTurn}
                    />
                  </div>
                </>
              ) : (
                <p className="text-muted" style={{ fontSize: 13 }}>
                  Select a {mode === "learn" ? "scenario" : "session"} to view its turns.
                </p>
              )}
              </div>
            </div>

            {layout === "wide" && (
              <div style={hideRightColumn ? { display: "none" } : undefined}>{rightColumn}</div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
