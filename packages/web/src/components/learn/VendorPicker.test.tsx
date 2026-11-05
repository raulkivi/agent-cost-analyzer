import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VendorProfileSummary } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../../test-support/axe.js";
import { VendorPicker } from "./VendorPicker.js";

const profile = (
  vendorId: string,
  displayName: string,
  models: VendorProfileSummary["models"],
): VendorProfileSummary => ({
  vendorId,
  displayName,
  defaultModelId: models[0]!.modelId,
  models,
  assumptions: [],
  sources: [],
  oldestCheckedAt: "2026-11-03",
});

const profiles = [
  profile("anthropic", "Anthropic", [
    { modelId: "sonnet", displayName: "Claude Sonnet 5.5", simulated: true },
    { modelId: "haiku", displayName: "Claude Haiku 5.5", simulated: true },
  ]),
  profile("moonshot", "Moonshot AI", [
    {
      modelId: "kimi",
      displayName: "Kimi K3",
      simulated: false,
      reason: "Not simulated: caching behaviour isn't documented",
    },
  ]),
];

describe("VendorPicker", () => {
  it("renders a labelled select grouped by vendor in profile order", () => {
    render(
      <VendorPicker
        profiles={profiles}
        value="sonnet"
        onChange={() => undefined}
      />,
    );
    const select = screen.getByLabelText("Simulate on");
    expect(select.tagName).toBe("SELECT");
    const groups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => g.label,
    );
    expect(groups).toEqual(["Anthropic", "Moonshot AI"]);
    expect(select).toHaveValue("sonnet");
  });

  it("calls onChange with the picked model id", () => {
    const onChange = vi.fn();
    render(
      <VendorPicker profiles={profiles} value="sonnet" onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Simulate on"), {
      target: { value: "haiku" },
    });
    expect(onChange).toHaveBeenCalledWith("haiku");
  });

  it("disables a model that is not simulated and gives its reason", () => {
    render(
      <VendorPicker
        profiles={profiles}
        value="sonnet"
        onChange={() => undefined}
      />,
    );
    const option = screen.getByRole("option", { name: /Kimi K3/ });
    expect(option).toBeDisabled();
    expect(option).toHaveTextContent("Kimi K3 (not simulated)");
    expect(option).toHaveAttribute(
      "title",
      "Not simulated: caching behaviour isn't documented",
    );
    const describedBy = option.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      "Not simulated: caching behaviour isn't documented",
    );
  });

  it("can be disabled as a whole", () => {
    render(
      <VendorPicker
        profiles={profiles}
        value="sonnet"
        onChange={() => undefined}
        disabled
      />,
    );
    expect(screen.getByLabelText("Simulate on")).toBeDisabled();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <VendorPicker
        profiles={profiles}
        value="sonnet"
        onChange={() => undefined}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
