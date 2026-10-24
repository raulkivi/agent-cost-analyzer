import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemPromptInspector } from "./SystemPromptInspector.js";

const SAMPLE_TEXT =
  "Intro text.\n<securityRequirements>Follow OWASP.</securityRequirements>\n<skills><skill><name>graphify</name><description>Graph things.</description></skill></skills>";

function stubFetchText(text: string, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status, text: () => Promise.resolve(text) }),
  );
}

describe("SystemPromptInspector", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows a loading state, then the parsed menu and raw text once the fetch resolves", async () => {
    stubFetchText(SAMPLE_TEXT);

    render(<SystemPromptInspector sessionId="session-1" onClose={() => {}} />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    expect(await screen.findByRole("button", { name: /security requirements/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /graphify/i })).toBeInTheDocument();
    // The raw-text panel renders adjacent tag-markup/content as sibling text
    // nodes with no per-run element boundary, so assert via the colored
    // section's own container rather than RTL's own-text getByText.
    expect(screen.getByTestId("prompt-node-root.1").textContent).toContain("Follow OWASP.");
  });

  it("shows a breadcrumb with the session title and model tag alongside the back button", async () => {
    stubFetchText(SAMPLE_TEXT);

    render(
      <SystemPromptInspector
        sessionId="session-1"
        sessionTitle="Phase 4 build"
        model="claude-sonnet-5"
        onClose={() => {}}
      />,
    );
    await screen.findByRole("button", { name: /security requirements/i });

    expect(screen.getByRole("button", { name: /back to session/i })).toBeInTheDocument();
    expect(screen.getByText("Phase 4 build")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-5")).toBeInTheDocument();
  });

  it("defaults to the Pretty format and re-indents nested tags onto their own lines", async () => {
    stubFetchText(SAMPLE_TEXT);
    render(<SystemPromptInspector sessionId="session-1" onClose={() => {}} />);
    await screen.findByRole("button", { name: /security requirements/i });

    expect(screen.getByRole("radio", { name: "Pretty" })).toBeChecked();
    expect(screen.getByTestId("prompt-node-root.2").textContent).toContain("\n  <skill>");
  });

  it("switches to the Raw format, showing the literal captured text with no inserted indentation", async () => {
    stubFetchText(SAMPLE_TEXT);
    render(<SystemPromptInspector sessionId="session-1" onClose={() => {}} />);
    await screen.findByRole("button", { name: /security requirements/i });

    fireEvent.click(screen.getByRole("radio", { name: "Raw" }));

    expect(screen.getByRole("radio", { name: "Raw" })).toBeChecked();
    expect(screen.getByTestId("prompt-node-root.2").textContent).toBe(
      "<skills><skill><name>graphify</name><description>Graph things.</description></skill></skills>",
    );
  });

  it("shows a not-captured message when the session has no system-prompt artifact", async () => {
    stubFetchText("", false, 404);

    render(<SystemPromptInspector sessionId="session-1" onClose={() => {}} />);

    expect(await screen.findByText(/no system prompt/i)).toBeInTheDocument();
  });

  it("shows a pi-agent-specific message mentioning npm run configure, with no VS Code hint and no link, on fetch failure", async () => {
    stubFetchText("", false, 404);

    render(<SystemPromptInspector sessionId="session-1" providerId="pi-agent" onClose={() => {}} />);

    expect(await screen.findByText(/npm run configure/i)).toBeInTheDocument();
    expect(screen.queryByText(/agentDebugLog/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the captured prompt normally for a pi-agent session when the fetch succeeds", async () => {
    stubFetchText(SAMPLE_TEXT);

    render(<SystemPromptInspector sessionId="session-1" providerId="pi-agent" onClose={() => {}} />);

    expect(await screen.findByRole("button", { name: /security requirements/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /graphify/i })).toBeInTheDocument();
  });

  it("shows a placeholder in the description panel until a section is selected", async () => {
    stubFetchText(SAMPLE_TEXT);
    render(<SystemPromptInspector sessionId="session-1" onClose={() => {}} />);
    await screen.findByRole("button", { name: /security requirements/i });

    expect(screen.getByText(/select a section/i)).toBeInTheDocument();
  });

  it("selecting a menu entry scrolls to and highlights the matching text-panel section, and shows its description", async () => {
    stubFetchText(SAMPLE_TEXT);
    render(<SystemPromptInspector sessionId="session-1" onClose={() => {}} />);
    const menuItem = await screen.findByRole("button", { name: /security requirements/i });

    fireEvent.click(menuItem);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText(/owasp top 10/i)).toBeInTheDocument();
  });

  it("indents a depth-2 nav entry via a single padding shorthand, not a separate paddingLeft a later padding could clobber", async () => {
    stubFetchText(SAMPLE_TEXT);
    render(<SystemPromptInspector sessionId="session-1" onClose={() => {}} />);
    const depth2Item = await screen.findByRole("button", { name: /graphify/i });

    // depth 2 -> (2 - 1) * 14 + 8 = 22px, per the design spec's indent formula.
    // Asserted via the shorthand string (not .style.paddingLeft): a shorthand
    // containing var() never decomposes into readable longhands in any
    // engine, so a longhand-based assertion can't tell shorthand-last from
    // shorthand-first — checking the shorthand is the only way to pin the
    // fix (a single declaration, indent baked into its last value).
    expect(depth2Item.style.padding).toBe("4px var(--space-2) 4px 22px");
  });

  it("switches to the Icicle format, showing the composition chart wired to the same selection model", async () => {
    stubFetchText(SAMPLE_TEXT);
    render(<SystemPromptInspector sessionId="session-1" onClose={() => {}} />);
    await screen.findByRole("button", { name: /security requirements/i });

    fireEvent.click(screen.getByRole("radio", { name: "Icicle" }));

    expect(screen.getByRole("radio", { name: "Icicle" })).toBeChecked();
    const diagram = screen.getByRole("img", { name: /prompt composition icicle diagram/i });
    expect(diagram).toBeInTheDocument();

    fireEvent.click(within(diagram).getByText("Security Requirements"));

    expect(screen.getByRole("button", { name: /security requirements/i })).toBeInTheDocument();
    expect(screen.getByText(/owasp top 10/i)).toBeInTheDocument();
  });

  it("calls onClose when the close/back control is activated", async () => {
    stubFetchText(SAMPLE_TEXT);
    const onClose = vi.fn();
    render(<SystemPromptInspector sessionId="session-1" onClose={onClose} />);
    await screen.findByRole("button", { name: /security requirements/i });

    fireEvent.click(screen.getByRole("button", { name: /close|back/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
