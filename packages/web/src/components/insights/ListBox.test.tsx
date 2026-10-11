import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FieldValue } from "../../lib/associative/data-model.js";
import { ListBox } from "./ListBox.js";

const values: FieldValue[] = [
  { value: "claude", label: "claude", state: "selected", count: 3 },
  { value: "gpt-5", label: "gpt-5", state: "alternative", count: 0 },
  { value: "o3", label: "o3", state: "excluded", count: 0 },
];

function renderListBox(overrides: Partial<Parameters<typeof ListBox>[0]> = {}) {
  const onSelect = vi.fn();
  const onClear = vi.fn();
  render(<ListBox label="Model" values={values} onSelect={onSelect} onClear={onClear} {...overrides} />);
  return { onSelect, onClear, list: screen.getByRole("listbox", { name: "Model" }) };
}

describe("ListBox", () => {
  it("shows every value with its associative state", () => {
    const { list } = renderListBox();
    const options = within(list).getAllByRole("option");
    expect(options.map((option) => option.getAttribute("data-state"))).toEqual(["selected", "alternative", "excluded"]);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    expect(options[0]).toHaveTextContent("claude");
    expect(options[0]).toHaveTextContent("3");
  });

  it("selects only the clicked value, or toggles it with Ctrl/⌘", () => {
    const { list, onSelect } = renderListBox();
    fireEvent.click(within(list).getByRole("option", { name: /gpt-5/ }));
    expect(onSelect).toHaveBeenLastCalledWith("gpt-5", false);
    fireEvent.click(within(list).getByRole("option", { name: /o3/ }), { ctrlKey: true });
    expect(onSelect).toHaveBeenLastCalledWith("o3", true);
    fireEvent.click(within(list).getByRole("option", { name: /o3/ }), { metaKey: true });
    expect(onSelect).toHaveBeenLastCalledWith("o3", true);
  });

  it("selects with the keyboard", () => {
    const { list, onSelect } = renderListBox();
    fireEvent.keyDown(within(list).getByRole("option", { name: /claude/ }), { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("claude", false);
  });

  it("offers a clear button only while the field has a selection", () => {
    const { onClear } = renderListBox();
    fireEvent.click(screen.getByRole("button", { name: "Clear Model selection" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("hides the clear button without a selection", () => {
    renderListBox({ values: values.map((value) => ({ ...value, state: "possible" as const })) });
    expect(screen.queryByRole("button", { name: "Clear Model selection" })).not.toBeInTheDocument();
  });

  it("filters long lists with a search box", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      value: `v${index}`,
      label: `value ${index}`,
      state: "possible" as const,
      count: 1,
    }));
    const { list } = renderListBox({ values: many });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search Model" }), { target: { value: "value 1" } });
    expect(within(list).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "value 11",
      "value 101",
      "value 111",
    ]);
  });

  it("says when the field has no values", () => {
    renderListBox({ values: [] });
    expect(screen.getByText("No values")).toBeInTheDocument();
  });
});
