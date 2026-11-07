// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Source } from "@agent-cost-analyzer/domain";
import { axeViolations } from "../../test-support/axe.js";
import { SourcesFooter, STALE_AFTER_DAYS } from "./SourcesFooter.js";

const sources: Source[] = [
  {
    id: "a",
    title: "GitHub pricing table",
    url: "https://docs.github.com/pricing",
    checkedAt: "2026-11-03",
  },
  {
    id: "b",
    title: "Anthropic prompt caching",
    url: "https://docs.anthropic.com/caching",
    checkedAt: "2026-11-03",
  },
];
const WARNING =
  "Price and cache data is over 90 days old and may be out of date.";

describe("SourcesFooter", () => {
  it("lists each source as a link and the check date", () => {
    render(
      <SourcesFooter
        sources={sources}
        oldestCheckedAt="2026-11-03"
        now={new Date("2026-11-05")}
      />,
    );
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "GitHub pricing table" });
    expect(link).toHaveAttribute("href", "https://docs.github.com/pricing");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Checked 2026-11-03")).toBeInTheDocument();
  });

  it("shows no warning for data checked within 90 days", () => {
    render(
      <SourcesFooter
        sources={sources}
        oldestCheckedAt="2026-11-03"
        now={new Date("2027-01-31")}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns once the data is more than 90 days old", () => {
    render(
      <SourcesFooter
        sources={sources}
        oldestCheckedAt="2026-11-03"
        now={new Date("2027-02-03")}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(WARNING);
  });

  it("exports the 90-day threshold", () => {
    expect(STALE_AFTER_DAYS).toBe(90);
  });

  it("does not warn on an unparseable date, and still shows it", () => {
    render(
      <SourcesFooter
        sources={sources}
        oldestCheckedAt="unknown"
        now={new Date("2027-02-03")}
      />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Checked unknown")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <SourcesFooter
        sources={sources}
        oldestCheckedAt="2026-11-03"
        now={new Date("2027-02-03")}
      />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
