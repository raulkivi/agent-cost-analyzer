// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Blueprint } from "./Blueprint.js";

describe("Blueprint", () => {
  it("renders its children inside a blueprint-framed wrapper with four corner marks", () => {
    const { container } = render(<Blueprint>content</Blueprint>);

    expect(screen.getByText("content")).toBeInTheDocument();
    const wrapper = container.querySelector(".blueprint");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelectorAll("i.corner")).toHaveLength(4);
    expect(wrapper?.querySelector("i.corner.tl")).not.toBeNull();
    expect(wrapper?.querySelector("i.corner.tr")).not.toBeNull();
    expect(wrapper?.querySelector("i.corner.bl")).not.toBeNull();
    expect(wrapper?.querySelector("i.corner.br")).not.toBeNull();
  });

  it("merges an extra className onto the blueprint wrapper", () => {
    const { container } = render(<Blueprint className="extra">x</Blueprint>);

    const wrapper = container.querySelector(".blueprint");
    expect(wrapper).toHaveClass("blueprint", "extra");
  });

  it("passes through arbitrary props (e.g. onClick, role, tabIndex) to the wrapper", () => {
    const onClick = vi.fn();
    render(
      <Blueprint role="button" tabIndex={0} onClick={onClick}>
        card
      </Blueprint>,
    );

    const wrapper = screen.getByRole("button");
    wrapper.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
