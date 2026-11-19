// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "../../api-client/mcp-setup.js";
import { LAST_CLIENT_STORAGE_KEY } from "../../lib/mcp-setup/last-client.js";
import { mcpSetupResponse } from "../../test-support/mcp-setup-fixture.js";
import { ConnectAgent } from "./ConnectAgent.js";

vi.mock("../../api-client/mcp-setup.js", () => ({ fetchMcpSetup: vi.fn() }));

const fetchSetup = vi.mocked(client.fetchMcpSetup);
const TABS = ["Claude Code", "Claude Desktop", "Cursor", "VS Code", "VS Code Insiders", "Codex CLI", "Gemini CLI"];

beforeEach(() => {
  fetchSetup.mockReset();
  fetchSetup.mockResolvedValue(mcpSetupResponse());
  window.localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

async function openDialog() {
  const user = userEvent.setup();
  render(<ConnectAgent />);
  await user.click(screen.getByRole("button", { name: "Connect an agent" }));
  const dialog = await screen.findByRole("dialog", { name: "Connect an agent" });
  return { user, dialog };
}

// Two buttons are named Close: the × in the corner and the footer's.
const footerClose = () => within(document.querySelector<HTMLElement>(".mcp-footer")!).getByRole("button", { name: "Close" });
const selectedTab = () => screen.getByRole("tab", { selected: true });

describe("the header button", () => {
  it("has an accessible name, a tooltip and the text, and opens a dialog", () => {
    render(<ConnectAgent />);

    const button = screen.getByRole("button", { name: "Connect an agent" });
    expect(button).toHaveAttribute("title", "Connect an agent");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveTextContent("Connect an agent");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the dialog", () => {
  it("shows the title, the approved intro and a vertical tablist of the seven clients", async () => {
    const { dialog } = await openDialog();

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText(/^Let your coding agent ask this app about its own costs\. This panel only shows commands\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/nothing here changes your files\.$/)).toBeInTheDocument();
    const list = screen.getByRole("tablist", { name: "Agent" });
    expect(list).toHaveAttribute("aria-orientation", "vertical");
    expect(within(list).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(TABS);
  });

  it("opens on Claude Code the first time, with focus on the selected tab", async () => {
    await openDialog();

    expect(selectedTab()).toHaveTextContent("Claude Code");
    expect(selectedTab()).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Claude Code" })).toBeInTheDocument();
  });

  it("uses one tab stop: only the selected tab is tabbable", async () => {
    await openDialog();

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("tabindex", tab === selectedTab() ? "0" : "-1");
    }
  });

  it("shows the recommended command, the by-hand command, the note and the footer", async () => {
    const { dialog } = await openDialog();

    expect(within(dialog).getByText("Recommended: one command")).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Install command for Claude Code" })).toHaveTextContent(
      "npx agent-cost-analyzer mcp install --client claude-code",
    );
    expect(within(dialog).getByText("Run it in a terminal. It shows what it will change and asks before writing.")).toBeInTheDocument();
    expect(within(dialog).getByText("Or set it up by hand")).toBeInTheDocument();
    expect(await within(dialog).findByRole("group", { name: "Setup command for Claude Code" })).toHaveTextContent(/^claude mcp add --scope user/);
    expect(within(dialog).getByText(/Adds the server for every project \(user scope\)/)).toBeInTheDocument();
    expect(within(dialog).getByText("Version 1.1.0 · runs the latest release through npx")).toBeInTheDocument();
    expect(footerClose()).toBeInTheDocument();
  });

  it("has no Pin this version switch", async () => {
    const { dialog } = await openDialog();

    expect(within(dialog).queryByText(/pin/i)).toBeNull();
    expect(within(dialog).queryByRole("switch")).toBeNull();
  });
});

describe("the tabs' keyboard behavior (automatic activation)", () => {
  it("moves and selects with Down and Up, wrapping at both ends", async () => {
    const { user } = await openDialog();

    await user.keyboard("{ArrowDown}");
    expect(selectedTab()).toHaveTextContent("Claude Desktop");
    expect(selectedTab()).toHaveFocus();
    expect(screen.getByRole("tabpanel", { name: "Claude Desktop" })).toBeInTheDocument();

    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(selectedTab()).toHaveTextContent("Gemini CLI");

    await user.keyboard("{ArrowDown}");
    expect(selectedTab()).toHaveTextContent("Claude Code");
  });

  it("jumps to the first and last tab with Home and End", async () => {
    const { user } = await openDialog();

    await user.keyboard("{End}");
    expect(selectedTab()).toHaveTextContent("Gemini CLI");
    await user.keyboard("{Home}");
    expect(selectedTab()).toHaveTextContent("Claude Code");
  });

  it("selects a tab by click", async () => {
    const { user } = await openDialog();

    await user.click(screen.getByRole("tab", { name: "Codex CLI" }));

    expect(selectedTab()).toHaveTextContent("Codex CLI");
    expect(await screen.findByText(/Codex has no remove command/)).toBeInTheDocument();
  });
});

describe("each client's notes and links", () => {
  async function tab(name: string) {
    const { user } = await openDialog();
    await user.click(screen.getByRole("tab", { name }));
  }

  it("Cursor: JSON with its path, the Add to Cursor link and its notes", async () => {
    await tab("Cursor");

    expect(await screen.findByText("~/.cursor/mcp.json")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Setup JSON for Cursor" })).toHaveTextContent('"mcpServers"');
    expect(screen.getByText("Or use the install link")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add to Cursor" })).toHaveAttribute(
      "href",
      "cursor://anysphere.cursor-deeplink/mcp/install?name=agent-cost-analyzer&config=e30%3D",
    );
    expect(screen.getByText("Opens a cursor:// link in the Cursor app.")).toBeInTheDocument();
    expect(screen.getByText("The install link opens Cursor and asks you to confirm.")).toBeInTheDocument();
  });

  it("only Cursor has an install link", async () => {
    await tab("Claude Desktop");

    await screen.findByText("~/.config/Claude/claude_desktop_config.json");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Merge the entry into the existing file, then restart Claude Desktop.")).toBeInTheDocument();
  });

  it("VS Code and Insiders: skip if the extension is installed", async () => {
    await tab("VS Code");
    expect(await screen.findByText(/Skip this if the AI Credits Analyzer extension is installed: it already provides the server\./)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("tab", { name: "VS Code Insiders" }));
    expect(await screen.findByText(/installed in Insiders/)).toBeInTheDocument();
  });

  it("Codex: no remove command; Gemini: user scope", async () => {
    await tab("Codex CLI");
    expect(await screen.findByText(/Codex has no remove command\. To remove the server, delete the \[mcp_servers\.agent-cost-analyzer\] table/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("tab", { name: "Gemini CLI" }));
    expect(await screen.findByText("Adds the server for every project (user scope).")).toBeInTheDocument();
  });
});

describe("the remembered tab", () => {
  it("stores the last tab viewed and opens on it next time", async () => {
    const { user } = await openDialog();
    await user.click(screen.getByRole("tab", { name: "Gemini CLI" }));
    expect(window.localStorage.getItem(LAST_CLIENT_STORAGE_KEY)).toBe("gemini");
    await user.click(footerClose());

    await user.click(screen.getByRole("button", { name: "Connect an agent" }));

    expect(selectedTab()).toHaveTextContent("Gemini CLI");
  });

  it("works when storage is blocked: Claude Code, no error, tabs still switch", async () => {
    const blocked = {
      get: () => {
        throw new Error("blocked");
      },
    };
    vi.spyOn(window, "localStorage", "get").mockImplementation(blocked.get);
    const { user } = await openDialog();

    expect(selectedTab()).toHaveTextContent("Claude Code");
    await user.click(screen.getByRole("tab", { name: "Cursor" }));
    expect(selectedTab()).toHaveTextContent("Cursor");
    vi.restoreAllMocks();
  });
});

describe("narrow screens", () => {
  it("replace the tabs with a select labeled Agent that changes the panel", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({ matches: query.includes("max-width"), addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const user = userEvent.setup();
    render(<ConnectAgent />);
    await user.click(screen.getByRole("button", { name: "Connect an agent" }));

    expect(screen.queryByRole("tablist")).toBeNull();
    const select = screen.getByRole("combobox", { name: "Agent" });
    expect(select).toHaveFocus();
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual(TABS);
    expect(select).toHaveValue("claude-code");

    await user.selectOptions(select, "cursor");

    expect(screen.getByRole("heading", { name: "Cursor" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Add to Cursor" })).toBeInTheDocument();
    expect(window.localStorage.getItem(LAST_CLIENT_STORAGE_KEY)).toBe("cursor");
  });
});

describe("loading and error states", () => {
  it("loading: the install command shows at once, the by-hand part says it is loading", async () => {
    fetchSetup.mockReturnValue(new Promise(() => undefined));
    const { dialog } = await openDialog();

    expect(within(dialog).getByRole("group", { name: "Install command for Claude Code" })).toBeInTheDocument();
    expect(within(dialog).getByText("Loading setup details…")).toBeInTheDocument();
    expect(within(dialog).getByText("Runs the latest release through npx")).toBeInTheDocument();
  });

  it("error: shows the board's message AND the install command for the selected client, and retries", async () => {
    fetchSetup.mockRejectedValueOnce(new Error("Request to /api/mcp/setup failed with status 500"));
    const { user, dialog } = await openDialog();
    await user.click(screen.getByRole("tab", { name: "Codex CLI" }));

    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Could not load the setup details. The command above does not need them.");
    expect(within(dialog).getByRole("group", { name: "Install command for Codex CLI" })).toHaveTextContent(
      "npx agent-cost-analyzer mcp install --client codex",
    );

    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await within(dialog).findByRole("group", { name: "Setup command for Codex CLI" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(fetchSetup).toHaveBeenCalledTimes(2);
  });
});

describe("copy", () => {
  it("writes the install command to the clipboard and announces Copied", async () => {
    const { user, dialog } = await openDialog();
    // user-event installs its own clipboard at setup; spy on that one.
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    await user.click(within(dialog).getByRole("button", { name: "Copy: install command" }));

    expect(writeText).toHaveBeenCalledWith("npx agent-cost-analyzer mcp install --client claude-code");
    expect(await within(dialog).findByRole("button", { name: "Copied: install command" })).toHaveFocus();
  });

  it("copies the by-hand JSON, and tells the person to press Ctrl+C when the clipboard fails", async () => {
    const { user, dialog } = await openDialog();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    await user.click(screen.getByRole("tab", { name: "Cursor" }));

    await user.click(await within(dialog).findByRole("button", { name: "Copy: setup JSON" }));

    expect(within(dialog).getAllByText("Press Ctrl+C to copy").length).toBeGreaterThan(0);
  });
});

describe("closing", () => {
  it("Escape closes the dialog and focus returns to the header button", async () => {
    const { user } = await openDialog();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect an agent" })).toHaveFocus();
  });

  it("Close closes it and focus returns", async () => {
    const { user } = await openDialog();

    await user.click(footerClose());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect an agent" })).toHaveFocus();
  });

  it("the × in the corner closes it, and focus returns", async () => {
    const { user, dialog } = await openDialog();
    const corner = dialog.querySelector<HTMLElement>(".mcp-x")!;
    expect(corner).toHaveAccessibleName("Close");

    await user.click(corner);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Connect an agent" })).toHaveFocus();
  });

  it("a click on the backdrop closes it", async () => {
    const { user } = await openDialog();

    await user.click(screen.getByTestId("connect-agent-backdrop"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("traps Tab inside: from Close it wraps to the selected tab, and back", async () => {
    const { user } = await openDialog();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copy: setup command" })).toBeInTheDocument());
    const close = footerClose();
    act(() => close.focus());

    await user.tab();
    expect(document.activeElement).toBe(document.querySelector(".mcp-x"));
    await user.tab();
    expect(selectedTab()).toHaveFocus();

    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });
});
