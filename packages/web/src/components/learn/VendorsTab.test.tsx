// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VendorComparison, VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../../test-support/axe.js";
import { VendorsTab } from "./VendorsTab.js";

const profiles: VendorProfileSummary[] = [
  {
    vendorId: "anthropic",
    displayName: "Anthropic",
    defaultModelId: "sonnet",
    models: [
      { modelId: "sonnet", displayName: "Claude Sonnet 5.5", simulated: true },
      { modelId: "opus", displayName: "Claude Opus 5.5", simulated: true },
    ],
    assumptions: [],
    sources: [],
    oldestCheckedAt: "2026-11-03",
  },
  {
    vendorId: "moonshot",
    displayName: "Moonshot AI",
    defaultModelId: "kimi",
    models: [{ modelId: "kimi", displayName: "Kimi", simulated: false, reason: "Not simulated" }],
    assumptions: [],
    sources: [],
    oldestCheckedAt: "2026-11-03",
  },
];

const t = (index: number, cacheOutcome: "hit" | "partial" | "miss" | "unknown", credits: number | null) => ({
  index,
  cacheOutcome,
  aiCredits: credits === null ? { known: false as const, reason: "r" } : { known: true as const, value: credits },
  note: "n",
  sourceIds: [],
});

const comparison: VendorComparison = {
  scenarioId: "s",
  entries: [
    {
      vendorId: "anthropic",
      modelId: "sonnet",
      displayName: "Claude Sonnet 5.5",
      simulated: true,
      totalAiCredits: { known: true, value: 3 },
      turns: [t(1, "miss", 2), t(2, "hit", 1)],
    },
    {
      vendorId: "anthropic",
      modelId: "opus",
      displayName: "Claude Opus 5.5",
      simulated: true,
      totalAiCredits: { known: true, value: 1 },
      turns: [t(1, "miss", 0.6), t(2, "partial", 0.4)],
    },
    {
      vendorId: "xai",
      modelId: "grok",
      displayName: "Grok 4.7",
      simulated: true,
      totalAiCredits: { known: false, reason: "unknown" },
      turns: [t(1, "unknown", null)],
    },
  ],
};

function renderTab(extra: Partial<React.ComponentProps<typeof VendorsTab>> = {}) {
  const onAdd = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <VendorsTab
      comparison={comparison}
      profiles={profiles}
      extraModelIds={["opus"]}
      onAddModel={onAdd}
      onRemoveModel={onRemove}
      {...extra}
    />,
  );
  return { ...utils, onAdd, onRemove };
}

const blocks = () => within(screen.getByRole("list", { name: /each vendor/ })).getAllByRole("listitem");
const blockFor = (name: string) => blocks().find((block) => within(block).queryByText(name))!;
// The value shown under a label inside one model's block (dt -> next dd).
const figure = (block: HTMLElement, label: string) => within(block).getByText(label, { selector: "dt" }).nextElementSibling;
const modelOrder = () => blocks().map((block) => within(block).getByRole("heading").textContent ?? "");

describe("VendorsTab", () => {
  it("shows one block per model with every labelled figure", () => {
    renderTab();
    expect(blocks()).toHaveLength(3);
    const sonnet = blockFor("Claude Sonnet 5.5");
    expect(within(sonnet).getByRole("heading")).toHaveTextContent("Claude Sonnet 5.5");
    expect(figure(sonnet, "Total AI credits")).toHaveTextContent("3.00");
    expect(figure(sonnet, "USD")).toHaveTextContent("$0.03");
    expect(figure(sonnet, "Cache hits")).toHaveTextContent("50%");
    expect(figure(sonnet, "Misses")).toHaveTextContent("1");
    expect(figure(sonnet, "Most expensive turn")).toHaveTextContent("Turn 1 (2.00)");
  });

  it("shows unavailable, never zero, when a model's figures are unknown", () => {
    renderTab();
    const grok = blockFor("Grok 4.7");
    for (const label of ["Total AI credits", "USD", "Cache hits", "Most expensive turn"]) {
      expect(figure(grok, label)).toHaveTextContent("unavailable");
    }
  });

  it("has a per-turn strip of outcome marks for each model", () => {
    renderTab();
    const opus = blockFor("Claude Opus 5.5");
    expect(within(opus).getByText("Cache miss")).toBeInTheDocument();
    expect(within(opus).getByText("Cache partial hit")).toBeInTheDocument();
  });

  it("sorts with a Sort by select and a direction button", () => {
    renderTab();
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "total" } });
    expect(modelOrder()[0]).toContain("Claude Opus 5.5");
    expect(modelOrder().at(-1)).toContain("Grok 4.7");
    fireEvent.click(screen.getByRole("button", { name: /Ascending/ }));
    expect(screen.getByRole("button", { name: /Descending/ })).toBeInTheDocument();
    expect(modelOrder()[0]).toContain("Claude Sonnet 5.5");
  });

  it("offers a Remove button only on added models", () => {
    const { onRemove } = renderTab();
    expect(screen.getAllByRole("button", { name: /^Remove/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove Claude Opus 5.5" }));
    expect(onRemove).toHaveBeenCalledWith("opus");
  });

  it("adds a simulated model that isn't shown yet, and never offers one that isn't simulated", () => {
    const { onAdd } = renderTab({
      extraModelIds: [],
      comparison: { scenarioId: "s", entries: [comparison.entries[0]!] },
    });
    const select = screen.getByLabelText("Add a model");
    expect(within(select).queryByRole("option", { name: /Kimi/ })).not.toBeInTheDocument();
    expect(within(select).queryByRole("option", { name: "Claude Sonnet 5.5" })).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: "opus" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenCalledWith("opus");
  });

  it("shows the reason for a model that is not simulated", () => {
    renderTab({
      comparison: {
        scenarioId: "s",
        entries: [{ vendorId: "xai", modelId: "grok", displayName: "Grok 4.7", simulated: false, reason: "No cheaper model.", turns: [] }],
      },
    });
    expect(screen.getByText("No cheaper model.")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = renderTab();
    expect(await axeViolations(container)).toEqual([]);
  });
});
