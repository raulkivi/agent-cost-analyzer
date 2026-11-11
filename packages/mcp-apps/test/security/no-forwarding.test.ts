// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// A14 (docs/plans/mcp-apps.md §6, §7): the no-forwarding rule as a static
// check over every source file in src/, so a new call site can't dodge it
// by not being exercised in a component test. Each view's own security test
// is the dynamic half: it clicks every control and inspects what reached
// the port.
//
// The rule: logged text (prompts, responses, titles, finding detail and
// evidence) never leaves the view towards the host's model.
//   - sendMessage is only called with a fixed template that names ids.
//   - openLink is unused (A12 was dropped: both hosts refuse vscode://).
//   - updateModelContext is unused.
//   - callTool names a reviewed tool, and its arguments carry ids and filters,
//     never a logged-text field.
// Only the ext-apps adapter (src/host/ext-apps-port.ts) talks to the host,
// and it forwards its own parameters untouched.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, "../../src");
const ADAPTER = "host/ext-apps-port.ts";
// Test doubles and test helpers live in src/ but never ship.
const NOT_SHIPPED = [/\.test\.tsx?$/, /^test-support\//, /^host\/fake-app-host-port\.ts$/];

const HOST_METHODS = new Set(["sendMessage", "openLink", "updateModelContext", "callTool", "callServerTool"]);
// Fields that hold logged text in the domain types and view models.
// U9-U11 (A23) add display text that is logged or model-chosen: row, series
// and vendor labels, project names, unknown and not-explained reasons,
// provider errors and a tool's error text.
const LOGGED_TEXT = new Set(["title", "sessionTitle", "userMessage", "assistantMessage", "excerpt", "prompt", "response", "detail", "why", "evidence", "text", "content", "message", "summary", "heading", "label", "name", "reason", "reasons", "error", "errorText", "answer", "displayOnly"]);
// The tools a view may call, and the argument names it may send them.
// U10 (A21) opens a row in U9 with the row's own ids and the comparison's
// period, basis, pricing and currency: all taken from structuredContent.
// U13 (A28) is opened from U11 with get_price_changes and U11's period.
// U12 (A27) opens a model of a comparison in replay mode with replay_session,
// the result's session id, provider and the model id it lists.
const TOOLS = new Set(["get_turn_series", "get_turn", "get_session_cost", "list_findings", "get_repository_cost", "get_project_cost", "get_price_changes", "replay_session"]);
const ARGUMENT_NAMES = new Set(["sessionId", "provider", "turnIndex", "kind", "minSeverity", "repository", "projectId", "since", "until", "basis", "pricing", "currency", "model"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}

interface Source {
  file: string; // relative to src/
  sf: ts.SourceFile;
}

const SOURCES: Source[] = walk(SRC)
  .filter((file) => /\.tsx?$/.test(file))
  .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
  .filter((file) => !NOT_SHIPPED.some((pattern) => pattern.test(file)))
  .map((file) => ({ file, sf: ts.createSourceFile(file, readFileSync(path.join(SRC, file), "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) }));

function descendants(node: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (child: ts.Node) => {
    out.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return out;
}

const at = (source: Source, node: ts.Node) => `${source.file}:${source.sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

// The name a call is made through: port.sendMessage(...) and port["sendMessage"](...).
function calleeName(call: ts.CallExpression): string | undefined {
  const callee = call.expression;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) return callee.argumentExpression.text;
  if (ts.isIdentifier(callee)) return callee.text;
  return undefined;
}

interface Use {
  source: Source;
  node: ts.Node;
  name: string;
  kind: "declaration" | "call" | "other";
}

// Every mention of a host method by name, sorted into a declaration (the
// port interface, the adapter's methods and the AppLike shape), a call, or
// anything else (an alias, a destructuring, a reference), which the rule
// does not allow because it would hide a call site from this test.
function hostMethodUses(): Use[] {
  const uses: Use[] = [];
  for (const source of SOURCES) {
    for (const node of descendants(source.sf)) {
      let name: string | undefined;
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) name = node.text;
      else if (ts.isStringLiteralLike(node) && !ts.isImportDeclaration(node.parent)) name = node.text;
      if (name === undefined || !HOST_METHODS.has(name)) continue;
      const parent = node.parent;
      if ((ts.isMethodSignature(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent)) && parent.name === node) {
        uses.push({ source, node, name, kind: "declaration" });
        continue;
      }
      const call = ts.isPropertyAccessExpression(parent) && parent.name === node ? parent.parent : ts.isElementAccessExpression(parent) && parent.argumentExpression === node ? parent.parent : undefined;
      if (call !== undefined && ts.isCallExpression(call) && call.expression === parent) uses.push({ source, node: call, name, kind: "call" });
      else uses.push({ source, node, name, kind: "other" });
    }
  }
  return uses;
}

function findFunction(name: string): { source: Source; fn: ts.FunctionDeclaration } | undefined {
  for (const source of SOURCES) {
    for (const node of descendants(source.sf)) if (ts.isFunctionDeclaration(node) && node.name?.text === name) return { source, fn: node };
  }
  return undefined;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  for (let current = node.parent; current; current = current.parent) if (ts.isFunctionLike(current) && "body" in current) return current as ts.FunctionLikeDeclaration;
  return undefined;
}

// A fixed template: a function whose every return is a string literal or a
// template literal whose only placeholders are string parameters named *Id.
function fixedTemplateProblems(name: string): string[] {
  const found = findFunction(name);
  if (!found) return [`${name}: not a function declared in src/`];
  const { fn } = found;
  const params = new Map(fn.parameters.map((param) => [param.name.getText(), param.type?.getText()]));
  const returns = descendants(fn).filter(ts.isReturnStatement);
  if (returns.length === 0) return [`${name}: returns nothing`];
  const problems: string[] = [];
  for (const statement of returns) {
    const value = statement.expression;
    if (value !== undefined && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))) continue;
    if (value === undefined || !ts.isTemplateExpression(value)) {
      problems.push(`${name}: returns ${value?.getText() ?? "undefined"}, not a template`);
      continue;
    }
    for (const span of value.templateSpans) {
      const part = span.expression;
      if (!ts.isIdentifier(part) || !/Id$/.test(part.text) || params.get(part.text) !== "string") problems.push(`${name}: placeholder \${${part.getText()}} is not a string *Id parameter`);
    }
  }
  return problems;
}

// What a tool-call argument expression may contain: object literals (with
// spreads and conditionals) whose keys are reviewed argument names, ids and
// filters as values, or a call to a reviewed builder in src/.
function argumentProblems(wrapped: ts.Expression, where: string): string[] {
  let expression = wrapped;
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) expression = expression.expression;
  const problems: string[] = [];
  for (const node of [expression, ...descendants(expression)]) {
    if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
      const key = node.name.getText();
      if (!ARGUMENT_NAMES.has(key)) problems.push(`${where}: argument "${key}" is not a reviewed argument name`);
    }
    if (ts.isPropertyAccessExpression(node) && LOGGED_TEXT.has(node.name.text)) problems.push(`${where}: reads .${node.name.text}, a logged-text field`);
    if (ts.isIdentifier(node) && LOGGED_TEXT.has(node.text) && !ts.isPropertyAccessExpression(node.parent)) problems.push(`${where}: passes ${node.text}, a logged-text name`);
  }
  if (ts.isCallExpression(expression)) {
    const builder = calleeName(expression);
    const found = builder === undefined ? undefined : findFunction(builder);
    if (!found) problems.push(`${where}: arguments come from ${expression.expression.getText()}, which is not a function in src/`);
    else for (const statement of descendants(found.fn).filter(ts.isReturnStatement)) if (statement.expression) problems.push(...argumentProblems(statement.expression, `${where} via ${builder}`));
  } else if (!ts.isObjectLiteralExpression(expression)) {
    problems.push(`${where}: arguments are ${expression.getText()}, not an object literal or a reviewed builder`);
  }
  return problems;
}

// The argument names a call's arguments use, through reviewed builders.
function argumentNames(wrapped: ts.Expression): string[] {
  let expression = wrapped;
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) expression = expression.expression;
  const names = [expression, ...descendants(expression)].filter((node) => ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)).map((node) => (node as ts.ObjectLiteralElementLike).name!.getText());
  if (ts.isCallExpression(expression)) {
    const builder = calleeName(expression);
    const found = builder === undefined ? undefined : findFunction(builder);
    if (found) for (const statement of descendants(found.fn).filter(ts.isReturnStatement)) if (statement.expression) names.push(...argumentNames(statement.expression));
  }
  return names;
}

// callTool sites, seen through forwarders: a function that passes its own
// parameters straight to callTool (callParsed) is a call site wherever it
// is called, with the tool name and arguments at those parameters' places.
interface ToolCall {
  where: string;
  tool: ts.Expression | undefined;
  args: ts.Expression | undefined;
}

function toolCalls(): ToolCall[] {
  const direct = hostMethodUses().filter((use) => use.kind === "call" && use.name === "callTool" && use.source.file !== ADAPTER);
  const calls: ToolCall[] = [];
  for (const use of direct) {
    const call = use.node as ts.CallExpression;
    const [tool, args] = call.arguments;
    const fn = enclosingFunction(call);
    const paramIndex = (arg: ts.Expression | undefined) => (arg && ts.isIdentifier(arg) && fn ? fn.parameters.findIndex((param) => param.name.getText() === arg.text) : -1);
    const toolParam = paramIndex(tool);
    const argsParam = paramIndex(args);
    if (toolParam >= 0 && argsParam >= 0 && fn && ts.isFunctionDeclaration(fn) && fn.name) {
      const forwarder = fn.name.text;
      for (const source of SOURCES) {
        for (const node of descendants(source.sf)) {
          if (ts.isCallExpression(node) && calleeName(node) === forwarder && ts.isIdentifier(node.expression)) calls.push({ where: at(source, node), tool: node.arguments[toolParam], args: node.arguments[argsParam] });
        }
      }
    } else {
      calls.push({ where: at(use.source, call), tool, args });
    }
  }
  return calls;
}

describe("no-forwarding rule (static, over every call site in src/)", () => {
  const uses = hostMethodUses();
  const outsideAdapter = uses.filter((use) => use.source.file !== ADAPTER);

  it("scans the shipped sources, including the views and the adapter", () => {
    const files = SOURCES.map((source) => source.file);
    expect(files).toEqual(
      expect.arrayContaining([
        ADAPTER,
        "views/SessionCostView.tsx",
        "views/cost-rollup/AskAboutSession.tsx",
        "views/findings/use-findings-query.ts",
        "views/CostOverTimeView.tsx",
        "views/CostCompareView.tsx",
        "views/cost-compare/CompareDrillDown.tsx",
        "views/CostChangeView.tsx",
        "views/PriceChangesView.tsx",
        "views/price-changes/PriceDrillDown.tsx",
        "views/StatementView.tsx",
        "views/EstimateView.tsx",
        "views/AuditView.tsx",
        "views/SessionPickerView.tsx",
        "views/ReplayView.tsx",
        "views/replay/ReplayDrillDown.tsx",
      ]),
    );
    expect(files.some((file) => file.endsWith(".test.tsx"))).toBe(false);
  });

  // A29: the billing views are read-only displays; no control can issue, export or ask anything.
  it("makes U14 and U15 call no host method at all", () => {
    const billing = uses.filter((use) => /^views\/(StatementView\.tsx|EstimateView\.tsx|statement\/|estimate\/)/.test(use.source.file));
    expect(billing.map((use) => `${at(use.source, use.node)} ${use.name}`)).toEqual([]);
  });

  it("never takes a host method by reference, alias or destructuring", () => {
    expect(uses.filter((use) => use.kind === "other").map((use) => `${at(use.source, use.node)} ${use.name}`)).toEqual([]);
  });

  it("never mentions updateModelContext: the views don't write the model's context", () => {
    expect(uses.filter((use) => use.name === "updateModelContext").map((use) => at(use.source, use.node))).toEqual([]);
  });

  it("never calls openLink outside the adapter (A12 dropped)", () => {
    expect(outsideAdapter.filter((use) => use.name === "openLink" && use.kind === "call").map((use) => at(use.source, use.node))).toEqual([]);
  });

  it("has exactly one sendMessage call site, and it sends a fixed template naming an id", () => {
    const sends = outsideAdapter.filter((use) => use.name === "sendMessage" && use.kind === "call");
    expect(sends.map((use) => use.source.file)).toEqual(["views/cost-rollup/AskAboutSession.tsx"]);
    for (const use of sends) {
      const [message, ...rest] = (use.node as ts.CallExpression).arguments;
      expect(rest).toHaveLength(0);
      expect(message && ts.isCallExpression(message) && ts.isIdentifier(message.expression), `${at(use.source, use.node)}: the message must come from a template function`).toBe(true);
      const template = ((message as ts.CallExpression).expression as ts.Identifier).text;
      expect(fixedTemplateProblems(template)).toEqual([]);
      for (const arg of (message as ts.CallExpression).arguments) {
        expect(ts.isIdentifier(arg) && /Id$/.test(arg.text), `${template}(${arg.getText()})`).toBe(true);
        // The id is checked to be a plain id in the same file before it can be sent.
        const guarded = descendants(use.source.sf).some((node) => ts.isCallExpression(node) && calleeName(node) === "isPlainSessionId" && node.arguments[0]?.getText() === arg.getText());
        expect(guarded, `${at(use.source, use.node)}: ${arg.getText()} is not checked with isPlainSessionId`).toBe(true);
      }
    }
  });

  it("calls only reviewed tools, by literal name, with ids and filters as arguments", () => {
    const calls = toolCalls();
    expect(calls.map((call) => `${call.where.replace(/:\d+$/, "")} ${call.tool?.getText()}`).sort()).toEqual([
      'views/SessionCostView.tsx "get_turn_series"',
      'views/cost-compare/CompareDrillDown.tsx "get_project_cost"',
      'views/cost-compare/CompareDrillDown.tsx "get_repository_cost"',
      'views/cost-rollup/DrillDown.tsx "get_session_cost"',
      'views/findings/use-findings-query.ts "list_findings"',
      'views/price-changes/PriceDrillDown.tsx "get_price_changes"',
      'views/replay/ReplayDrillDown.tsx "replay_session"',
      'views/session-cost/TopTurns.tsx "get_turn"',
    ]);
    const problems: string[] = [];
    for (const call of calls) {
      if (!call.tool || !ts.isStringLiteral(call.tool) || !TOOLS.has(call.tool.text)) problems.push(`${call.where}: tool ${call.tool?.getText()} is not a reviewed literal`);
      if (!call.args) problems.push(`${call.where}: no arguments`);
      else problems.push(...argumentProblems(call.args, call.where));
    }
    expect(problems).toEqual([]);
  });

  it("reviews no tool or argument name that no call uses, so the lists stay minimal", () => {
    const calls = toolCalls();
    const tools = new Set(calls.flatMap((call) => (call.tool && ts.isStringLiteral(call.tool) ? [call.tool.text] : [])));
    const names = new Set(calls.flatMap((call) => (call.args ? argumentNames(call.args) : [])));
    expect([...TOOLS].filter((tool) => !tools.has(tool))).toEqual([]);
    expect([...ARGUMENT_NAMES].filter((name) => !names.has(name))).toEqual([]);
  });

  it("the adapter forwards its own parameters untouched", () => {
    const calls = uses.filter((use) => use.source.file === ADAPTER && use.kind === "call");
    expect(calls.map((use) => use.name).sort()).toEqual(["callServerTool", "openLink", "sendMessage"]);
    for (const use of calls) {
      const fn = enclosingFunction(use.node)!;
      const params = new Set(fn.parameters.map((param) => param.name.getText()));
      const identifiers = descendants((use.node as ts.CallExpression).arguments[0]!).filter(ts.isIdentifier);
      const values = identifiers.filter((id) => !(ts.isPropertyAssignment(id.parent) && id.parent.name === id));
      for (const id of values) expect(params.has(id.text), `${at(use.source, use.node)}: ${id.text}`).toBe(true);
    }
  });

  // The checker itself: each rule rejects the shape it exists to catch.
  it("flags the shapes it exists to catch", () => {
    const parse = (code: string) => {
      const sf = ts.createSourceFile("probe.ts", code, ts.ScriptTarget.Latest, true);
      return (sf.statements[0] as ts.ExpressionStatement).expression;
    };
    expect(argumentProblems(parse("({ sessionId: cost.sessionId, ...(p ? { provider: p } : {}) })"), "ok")).toEqual([]);
    expect(argumentProblems(parse("({ sessionId, note: turn.userMessage })"), "bad")).toEqual(['bad: argument "note" is not a reviewed argument name', "bad: reads .userMessage, a logged-text field"]);
    expect(argumentProblems(parse("({ sessionId: row.title })"), "bad")).toEqual(["bad: reads .title, a logged-text field"]);
    expect(argumentProblems(parse("args"), "bad")).toEqual(["bad: arguments are args, not an object literal or a reviewed builder"]);
    expect(fixedTemplateProblems("askAboutSessionText")).toEqual([]);
    expect(fixedTemplateProblems("toolArguments")).not.toEqual([]);
    // U9-U11's display text (A23).
    expect(argumentProblems(parse("({ projectId: row.label })"), "bad")).toEqual(["bad: reads .label, a logged-text field"]);
    expect(argumentProblems(parse("({ repository: explained.reason })"), "bad")).toEqual(["bad: reads .reason, a logged-text field"]);
    expect(argumentProblems(parse("({ projectId: project.name })"), "bad")).toEqual(["bad: reads .name, a logged-text field"]);
  });
});

const WEB = path.resolve(here, "../../../web");

// The web package's files the shipped views import through its exports map,
// and their relative imports, transitively.
function webModules(): string[] {
  const exportsMap = (JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf8")) as { exports: Record<string, string> }).exports;
  const queue: string[] = [];
  for (const source of SOURCES) {
    for (const statement of source.sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const match = /^@agent-cost-analyzer\/web\/(.+)$/.exec(statement.moduleSpecifier.text);
      const target = match ? exportsMap[`./${match[1]}`] : undefined;
      if (target !== undefined && /\.tsx?$/.test(target)) queue.push(path.join(WEB, target));
    }
  }
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of sf.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) continue;
      const base = path.resolve(path.dirname(file), specifier.replace(/\.js$/, ""));
      const resolved = [".ts", ".tsx"].map((extension) => base + extension).find((candidate) => existsSync(candidate));
      if (resolved !== undefined) queue.push(resolved);
    }
  }
  return [...seen].sort();
}

describe("no HTML or network sinks (static)", () => {
  const SINKS = /dangerouslySetInnerHTML|\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\(|new Function\(|srcdoc|\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|window\.open\(|location\.(href|assign|replace)/;

  it("no shipped source renders HTML from a string, evaluates code or opens a connection", () => {
    const hits: string[] = [];
    for (const source of SOURCES) {
      // Comments may name the sinks; code may not.
      const code = source.sf.getFullText().replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      code.split("\n").forEach((line, index) => {
        if (SINKS.test(line)) hits.push(`${source.file}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  // U9-U11 (A23) brought web's Waterfall and SegmentedControl into the
  // bundle; every web module the views import, and its relative imports,
  // is held to the same rule.
  it("no web module the views import renders HTML from a string, evaluates code or opens a connection", () => {
    const modules = webModules();
    expect(modules.map((file) => path.relative(WEB, file).split(path.sep).join("/"))).toEqual(expect.arrayContaining(["src/charts/Waterfall.tsx", "src/charts/ViewAsTable.tsx", "src/components/ui/SegmentedControl.tsx"]));
    const hits: string[] = [];
    for (const file of modules) {
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      code.split("\n").forEach((line, index) => {
        if (SINKS.test(line) || /<a[\s>]|\b(href|src|srcSet|xlinkHref|formAction)=/.test(line)) hits.push(`${path.relative(WEB, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("no view sets a URL attribute (href, src, action) on any element", () => {
    const URL_ATTRIBUTES = new Set(["href", "src", "srcSet", "xlinkHref", "action", "formAction", "poster", "data"]);
    const found = SOURCES.flatMap((source) => descendants(source.sf).filter((node): node is ts.JsxAttribute => ts.isJsxAttribute(node) && URL_ATTRIBUTES.has(node.name.getText())).map((node) => `${at(source, node)} ${node.name.getText()}`));
    expect(found).toEqual([]);
  });

  it("no view renders a link: there is nothing to open (A12 dropped)", () => {
    const anchors = SOURCES.flatMap((source) => descendants(source.sf).filter((node) => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === "a").map((node) => at(source, node)));
    expect(anchors).toEqual([]);
  });
});

describe("clipboard (static)", () => {
  // Plan §4.4, decision A: the clipboard gets the session title (or the id)
  // for the extension's Open Session picker. It goes to the user, never to
  // the model, so a title is allowed here and nowhere in a port call.
  it("writes only the open-session search text, built from the session id and title", () => {
    const writes = SOURCES.flatMap((source) =>
      descendants(source.sf)
        .filter((node): node is ts.CallExpression => ts.isCallExpression(node) && calleeName(node) === "writeText")
        .map((call) => ({ source, call })),
    );
    // The port's own adapter, and the one hook that copies.
    expect(writes.map(({ source }) => source.file).sort()).toEqual(["host/clipboard-port.ts", "views/session-cost/CopyCommandButton.tsx"]);
    const hook = findFunction("useCopyCommand")!;
    const copied = writes.find(({ source }) => source.file.endsWith("CopyCommandButton.tsx"))!.call.arguments[0]!;
    expect(ts.isIdentifier(copied) && hook.fn.parameters.some((param) => param.name.getText() === copied.text)).toBe(true);

    // Every caller of the hook passes a const built by sessionSearchText.
    const callers = SOURCES.flatMap((source) => descendants(source.sf).filter((node): node is ts.CallExpression => ts.isCallExpression(node) && calleeName(node) === "useCopyCommand").map((call) => ({ source, call })));
    expect(callers.length).toBeGreaterThan(0);
    for (const { source, call } of callers) {
      const argument = call.arguments[1]!;
      expect(ts.isIdentifier(argument)).toBe(true);
      const declaration = descendants(source.sf).find((node): node is ts.VariableDeclaration => ts.isVariableDeclaration(node) && node.name.getText() === (argument as ts.Identifier).text)!;
      const init = declaration.initializer!;
      expect(ts.isCallExpression(init) && calleeName(init)).toBe("sessionSearchText");
      expect((init as ts.CallExpression).arguments.map((arg) => arg.getText())).toEqual(["vm.sessionId", "vm.title"]);
    }
  });
});
