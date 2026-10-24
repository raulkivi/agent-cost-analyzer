import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { readableTextOn } from "../lib/contrast.js";
import { assignIcicleColors } from "../lib/system-prompt-menu.js";
import { parseSystemPrompt } from "../lib/system-prompt-parser.js";
import { PromptCompositionIcicle } from "./PromptCompositionIcicle.js";

const SAMPLE_TEXT =
  "Intro text.\n<securityRequirements>Follow OWASP.</securityRequirements>\n" +
  "<skills><skill><name>graphify</name><description>Graph things.</description></skill></skills>";

function renderIcicle(text: string, overrides: Partial<Parameters<typeof PromptCompositionIcicle>[0]> = {}) {
  const { root, malformed } = parseSystemPrompt(text);
  const colors = assignIcicleColors(root);
  const onSelect = vi.fn();
  render(
    <PromptCompositionIcicle
      root={root}
      text={text}
      malformed={malformed}
      colors={colors}
      selectedId={null}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { root, onSelect };
}

describe("PromptCompositionIcicle", () => {
  it("renders one rect per top-level section plus the root row", () => {
    renderIcicle(SAMPLE_TEXT);

    expect(screen.getByTestId(/^icicle-node-root\.0$/)).toBeInTheDocument();
    expect(screen.getByTestId(/^icicle-node-root\.1$/)).toBeInTheDocument();
    expect(screen.getByTestId(/^icicle-node-root\.2$/)).toBeInTheDocument();
  });

  it("labels each section with the same label the nav menu would use", () => {
    renderIcicle(SAMPLE_TEXT);

    expect(screen.getByText("Security Requirements")).toBeInTheDocument();
  });

  it("shows a single-entry breadcrumb for the full prompt before any zoom", () => {
    renderIcicle(SAMPLE_TEXT);

    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumb).getByText("Full prompt")).toBeInTheDocument();
  });

  it("zooms in on click, revealing descendants beyond the menu's depth-3 cap", () => {
    const text = "<skills><skill><details><nested>deep content here</nested></details></skill></skills>";
    const { root } = renderIcicle(text);
    const skill = root.children[0].children[0];

    fireEvent.click(screen.getByTestId(`icicle-node-${skill.id}`));

    const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumb).getByText("Skill")).toBeInTheDocument();
    const details = skill.children[0];
    expect(screen.getByTestId(`icicle-node-${details.id}`)).toBeInTheDocument();
  });

  it("zooms back out when the focused (top) row is clicked again", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const skills = root.children[2];

    fireEvent.click(screen.getByTestId(`icicle-node-${skills.id}`));
    const breadcrumbAfterZoomIn = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumbAfterZoomIn).getByText("Skills")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`icicle-node-${skills.id}`));
    const breadcrumbAfterZoomOut = screen.getByRole("navigation", { name: /breadcrumb/i });
    expect(within(breadcrumbAfterZoomOut).queryByText("Skills")).not.toBeInTheDocument();
    expect(within(breadcrumbAfterZoomOut).getByText("Full prompt")).toBeInTheDocument();
  });

  it("calls onSelect with the clicked node when within the shared selection depth cap", () => {
    const { root, onSelect } = renderIcicle(SAMPLE_TEXT);
    const securityRequirements = root.children[1];

    fireEvent.click(screen.getByTestId(`icicle-node-${securityRequirements.id}`));

    expect(onSelect).toHaveBeenCalledWith(securityRequirements);
  });

  it("shows each rect's size in characters and share of the current view", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const securityRequirements = root.children[1];

    const group = screen.getByTestId(`icicle-node-${securityRequirements.id}`);

    expect(within(group).getByText(/^\d+ chars · \d+%$/)).toBeInTheDocument();
  });

  it("fills its row with flex-grow proportional to size, instead of a JS-measured pixel width", () => {
    const text = "<a>short</a><b>a much much longer piece of content here than the other one</b>";
    const { root } = renderIcicle(text);
    const [a, b] = root.children;

    const aItem = screen.getByTestId(`icicle-node-${a.id}`);
    const bItem = screen.getByTestId(`icicle-node-${b.id}`);

    const aGrow = Number(aItem.style.flexGrow);
    const bGrow = Number(bItem.style.flexGrow);

    expect(aGrow).toBeGreaterThan(0);
    expect(bGrow).toBeGreaterThan(aGrow);
  });

  it("makes each row a flex container filling 100% of the diagram's width", () => {
    renderIcicle(SAMPLE_TEXT);

    const diagram = screen.getByRole("group", { name: /prompt composition icicle diagram/i });
    const row = diagram.firstElementChild;

    expect(row).toHaveStyle({ display: "flex", width: "100%" });
  });

  it("keeps duplicate-name counters stable across re-renders with the same focus", () => {
    const text = "<foo>a</foo><foo>b</foo><foo>c</foo>";
    const { root, malformed } = parseSystemPrompt(text);
    const colors = assignIcicleColors(root);
    const props = { root, text, malformed, colors, selectedId: null, onSelect: () => {} };

    const { rerender } = render(<PromptCompositionIcicle {...props} />);
    rerender(<PromptCompositionIcicle {...props} />);
    rerender(<PromptCompositionIcicle {...props} />);

    expect(screen.getByText("Foo")).toBeInTheDocument();
    expect(screen.getByText("Foo (2)")).toBeInTheDocument();
    expect(screen.getByText("Foo (3)")).toBeInTheDocument();
  });

  it("relies on the shared .truncate CSS class instead of hard-cutting label text in JS", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const securityRequirements = root.children[1];
    const group = screen.getByTestId(`icicle-node-${securityRequirements.id}`);

    const label = within(group).getByText("Security Requirements");

    expect(label.className).toContain("truncate");
  });

  it("gives the main label bold weight and the stats line normal weight", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const securityRequirements = root.children[1];
    const group = screen.getByTestId(`icicle-node-${securityRequirements.id}`);

    const mainLabel = within(group).getByText("Security Requirements");
    const stats = within(group).getByText(/^\d+ chars · \d+%$/);

    expect(mainLabel).toHaveStyle({ fontWeight: "600" });
    expect(stats).toHaveStyle({ fontWeight: "400" });
  });

  // §3.5: a fixed theme text colour falls under 4.5:1 on the mid-tone hues
  // (and on every hue in a dark theme), so the label follows the fill.
  it("colours each cell's label and stats line for contrast with its own fill", () => {
    const { root } = renderIcicle(SAMPLE_TEXT);
    const colors = assignIcicleColors(root);

    for (const node of root.children) {
      const cell = screen.getByTestId(`icicle-node-${node.id}`);
      const expected = readableTextOn(colors.get(node.id)!);
      for (const line of Array.from(cell.children) as HTMLElement[]) {
        expect(line.style.color).toBe(expected === "#ffffff" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
        expect(line).not.toHaveClass("text-muted");
      }
    }
  });

  it("highlights the currently selected node with a distinct border", () => {
    const { root } = parseSystemPrompt(SAMPLE_TEXT);
    const colors = assignIcicleColors(root);
    const securityRequirements = root.children[1];

    render(
      <PromptCompositionIcicle
        root={root}
        text={SAMPLE_TEXT}
        malformed={false}
        colors={colors}
        selectedId={securityRequirements.id}
        onSelect={() => {}}
      />,
    );

    const item = screen.getByTestId(`icicle-node-${securityRequirements.id}`);
    // Inline style, not toHaveStyle: jsdom 30 resolves var() in computed
    // styles, and the test environment defines no theme variables.
    expect(item.style.borderWidth).toBe("2px");
    expect(item.style.borderColor).toBe("var(--color-text)");
  });

  it("offers the sections as a captioned table, with level, size and share", async () => {
    renderIcicle(SAMPLE_TEXT);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "View as table" }));

    const table = screen.getByRole("table", { name: "Prompt composition" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Section",
      "Level",
      "Characters",
      "Share of prompt",
    ]);
    const row = within(table).getByRole("rowheader", { name: "Security Requirements" }).closest("tr")!;
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["1", "58", "35%"]);
    expect(within(table).getByRole("rowheader", { name: "graphify" })).toBeInTheDocument();
    expect(screen.queryByTestId(/^icicle-node-/)).not.toBeInTheDocument();
  });

  describe("keyboard", () => {
    function cell(node: { id: string }) {
      return screen.getByTestId(`icicle-node-${node.id}`);
    }

    it("is a single tab stop: one cell is tabbable, the rest are reached by arrow keys", async () => {
      const { root } = renderIcicle(SAMPLE_TEXT);
      const user = userEvent.setup();
      const cells = screen.getAllByTestId(/^icicle-node-/);

      expect(cells.filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
      expect(cells.filter((c) => c.getAttribute("tabindex") === "-1")).toHaveLength(cells.length - 1);

      await user.tab(); // the View as table toggle
      await user.tab();
      expect(cell(root)).toHaveFocus();
      await user.tab();
      expect(cells).not.toContain(document.activeElement);
    });

    it("gives every cell the button role and a name with its size", () => {
      const { root } = renderIcicle(SAMPLE_TEXT);
      expect(within(screen.getByRole("group", { name: /icicle diagram/i })).getAllByRole("button")).toHaveLength(
        screen.getAllByTestId(/^icicle-node-/).length,
      );
      expect(cell(root.children[1])).toHaveAccessibleName(/^Security Requirements, \d+ chars/);
    });

    it("moves between cells of a level with the left and right arrows, and to its ends with Home and End", async () => {
      const { root } = renderIcicle(SAMPLE_TEXT);
      const [preamble, security, skills] = root.children;
      const user = userEvent.setup();
      cell(preamble).focus();

      await user.keyboard("{ArrowRight}");
      expect(cell(security)).toHaveFocus();
      await user.keyboard("{ArrowRight}{ArrowRight}");
      expect(cell(skills)).toHaveFocus(); // no wrap past the last
      await user.keyboard("{ArrowLeft}");
      expect(cell(security)).toHaveFocus();
      await user.keyboard("{End}");
      expect(cell(skills)).toHaveFocus();
      await user.keyboard("{Home}");
      expect(cell(preamble)).toHaveFocus();
      await user.keyboard("{ArrowLeft}");
      expect(cell(preamble)).toHaveFocus();
    });

    it("moves the tab stop with the focus", async () => {
      const { root } = renderIcicle(SAMPLE_TEXT);
      const user = userEvent.setup();
      cell(root.children[0]).focus();

      await user.keyboard("{ArrowRight}");

      expect(cell(root.children[1])).toHaveAttribute("tabindex", "0");
      expect(cell(root)).toHaveAttribute("tabindex", "-1");
    });

    it("moves down to a section's first child and up to its parent", async () => {
      const { root } = renderIcicle(SAMPLE_TEXT);
      const skills = root.children[2];
      const skill = skills.children[0];
      const user = userEvent.setup();
      cell(root).focus();

      await user.keyboard("{ArrowDown}");
      expect(cell(root.children[0])).toHaveFocus();
      cell(skills).focus();
      await user.keyboard("{ArrowDown}");
      expect(cell(skill)).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(cell(skills)).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(cell(root)).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(cell(root)).toHaveFocus();
    });

    it("stays put going down from a cell with nothing below it", async () => {
      const { root } = renderIcicle(SAMPLE_TEXT);
      const user = userEvent.setup();
      cell(root.children[1]).focus();

      await user.keyboard("{ArrowDown}");

      expect(cell(root.children[1])).toHaveFocus();
    });

    it.each([
      ["Enter", "{Enter}"],
      ["Space", " "],
    ])("%s selects the section like a click and zooms to it", async (_name, key) => {
      const { root, onSelect } = renderIcicle(SAMPLE_TEXT);
      const skills = root.children[2];
      const user = userEvent.setup();
      cell(skills).focus();

      await user.keyboard(key);

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(skills);
      const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
      expect(within(breadcrumb).getByText("Skills")).toBeInTheDocument();
      expect(cell(skills)).toHaveFocus(); // the cell moved to the focus row; keyboard focus follows it
    });

    it("zooms back out from the focused row with Enter, keeping the focus on the same section", async () => {
      const { root } = renderIcicle(SAMPLE_TEXT);
      const skills = root.children[2];
      const user = userEvent.setup();
      cell(skills).focus();

      await user.keyboard("{Enter}{Enter}");

      const breadcrumb = screen.getByRole("navigation", { name: /breadcrumb/i });
      expect(within(breadcrumb).queryByText("Skills")).not.toBeInTheDocument();
      expect(cell(skills)).toHaveFocus();
    });

    it("marks the selected section as pressed", () => {
      const { root } = parseSystemPrompt(SAMPLE_TEXT);
      render(
        <PromptCompositionIcicle
          root={root}
          text={SAMPLE_TEXT}
          malformed={false}
          colors={assignIcicleColors(root)}
          selectedId={root.children[1].id}
          onSelect={() => {}}
        />,
      );
      expect(cell(root.children[1])).toHaveAttribute("aria-pressed", "true");
      expect(cell(root.children[2])).toHaveAttribute("aria-pressed", "false");
    });
  });
});
