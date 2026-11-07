// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Assumption } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../../test-support/axe.js";
import { AssumptionsPopover } from "./AssumptionsPopover.js";

const assumptions: Assumption[] = [
  {
    text: "Copilot places one breakpoint after the tools.",
    confidence: "unknown",
  },
  {
    text: "Anthropic's rules apply.",
    confidence: "inferred",
    sourceIds: ["s"],
  },
  { text: "Five minute TTL.", confidence: "documented", sourceIds: ["s"] },
];

describe("AssumptionsPopover", () => {
  it("renders nothing without assumptions", () => {
    const { container } = render(<AssumptionsPopover assumptions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a collapsed button with the assumption count", () => {
    render(<AssumptionsPopover assumptions={assumptions} />);
    const button = screen.getByRole("button", { name: /3 assumptions/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/one breakpoint/)).not.toBeInTheDocument();
  });

  it("uses the singular for one assumption", () => {
    render(<AssumptionsPopover assumptions={[assumptions[0]!]} />);
    expect(
      screen.getByRole("button", { name: /1 assumption$/ }),
    ).toBeInTheDocument();
  });

  it("opens an inline panel listing each assumption with its confidence", () => {
    render(<AssumptionsPopover assumptions={assumptions} />);
    const button = screen.getByRole("button", { name: /3 assumptions/ });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(
      button.getAttribute("aria-controls")!,
    )!;
    const items = panel.querySelectorAll("li");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(
      "Copilot places one breakpoint after the tools.",
    );
    expect(items[0]).toHaveTextContent("unknown");
    expect(items[2]).toHaveTextContent("documented");
  });

  it("closes on Escape and returns focus to the button", () => {
    render(<AssumptionsPopover assumptions={assumptions} />);
    const button = screen.getByRole("button", { name: /3 assumptions/ });
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
  });

  it("has no axe violations when open", async () => {
    const { container } = render(
      <AssumptionsPopover assumptions={assumptions} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /3 assumptions/ }));
    expect(await axeViolations(container)).toEqual([]);
  });
});
