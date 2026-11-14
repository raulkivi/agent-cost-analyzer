// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_COMPARED_MODELS, type SessionReplayComparison, type VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { abortError } from "../../api-client/abort.js";
import { compareSessionReplay } from "../../api-client/replay.js";
import { axeViolations } from "../../test-support/axe.js";
import { CompareModelsView, type CompareModelsViewProps } from "./CompareModelsView.js";

vi.mock("../../api-client/replay.js", () => ({ compareSessionReplay: vi.fn() }));
const compare = vi.mocked(compareSessionReplay);

function profile(vendorId: string, displayName: string, models: Array<[string, boolean?]>): VendorProfileSummary {
  return {
    vendorId,
    displayName,
    defaultModelId: models[0]![0],
    models: models.map(([modelId, simulated = true]) => ({
      modelId,
      displayName: modelId,
      simulated,
      ...(simulated ? {} : { reason: "caching undocumented" }),
    })),
    assumptions: [],
    sources: [],
    oldestCheckedAt: "2026-10-01",
  };
}

const PROFILES = [
  profile("anthropic", "Anthropic", [["claude-opus-5.5"], ["claude-sonnet-5.5"], ["claude-haiku-5.5"]]),
  profile("openai", "OpenAI", [["gpt-6.1-sol"]]),
  profile("google", "Google", [["gemini-3.8-flash"]]),
  profile("xai", "xAI", [["grok-4.7"]]),
  profile("moonshot", "Moonshot AI", [["kimi-k3", false]]),
];

const total = (value: number | null) => ({ value, knownTurns: value === null ? 0 : 11, turns: 12 });

const COMPARISON: SessionReplayComparison = {
  simulated: true,
  sessionId: "s1",
  providerId: "claude-code",
  currency: "USD",
  measuredModels: ["claude-opus-5.5"],
  measured: total(4.82),
  entries: [
    { model: "claude-opus-5.5", vendorId: "anthropic", total: total(4.79), replayedTurns: 11, isMeasuredModel: true, isMixedSessionModel: false },
    { model: "claude-haiku-5.5", vendorId: "anthropic", total: total(0.97), replayedTurns: 11, isMeasuredModel: false, isMixedSessionModel: false },
    { model: "grok-4.7", vendorId: "xai", total: total(null), replayedTurns: 11, isMeasuredModel: false, isMixedSessionModel: false },
    { model: "gpt-6.1-sol", vendorId: "openai", total: total(3.36), replayedTurns: 11, isMeasuredModel: false, isMixedSessionModel: false },
  ],
};

let calls: Array<{ resolve(value: SessionReplayComparison): void; reject(error: unknown): void }>;

beforeEach(() => {
  calls = [];
  compare.mockReset();
  compare.mockImplementation(
    (_sessionId, _query, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ resolve, reject });
        signal?.addEventListener("abort", () => reject(abortError()));
      }),
  );
});

function renderView(overrides: Partial<CompareModelsViewProps> = {}) {
  const onPricingChange = vi.fn();
  const props: CompareModelsViewProps = {
    sessionId: "s1",
    providerId: "claude-code",
    profiles: PROFILES,
    initialModels: ["claude-haiku-5.5", "grok-4.7", "gpt-6.1-sol"],
    pricing: "session-channel",
    onPricingChange,
    ...overrides,
  };
  const view = render(<CompareModelsView {...props} />);
  return { ...view, props, onPricingChange };
}

async function renderReady(comparison = COMPARISON, overrides: Partial<CompareModelsViewProps> = {}) {
  const view = renderView(overrides);
  await act(async () => calls[calls.length - 1]!.resolve(comparison));
  return view;
}

function bodyRows(): HTMLElement[] {
  const table = screen.getByRole("table", { name: /Simulated cost of this session on each model/ });
  return within(table).getAllByRole("row").slice(1);
}

describe("CompareModelsView", () => {
  it("asks for the initial models on the session's provider and price channel", () => {
    renderView();
    expect(compare).toHaveBeenCalledWith(
      "s1",
      { models: ["claude-haiku-5.5", "grok-4.7", "gpt-6.1-sol"], pricing: "session-channel", provider: "claude-code" },
      expect.any(AbortSignal),
    );
  });

  it("is labelled Simulated", async () => {
    await renderReady();
    expect(screen.getAllByText("Simulated").length).toBeGreaterThan(0);
  });

  it("uses the shared Simulated badge and Learn's picker (one badge, one picker)", async () => {
    await renderReady();
    for (const badge of screen.getAllByText("Simulated")) expect(badge).toHaveClass("sim-badge");
    expect(screen.getByRole("combobox", { name: "Add model" }).closest(".vendor-picker")).not.toBeNull();
  });

  it("ranks the models by simulated total, highest first, unknown last", async () => {
    await renderReady();
    const models = bodyRows().map((row) => within(row).getAllByRole("cell")[0]!.textContent);
    expect(models.map((text) => text!.split("Measured model")[0])).toEqual(["claude-opus-5.5", "gpt-6.1-sol", "claude-haiku-5.5", "grok-4.7"]);
  });

  it("shows vendor, channel, total, signed difference with percent, and turns replayed", async () => {
    await renderReady();
    const gpt = bodyRows()[1]!;
    expect(gpt).toHaveTextContent("OpenAI");
    expect(gpt).toHaveTextContent("OpenAI API");
    expect(gpt).toHaveTextContent("$3.36");
    expect(gpt).toHaveTextContent("−$1.46 (−30.3%)");
    expect(gpt).toHaveTextContent("11 of 12");
  });

  it("tags the session's own model and offers no remove for it", async () => {
    await renderReady();
    const own = bodyRows()[0]!;
    expect(within(own).getByText("Measured model")).toBeInTheDocument();
    expect(within(own).queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove gpt-6.1-sol from the comparison" })).toBeInTheDocument();
  });

  it("writes an unknown total and difference as unknown, never 0", async () => {
    await renderReady();
    const grok = bodyRows()[3]!;
    const cells = within(grok).getAllByRole("cell");
    expect(cells[3]).toHaveTextContent("unknown");
    expect(cells[4]).toHaveTextContent("unknown");
    expect(grok).not.toHaveTextContent("$0");
    expect(screen.getByText(/its total is unknown, not \$0/)).toBeInTheDocument();
  });

  it("shows the measured total, the coverage and the bars", async () => {
    await renderReady();
    expect(screen.getByText(/Measured on claude-opus-5.5/)).toBeInTheDocument();
    expect(screen.getByText("11 of 12 turns replayed on claude-opus-5.5")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /^Simulated total per model, measured \$4\.82: claude-opus-5\.5 \(measured model\) \$4\.79/ })).toBeInTheDocument();
  });

  it("lists the subagent runs the comparison leaves out in the coverage block", async () => {
    await renderReady({ ...COMPARISON, subagentRuns: { runs: 3, costAiCredits: { known: true, value: 12 } } });
    expect(screen.getByText("3 subagent runs not replayed: replay covers the main agent only")).toBeInTheDocument();
  });

  it("shows no subagent line when the comparison has no runs left out", async () => {
    await renderReady();
    expect(screen.queryByText(/subagent run/)).toBeNull();
  });

  it("removing a model asks again without it, keeping the own model", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("button", { name: "Remove grok-4.7 from the comparison" }));
    expect(compare).toHaveBeenLastCalledWith(
      "s1",
      { models: ["claude-opus-5.5", "claude-haiku-5.5", "gpt-6.1-sol"], pricing: "session-channel", provider: "claude-code" },
      expect.any(AbortSignal),
    );
  });

  it("adds a model from the grouped picker, which lists unsimulated models disabled and leaves out compared ones", async () => {
    await renderReady();
    const picker = screen.getByRole("combobox", { name: "Add model" });
    expect(within(picker).getByRole("option", { name: "kimi-k3 (not simulated)" })).toBeDisabled();
    expect(within(picker).queryByRole("option", { name: "gpt-6.1-sol" })).toBeNull();
    expect(within(picker).getByRole("group", { name: "Google" })).toBeInTheDocument();
    expect(screen.getByText(/4 of 10/)).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: "gemini-3.8-flash" } });
    expect(compare).toHaveBeenLastCalledWith(
      "s1",
      { models: ["claude-opus-5.5", "claude-haiku-5.5", "grok-4.7", "gpt-6.1-sol", "gemini-3.8-flash"], pricing: "session-channel", provider: "claude-code" },
      expect.any(AbortSignal),
    );
  });

  it("disables Add model at the cap of 10 models", async () => {
    const many = Array.from({ length: MAX_COMPARED_MODELS }, (_, index) => `m${index}`);
    const profiles = [profile("anthropic", "Anthropic", [...many.map((id) => [id] as [string]), ["extra"]])];
    const comparison: SessionReplayComparison = {
      ...COMPARISON,
      entries: many.map((model, index) => ({ model, vendorId: "anthropic", total: total(index + 1), replayedTurns: 11, isMeasuredModel: index === 0, isMixedSessionModel: false })),
    };
    await renderReady(comparison, { profiles, initialModels: many.slice(1) });
    expect(screen.getByRole("combobox", { name: "Add model" })).toBeDisabled();
    expect(screen.getByText(/10 of 10/)).toBeInTheDocument();
  });

  it("the price switch calls onPricingChange and the note says how a non-Copilot session is priced", async () => {
    const { onPricingChange } = await renderReady();
    expect(screen.getByRole("note")).toHaveTextContent("on another vendor's model it moves to that vendor's API");
    fireEvent.click(screen.getByRole("radio", { name: "Copilot prices" }));
    expect(onPricingChange).toHaveBeenCalledWith("copilot");
  });

  it("prices a Copilot session at Copilot prices on its own channel, in AI Credits", async () => {
    await renderReady({ ...COMPARISON, currency: "AI_CREDITS" });
    expect(screen.getByRole("note")).toHaveTextContent("GitHub Copilot's prices");
    expect(bodyRows()[1]).toHaveTextContent("GitHub Copilot");
  });

  it("keeps the assumptions closed until asked", async () => {
    await renderReady();
    const toggle = screen.getByRole("button", { name: /Assumptions \(5\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Same conversation/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Same conversation/)).toBeInTheDocument();
  });

  it("shows a failure's message as given, and Retry asks again", async () => {
    renderView();
    await act(async () => calls[0]!.reject(new Error("Request to /api/sessions/s1/replay/compare failed with status 404")));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Couldn't compare models");
    expect(alert).toHaveTextContent("failed with status 404");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(compare).toHaveBeenCalledTimes(2);
  });

  it("shows loading with Cancel after a moment; Cancel stops it without an error", async () => {
    renderView();
    const cancel = await screen.findByRole("button", { name: "Cancel" }, { timeout: 1000 });
    await act(async () => fireEvent.click(cancel));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Loading cancelled")).toBeInTheDocument();
  });

  it("has no axe violations, with the table shown and with the assumptions open", async () => {
    await renderReady();
    expect(await axeViolations(document.body)).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /Assumptions/ }));
    fireEvent.click(screen.getByRole("button", { name: "View as table" }));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
