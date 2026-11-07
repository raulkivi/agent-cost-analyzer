// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ProjectsFile, ProjectsState, RepositoryList } from "@agent-cost-analyzer/domain";
import { ProjectsEditor } from "./ProjectsEditor.js";

// Phase 15 step 15.11 (plan §7, §11.5; board 5): the Projects editor.
// Unassigned repositories first, each assigned with a select (keyboard only,
// never drag alone); inline validation with a summary; Save disabled while
// any problem remains; capture rules for mitmproxy captures.

const repositories: RepositoryList = {
  repositories: ["github.com/acme/web", "github.com/acme/api", "github.com/acme/infra"].map((key, index) => ({
    key,
    source: "git-remote" as const,
    sessionCount: 3 - index,
    turnCount: 5,
    aiCredits: { value: null, knownSessions: 0, sessions: 1 },
    providerIds: ["vscode"],
    projectIds: [],
    lastUsedAt: "2026-10-20T10:00:00.000Z",
  })),
  unattributed: [{ reason: "mitmproxy captures record no working folder.", sessionCount: 4, turnCount: 9, aiCredits: { value: null, knownSessions: 0, sessions: 4 }, providerIds: ["mitmproxy"] }],
  providers: [],
};

const state = (file: Partial<ProjectsFile> = {}): ProjectsState => ({
  status: "valid",
  file: { version: 1, projects: [], aliases: {}, captureRules: [], ...file },
  problems: [],
  location: "/home/dev/.config/agent-cost-analyzer/projects.json",
});

function renderEditor(initial: ProjectsState = state()) {
  const save = vi.fn(async (file: ProjectsFile) => ({ ...initial, status: "valid" as const, file }));
  const onBack = vi.fn();
  render(<ProjectsEditor loadProjects={vi.fn().mockResolvedValue(initial)} loadRepositories={vi.fn().mockResolvedValue(repositories)} save={save} onBack={onBack} />);
  return { save, onBack };
}

describe("ProjectsEditor (plan §11.5, board 5)", () => {
  it("lists repositories without a project first and says where the file is", async () => {
    renderEditor();
    const table = await screen.findByRole("table", { name: "Repositories without a project" });
    expect(within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual(["github.com/acme/web", "github.com/acme/api", "github.com/acme/infra"]);
    expect(screen.getByText(/projects\.json/)).toBeInTheDocument();
  });

  it("creates a project and assigns three repositories with each row's select, by keyboard alone (S1), then saves", async () => {
    const user = userEvent.setup();
    const { save } = renderEditor();
    await screen.findByRole("table", { name: "Repositories without a project" });
    await user.click(screen.getByRole("button", { name: "New project" }));
    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveFocus();
    await user.clear(name);
    await user.type(name, "Customer portal");
    for (const key of ["github.com/acme/web", "github.com/acme/api", "github.com/acme/infra"]) {
      const select = screen.getByRole("combobox", { name: `Assign ${key} to` });
      select.focus();
      await user.selectOptions(select, "Customer portal");
    }
    expect(screen.queryByRole("table", { name: "Repositories without a project" })).not.toBeInTheDocument();
    const project = screen.getByRole("region", { name: "Customer portal" });
    expect(within(project).getAllByRole("row").length).toBe(4);
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0].projects).toEqual([
      { id: "customer-portal", name: "Customer portal", members: [{ repository: "github.com/acme/web" }, { repository: "github.com/acme/api" }, { repository: "github.com/acme/infra" }] },
    ]);
    expect(await screen.findByText(/^Saved\./)).toHaveAttribute("role", "status");
  });

  it("shows an exact tie inline and in the summary, with Save disabled until a member is removed (S6)", async () => {
    const user = userEvent.setup();
    const member = { repository: "github.com/acme/infra", branches: ["portal/*"] };
    renderEditor(state({ projects: [{ id: "portal", name: "Customer portal", members: [member] }] }));
    const portal = await screen.findByRole("region", { name: "Customer portal" });
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getAllByRole("textbox", { name: "Name" })[1]!, "Tools");
    const tools = screen.getAllByRole("region").find((region) => region.getAttribute("aria-label")?.startsWith("New project") || region.getAttribute("aria-label")?.endsWith("Tools"))!;
    await user.selectOptions(within(tools).getByRole("combobox", { name: "Add member" }), "github.com/acme/api");
    await user.selectOptions(within(tools).getByRole("combobox", { name: "Add member" }), "github.com/acme/infra");
    await user.type(within(tools).getAllByRole("textbox", { name: "Branch patterns" })[1]!, "portal/*");
    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("1 problem to fix before saving");
    expect(summary).toHaveTextContent(/Exact tie/);
    const branches = within(tools).getAllByRole("textbox", { name: "Branch patterns" })[1]!;
    expect(branches).toHaveAttribute("aria-invalid", "true");
    expect(branches).toHaveAccessibleDescription(/Exact tie/);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(within(tools).getByRole("button", { name: "Remove github.com/acme/infra from this project" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(portal).toBeInTheDocument();
  });

  it("explains Unattributed sessions and adds a capture rule for them (S8)", async () => {
    const user = userEvent.setup();
    const { save } = renderEditor(state({ projects: [{ id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/web" }] }] }));
    expect(await screen.findByText(/4 sessions are Unattributed/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a capture rule" }));
    await user.type(screen.getByRole("textbox", { name: "Capture files (glob)" }), "captures/*.har");
    await user.selectOptions(screen.getByRole("combobox", { name: "Repository for these captures" }), "github.com/acme/web");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0].captureRules).toEqual([{ glob: "captures/*.har", repository: "github.com/acme/web" }]);
  });

  it("edits markup, fixed lines and the project's own currency (D13, D14)", async () => {
    const user = userEvent.setup();
    const { save } = renderEditor(state({ projects: [{ id: "portal", name: "Customer portal", members: [{ repository: "github.com/acme/web" }] }] }));
    const portal = await screen.findByRole("region", { name: "Customer portal" });
    await user.type(within(portal).getByRole("spinbutton", { name: "Markup on statements, %" }), "10");
    await user.click(within(portal).getByRole("button", { name: "Add fixed line" }));
    await user.type(within(portal).getByRole("textbox", { name: "Fixed line label" }), "Seats");
    await user.type(within(portal).getByRole("spinbutton", { name: "Fixed line amount" }), "39");
    await user.type(within(portal).getByRole("textbox", { name: "Own currency code" }), "EUR");
    await user.type(within(portal).getByRole("spinbutton", { name: "EUR per USD" }), "0.9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0].projects[0].rates).toEqual({ markupPercent: 10, fixedLines: [{ label: "Seats", amount: 39, currency: "USD" }], currency: { code: "EUR", perUsd: 0.9 } });
  });

  it("goes back to the Dashboard", async () => {
    const user = userEvent.setup();
    const { onBack } = renderEditor();
    await user.click(await screen.findByRole("button", { name: /Back to the Dashboard/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("names a local repository by its folder, not its path, and counts sessions in words", async () => {
    const local = { ...repositories.repositories[0]!, key: "local:/home/dev/scratch" };
    const save = vi.fn();
    render(
      <ProjectsEditor
        onBack={vi.fn()}
        loadProjects={vi.fn().mockResolvedValue(state())}
        loadRepositories={vi.fn().mockResolvedValue({ ...repositories, repositories: [local], unattributed: [{ ...repositories.unattributed[0]!, sessionCount: 1 }] })}
        save={save}
      />,
    );
    const table = await screen.findByRole("table", { name: "Repositories without a project" });
    expect(table).toHaveTextContent("scratch (local)");
    expect(table).not.toHaveTextContent("/home/dev");
    expect(screen.getByText(/1 session is Unattributed/)).toBeInTheDocument();
  });
});
