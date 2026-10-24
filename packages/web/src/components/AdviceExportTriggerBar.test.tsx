import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdviceExportTriggerBar } from "./AdviceExportTriggerBar.js";

describe("AdviceExportTriggerBar", () => {
  it("renders nothing when no sessions are selected", () => {
    const { container } = render(<AdviceExportTriggerBar count={0} onExport={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the selected session count, pluralized, and an Export advice button", () => {
    const { rerender } = render(<AdviceExportTriggerBar count={1} onExport={vi.fn()} />);
    expect(screen.getByText("1 session selected for advice")).toBeInTheDocument();

    rerender(<AdviceExportTriggerBar count={2} onExport={vi.fn()} />);
    expect(screen.getByText("2 sessions selected for advice")).toBeInTheDocument();
  });

  it("calls onExport when the Export advice button is clicked", () => {
    const onExport = vi.fn();
    render(<AdviceExportTriggerBar count={1} onExport={onExport} />);

    fireEvent.click(screen.getByRole("button", { name: "Export advice" }));

    expect(onExport).toHaveBeenCalled();
  });
});
