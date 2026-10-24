import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_IDS, VIEW_IDS } from "./commands/command-ids.js";
import { WATCHED_SETTING_IDS } from "./config/config-change-watcher.js";
import { INTERNAL_COMMAND_IDS } from "./diagnostics/test-hooks.js";
import { MCP_ENABLED_SETTING_ID, MCP_PROVIDER_ID } from "./mcp/mcp-server-definitions.js";
import { SESSION_CONTEXT_VALUE, SETUP_WARNING_CONTEXT_VALUE } from "./vscode/vscode-sidebar-views.js";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface MenuEntry {
  command: string;
  when?: string;
  group?: string;
}

interface WalkthroughStep {
  id: string;
  title: string;
  description: string;
  media: { image?: string; altText?: string; markdown?: string };
  completionEvents?: string[];
}

interface Walkthrough {
  id: string;
  title: string;
  description: string;
  steps: WalkthroughStep[];
}

interface ConfigurationSection {
  title?: string;
  properties: Record<
    string,
    { type?: string; default?: unknown; scope?: string; markdownDescription?: string; order?: number; enum?: unknown[]; markdownEnumDescriptions?: string[] }
  >;
}

interface Manifest {
  displayName: string;
  capabilities?: {
    untrustedWorkspaces?: { supported: boolean | "limited"; description?: string; restrictedConfigurations?: string[] };
  };
  description: string;
  activationEvents?: string[];
  contributes: {
    commands: { command: string; title: string; category?: string; icon?: string }[];
    menus?: Record<string, MenuEntry[]>;
    keybindings?: { command: string }[];
    viewsContainers: { activitybar: { id: string; title: string; icon: string }[] };
    views: Record<string, { id: string; name: string }[]>;
    viewsWelcome?: { view: string; contents: string; when?: string }[];
    walkthroughs?: Walkthrough[];
    configuration?: ConfigurationSection | ConfigurationSection[];
    mcpServerDefinitionProviders?: { id: string; label: string }[];
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

  it("never contributes, or names anywhere, the internal test-hook commands (step 10.9)", () => {
    const manifestText = readFileSync(path.join(packageDir, "package.json"), "utf-8");

    for (const id of Object.values(INTERNAL_COMMAND_IDS)) {
      expect(contributedCommands.has(id), id).toBe(false);
    }
    expect(manifestText).not.toContain("aiCreditsAnalyzer.internal");
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

  it("contributes exactly the settings the code reads, held to the §3.5 rules", () => {
    const configurations = [contributes.configuration ?? []].flat();
    const properties = configurations.flatMap((section) => Object.entries(section.properties));

    // The MCP switch (step 10.8) is the only aiCreditsAnalyzer.* setting.
    expect(properties.map(([id]) => id)).toEqual([MCP_ENABLED_SETTING_ID]);
    for (const section of configurations) {
      expect(text(section.title)).toBe("AI Credits Analyzer");
    }
    for (const [id, property] of properties) {
      expect(id.startsWith("aiCreditsAnalyzer."), id).toBe(true);
      expect(property.markdownDescription, id).toMatch(/^%[A-Za-z0-9._-]+%$/);
      expect(property.order, id).toEqual(expect.any(Number));
      if (property.enum !== undefined) {
        expect(property.markdownEnumDescriptions?.length, id).toBe(property.enum.length);
      }
    }
  });

  it("runs in Restricted Mode but ignores an untrusted workspace's value for the MCP setting", () => {
    const untrusted = manifest.capabilities?.untrustedWorkspaces;

    expect(untrusted?.supported).toBe("limited");
    expect(untrusted?.restrictedConfigurations).toEqual([MCP_ENABLED_SETTING_ID]);
    expect(text(untrusted?.description)).toMatch(/MCP server/);
  });

  it("keeps the MCP server off by default, and says plainly what turning it on sends to the model", () => {
    const property = [contributes.configuration ?? []].flat().find((section) => section.properties[MCP_ENABLED_SETTING_ID])?.properties[
      MCP_ENABLED_SETTING_ID
    ];
    const description = text(property?.markdownDescription);

    expect(property).toMatchObject({ type: "boolean", default: false });
    // Default scope (the owner's choice, 2026-10-24): it's set like any
    // other setting, so no explicit scope is declared.
    expect(property?.scope).toBeUndefined();
    for (const words of ["read-only", "redacted", "Copilot Chat session data", "costs", "tool calls", "findings", "turn text"]) {
      expect(description, words).toContain(words);
    }
    expect(description).toMatch(/sent to whichever model the chat uses/);
  });

  it("contributes the MCP server definition provider the code registers, with a label", () => {
    expect(contributes.mcpServerDefinitionProviders?.map((provider) => provider.id)).toEqual([MCP_PROVIDER_ID]);
    expect(text(contributes.mcpServerDefinitionProviders?.[0]?.label)).toBe("AI Credits Analyzer");
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
    ...(contributes.mcpServerDefinitionProviders ?? []).map((provider) => ({ where: `${provider.id} label`, value: provider.label })),
    ...[contributes.configuration ?? []].flat().flatMap((section) => [
      { where: "configuration title", value: section.title },
      ...Object.entries(section.properties).map(([id, property]) => ({ where: `${id} description`, value: property.markdownDescription })),
    ]),
    ...(contributes.viewsWelcome ?? []).map((welcome) => ({ where: `${welcome.view} welcome`, value: welcome.contents })),
    ...(contributes.walkthroughs ?? []).flatMap((entry) => [
      { where: `${entry.id} title`, value: entry.title },
      { where: `${entry.id} description`, value: entry.description },
      ...entry.steps.flatMap((step) => [
        { where: `${step.id} title`, value: step.title },
        { where: `${step.id} description`, value: step.description },
        ...(step.media.image === undefined ? [] : [{ where: `${step.id} alt text`, value: step.media.altText }]),
      ]),
    ]),
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

const walkthrough = contributes.walkthroughs?.[0];
const steps = walkthrough?.steps ?? [];
const LOGGING_SETTING = WATCHED_SETTING_IDS[0];
const RETENTION_SETTING = WATCHED_SETTING_IDS[1];

// The `command:` links of a step's markdown, with their decoded JSON args.
function commandLinks(markdown: string): { command: string; args: unknown[] }[] {
  return [...markdown.matchAll(/\(command:([^)?\s]+)(?:\?([^)\s]*))?\)/g)].map((match) => ({
    command: match[1]!,
    args: match[2] === undefined ? [] : (JSON.parse(decodeURIComponent(match[2])) as unknown[]),
  }));
}

describe("Get Started walkthrough (vscode-extension.md §3.5 Onboarding, §3.6 board 3)", () => {
  it("contributes one walkthrough with the agreed id and title", () => {
    expect(contributes.walkthroughs).toHaveLength(1);
    expect(walkthrough?.id).toBe("aiCreditsAnalyzer.getStarted");
    expect(text(walkthrough?.title)).toBe("Get started with AI Credits Analyzer");
    expect(text(walkthrough?.description)).not.toBe("");
  });

  it("has the five steps of the mock-up, in order", () => {
    expect(steps.map((step) => text(step.title))).toEqual([
      "Enable Copilot Chat debug logging",
      "Keep at least 200 sessions",
      "Open your first session",
      "Learn how prompt caching saves AI Credits",
      "Ask Copilot about your costs (MCP, optional)",
    ]);
    expect(new Set(steps.map((step) => step.id)).size).toBe(5);
    for (const step of steps) {
      expect(step.id.startsWith("aiCreditsAnalyzer."), step.id).toBe(true);
      expect(text(step.description), step.id).not.toBe("");
    }
  });

  it("links, from its steps, only to contributed commands", () => {
    const links = steps.flatMap((step) => commandLinks(text(step.description)));

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(contributedCommands.has(link.command), link.command).toBe(true);
    }
  });

  it("links steps 1-4 to fixSetting with the logging and retention settings, to Open, and to Learn mode", () => {
    const links = (index: number) => commandLinks(text(steps[index]!.description));

    expect(links(0)).toEqual([{ command: COMMAND_IDS.fixSetting, args: [LOGGING_SETTING] }]);
    expect(links(1)).toEqual([{ command: COMMAND_IDS.fixSetting, args: [RETENTION_SETTING] }]);
    expect(links(2)).toEqual([{ command: COMMAND_IDS.open, args: [] }]);
    expect(links(3)).toEqual([{ command: COMMAND_IDS.openLearnMode, args: [] }]);
  });

  it("links the MCP step to fixSetting with the MCP setting, and says it's off until turned on", () => {
    const description = text(steps[4]!.description);

    expect(commandLinks(description)).toEqual([{ command: COMMAND_IDS.fixSetting, args: [MCP_ENABLED_SETTING_ID] }]);
    expect(description).not.toMatch(/later version/i);
    expect(description).toMatch(/off until you turn it on/i);
  });

  it("explains, in the MCP step's page, the setting and the data it sends to the model", () => {
    const page = readFileSync(path.join(packageDir, steps[4]!.media.markdown!), "utf-8");

    expect(page).not.toMatch(/later version/i);
    expect(page).toContain(MCP_ENABLED_SETTING_ID);
    for (const words of ["read-only", "redacted", "costs", "tool calls", "findings", "turn text", "whichever model"]) {
      expect(page, words).toContain(words);
    }
    // The page is shown as Markdown: no command links or remote content there.
    expect(page).not.toMatch(/command:|https?:\/\/|<script|<img/i);
  });

  it("completes steps from the settings and commands they are about", () => {
    expect(steps.map((step) => step.completionEvents)).toEqual([
      [`onSettingChanged:${LOGGING_SETTING}`],
      [`onSettingChanged:${RETENTION_SETTING}`],
      [`onCommand:${COMMAND_IDS.openSession}`, `onCommand:${COMMAND_IDS.open}`],
      [`onCommand:${COMMAND_IDS.openLearnMode}`],
      [`onSettingChanged:${MCP_ENABLED_SETTING_ID}`],
    ]);
  });

  it("names, in completionEvents, only contributed commands, the watched Copilot settings, contributed settings, or onStepSelected", () => {
    const contributedSettings = [contributes.configuration ?? []].flat().flatMap((section) => Object.keys(section.properties));
    const settings = [...WATCHED_SETTING_IDS, ...contributedSettings];
    const events = steps.flatMap((step) => step.completionEvents ?? []);

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const [kind = "", ...rest] = event.split(":");
      const target = rest.join(":");
      if (event === "onStepSelected") {
        continue;
      }
      if (kind === "onCommand") {
        expect(contributedCommands.has(target), event).toBe(true);
      } else if (kind === "onSettingChanged") {
        expect(settings.includes(target), event).toBe(true);
      } else {
        expect.fail(`unexpected completion event ${event}`);
      }
    }
  });

  it("gives every step media that exists outside media/ (the build regenerates media/)", () => {
    for (const step of steps) {
      const media = step.media.image ?? step.media.markdown;
      expect(media, step.id).toBeDefined();
      expect(media!.startsWith("resources/walkthrough/"), step.id).toBe(true);
      expect(existsSync(path.join(packageDir, media!)), media).toBe(true);
    }
  });

  it("gives each image an alt text and keeps the SVGs local: no external reference, no script", () => {
    const images = steps.filter((step) => step.media.image !== undefined);

    expect(images.length).toBeGreaterThan(0);
    for (const step of images) {
      expect(text(step.media.altText), step.id).not.toBe("");
      expect(step.media.image!.endsWith(".svg"), step.id).toBe(true);
      const svg = readFileSync(path.join(packageDir, step.media.image!), "utf-8");
      expect(svg, step.id).toMatch(/^<svg\b/);
      expect(svg, step.id).not.toMatch(/https?:\/\/(?!www\.w3\.org\/)|<script|<image|href=/i);
    }
  });

  it("points the Sessions welcome view at the walkthrough", () => {
    const links = (contributes.viewsWelcome ?? [])
      .filter((entry) => entry.view === VIEW_IDS.sessions)
      .flatMap((entry) => welcomeCommands(text(entry.contents)));

    expect(links).toContain(COMMAND_IDS.openWalkthrough);
  });

  it("offers the walkthrough as a command", () => {
    const command = contributes.commands.find((entry) => entry.command === COMMAND_IDS.openWalkthrough);

    expect(text(command?.title)).toBe("Open Get Started Walkthrough");
  });
});
