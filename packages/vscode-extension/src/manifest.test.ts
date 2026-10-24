import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_IDS, VIEW_IDS } from "./commands/command-ids.js";
import { SESSION_CONTEXT_VALUE, SETUP_WARNING_CONTEXT_VALUE } from "./vscode/vscode-sidebar-views.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
}

interface Manifest {
  displayName: string;
  description: string;
  activationEvents?: string[];
  contributes: {
    commands: { command: string; title: string; category?: string; icon?: string }[];
    menus?: Record<string, MenuEntry[]>;
    keybindings?: { command: string }[];
    viewsContainers: { activitybar: { id: string; title: string; icon: string }[] };
    views: Record<string, { id: string; name: string }[]>;
    viewsWelcome?: { view: string; contents: string; when?: string }[];
  };
}

const nls = JSON.parse(readFileSync(path.join(packageDir, "package.nls.json"), "utf-8")) as Record<string, string>;
const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf-8")) as Manifest;
const { contributes } = manifest;
const contributedCommands = new Set(contributes.commands.map((command) => command.command));
const contributedViews = Object.values(contributes.views).flat();

// A manifest string as the user reads it: a `%key%` placeholder resolved
// through package.nls.json, any other string as it is.
function text(value: string | undefined): string {
  const key = /^%([A-Za-z0-9._-]+)%$/.exec(value ?? "")?.[1];
  return key === undefined ? (value ?? "") : (nls[key] ?? "");
}

// Every `command:` link in a welcome view's markdown.
function welcomeCommands(contents: string): string[] {
  return [...contents.matchAll(/\(command:([^)?\s]+)/g)].map((match) => match[1]!);
}

describe("package.json contributions (vscode-extension.md §3.5)", () => {
  it("puts every command under the category 'AI Credits Analyzer' with a codicon", () => {
    for (const command of contributes.commands) {
      expect(text(command.category), command.command).toBe("AI Credits Analyzer");
      expect(command.icon, command.command).toMatch(/^\$\([a-z0-9-]+\)$/);
      expect(text(command.title), command.command).not.toBe("");
    }
  });

  it("contributes exactly the commands the code registers", () => {
    expect([...contributedCommands].sort()).toEqual(Object.values(COMMAND_IDS).sort());
  });

  it("contributes every command that menus, welcome views and keybindings reference", () => {
    const referenced = [
      ...Object.values(contributes.menus ?? {}).flatMap((entries) => entries.map((entry) => entry.command)),
      ...(contributes.viewsWelcome ?? []).flatMap((welcome) => welcomeCommands(text(welcome.contents))),
      ...(contributes.keybindings ?? []).map((binding) => binding.command),
    ];

    expect(referenced.length).toBeGreaterThan(0);
    for (const command of referenced) {
      expect(contributedCommands.has(command), command).toBe(true);
    }
  });

  it("puts every view in a contributed Activity Bar container", () => {
    const containers = new Set(contributes.viewsContainers.activitybar.map((container) => container.id));

    expect(Object.keys(contributes.views).length).toBeGreaterThan(0);
    for (const containerId of Object.keys(contributes.views)) {
      expect(containers.has(containerId), containerId).toBe(true);
    }
  });

  it("contributes exactly the Sessions and Setup views the code registers", () => {
    expect(contributedViews.map((view) => view.id).sort()).toEqual(Object.values(VIEW_IDS).sort());
  });

  it("gives the container a monochrome SVG icon outside media/ (the build regenerates media/)", () => {
    const [container] = contributes.viewsContainers.activitybar;
    const icon = container!.icon;

    expect(icon.startsWith("media/")).toBe(false);
    expect(icon.endsWith(".svg")).toBe(true);
    const file = path.join(packageDir, icon);
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, "utf-8");
    expect(svg).toContain("currentColor");
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(/);
  });

  it("gives each view a welcome view, which only ever points at contributed views", () => {
    const welcomeViews = (contributes.viewsWelcome ?? []).map((welcome) => welcome.view);

    expect([...new Set(welcomeViews)].sort()).toEqual(Object.values(VIEW_IDS).sort());
  });

  it("scopes view menus to contributed views and item menus to the tree items' context values", () => {
    const viewIds = new Set(contributedViews.map((view) => view.id));
    const title = contributes.menus?.["view/title"] ?? [];
    const item = contributes.menus?.["view/item/context"] ?? [];

    for (const entry of title) {
      expect(viewIds.has(/view == (\S+)/.exec(entry.when ?? "")?.[1] ?? ""), entry.command).toBe(true);
    }
    for (const entry of item) {
      const contextValue = /viewItem == (\S+)/.exec(entry.when ?? "")?.[1];
      expect([SESSION_CONTEXT_VALUE, SETUP_WARNING_CONTEXT_VALUE], entry.command).toContain(contextValue);
    }
  });

  it("offers Refresh and Open analyzer in the view titles, and Open, Show tool audit and Copy advice bundle on a session", () => {
    const title = contributes.menus?.["view/title"] ?? [];
    const sessionItem = (contributes.menus?.["view/item/context"] ?? []).filter((entry) => entry.when?.includes(SESSION_CONTEXT_VALUE));

    expect(title.map((entry) => entry.command)).toEqual(expect.arrayContaining([COMMAND_IDS.refreshSessions, COMMAND_IDS.open]));
    expect(sessionItem.map((entry) => entry.command).sort()).toEqual(
      [COMMAND_IDS.openSession, COMMAND_IDS.showToolAudit, COMMAND_IDS.copyAdviceBundle].sort(),
    );
  });

  it("puts the Fix action inline on a Setup warning", () => {
    const fixes = (contributes.menus?.["view/item/context"] ?? []).filter((entry) => entry.command === COMMAND_IDS.fixSetting);
    const when = `view == ${VIEW_IDS.setup} && viewItem == ${SETUP_WARNING_CONTEXT_VALUE}`;

    expect(fixes).toContainEqual({ command: COMMAND_IDS.fixSetting, when, group: "inline" });
    // The same action in the context menu, which a keyboard reaches (Shift+F10).
    expect(fixes.some((entry) => entry.group !== "inline")).toBe(true);
  });

  it("hides the commands that need an argument from the Command Palette", () => {
    const hidden = (contributes.menus?.commandPalette ?? []).filter((entry) => entry.when === "false").map((entry) => entry.command);

    expect(hidden.sort()).toEqual(
      [COMMAND_IDS.openSession, COMMAND_IDS.showToolAudit, COMMAND_IDS.copyAdviceBundle, COMMAND_IDS.fixSetting].sort(),
    );
  });

  it("links the Setup welcome to fixSetting and the Sessions welcome to Learn mode", () => {
    const welcome = (view: string) =>
      (contributes.viewsWelcome ?? []).filter((entry) => entry.view === view).flatMap((entry) => welcomeCommands(text(entry.contents)));

    expect(welcome(VIEW_IDS.setup)).toContain(COMMAND_IDS.fixSetting);
    expect(welcome(VIEW_IDS.sessions)).toContain(COMMAND_IDS.openLearnMode);
  });

  it("activates when VS Code has started, so the status bar shows today's AI Credits", () => {
    expect(manifest.activationEvents).toEqual(["onStartupFinished"]);
  });
});

// Every `%key%` placeholder anywhere in the manifest, however deep.
function placeholders(value: unknown): string[] {
  if (typeof value === "string") {
    return /^%[A-Za-z0-9._-]+%$/.test(value) ? [value.slice(1, -1)] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(placeholders);
  }
  return typeof value === "object" && value !== null ? Object.values(value).flatMap(placeholders) : [];
}

// The manifest's user-visible strings (the fields VS Code shows in the UI),
// which must all be placeholders (vscode-extension.md §3.5 Localization).
// Identifiers, command ids, `when` clauses and the Marketplace keywords and
// categories are not translated.
function userVisibleStrings(): { where: string; value: unknown }[] {
  return [
    { where: "displayName", value: manifest.displayName },
    { where: "description", value: manifest.description },
    ...contributes.commands.flatMap((command) => [
      { where: `${command.command} title`, value: command.title },
      { where: `${command.command} category`, value: command.category },
    ]),
    ...contributes.viewsContainers.activitybar.map((container) => ({ where: `${container.id} container title`, value: container.title })),
    ...contributedViews.map((view) => ({ where: `${view.id} name`, value: view.name })),
    ...(contributes.viewsWelcome ?? []).map((welcome) => ({ where: `${welcome.view} welcome`, value: welcome.contents })),
  ];
}

describe("package.nls.json (vscode-extension.md §3.5 Localization)", () => {
  it("leaves no user-visible string in package.json as a literal", () => {
    for (const { where, value } of userVisibleStrings()) {
      expect(placeholders(value), where).toHaveLength(1);
    }
  });

  it("defines every key the manifest uses", () => {
    const used = placeholders(manifest);

    expect(used.length).toBeGreaterThan(0);
    for (const key of used) {
      expect(nls[key], key).toEqual(expect.any(String));
      expect(nls[key], key).not.toBe("");
    }
  });

  it("uses every key it defines", () => {
    const used = new Set(placeholders(manifest));

    expect(Object.keys(nls).filter((key) => !used.has(key))).toEqual([]);
  });

  it("keeps the command links in the welcome texts intact", () => {
    for (const welcome of contributes.viewsWelcome ?? []) {
      const key = placeholders(welcome.contents)[0]!;
      expect(welcomeCommands(nls[key] ?? "").length, key).toBeGreaterThan(0);
    }
  });
});
