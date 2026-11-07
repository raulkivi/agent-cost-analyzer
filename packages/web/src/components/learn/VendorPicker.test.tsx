// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
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

  it("keeps Learn's label and ids when none are given", () => {
    render(<VendorPicker profiles={profiles} value="sonnet" onChange={() => undefined} />);
    expect(screen.getByLabelText("Simulate on")).toHaveAttribute("id", "vendor-picker-select");
    expect(screen.getByRole("option", { name: /Kimi K3/ })).toHaveAttribute("aria-describedby", "vendor-picker-reason-kimi");
  });

  // Step 14.7: the same picker as Replay on and as Compare models' Add model.
  describe("as another picker (step 14.7)", () => {
    it("takes its own label and id, and derives the reason ids from that id", () => {
      render(<VendorPicker profiles={profiles} value="sonnet" onChange={() => undefined} label="Add model" id="add-model" />);
      const select = screen.getByLabelText("Add model");
      expect(select).toHaveAttribute("id", "add-model");
      expect(screen.queryByLabelText("Simulate on")).toBeNull();
      const describedBy = screen.getByRole("option", { name: /Kimi K3/ }).getAttribute("aria-describedby");
      expect(describedBy).toBe("add-model-reason-kimi");
      expect(document.getElementById(describedBy!)).toHaveTextContent("Not simulated: caching behaviour isn't documented");
    });

    it("starts with a placeholder choice whose value is empty, and reports picking it", () => {
      const onChange = vi.fn();
      render(<VendorPicker profiles={profiles} value="" onChange={onChange} placeholder="Choose…" />);
      const select = screen.getByLabelText("Simulate on");
      expect(select).toHaveValue("");
      expect(select.querySelector("option")).toHaveTextContent("Choose…");
      fireEvent.change(select, { target: { value: "haiku" } });
      expect(onChange).toHaveBeenLastCalledWith("haiku");
    });

    it("leaves out excluded models, and a vendor with none left", () => {
      render(<VendorPicker profiles={profiles} value="" placeholder="Choose…" onChange={() => undefined} excludeModelIds={["sonnet", "kimi"]} />);
      const select = screen.getByLabelText("Simulate on");
      expect(screen.queryByRole("option", { name: "Claude Sonnet 5.5" })).toBeNull();
      expect(screen.getByRole("option", { name: "Claude Haiku 5.5" })).toBeInTheDocument();
      expect(Array.from(select.querySelectorAll("optgroup")).map((g) => g.label)).toEqual(["Anthropic"]);
      expect(screen.queryByText("Not simulated: caching behaviour isn't documented")).toBeNull();
    });

    it("marks one model with a note, and describes the select by a given element", () => {
      render(
        <>
          <span id="why">At most 10 models</span>
          <VendorPicker profiles={profiles} value="sonnet" onChange={() => undefined} markedModel={{ modelId: "sonnet", note: "this session" }} describedBy="why" />
        </>,
      );
      expect(screen.getByRole("option", { name: "Claude Sonnet 5.5 (this session)" })).toBeInTheDocument();
      expect(screen.getByLabelText("Simulate on")).toHaveAccessibleDescription("At most 10 models");
    });

    it("adds a class name to its wrapper", () => {
      const { container } = render(<VendorPicker profiles={profiles} value="sonnet" onChange={() => undefined} className="replay-on-picker" />);
      expect(container.firstElementChild).toHaveClass("vendor-picker", "view-select", "replay-on-picker");
    });
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
