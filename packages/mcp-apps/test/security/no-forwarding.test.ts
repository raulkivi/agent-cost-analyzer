// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
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
const LOGGED_TEXT = new Set(["title", "sessionTitle", "userMessage", "assistantMessage", "excerpt", "prompt", "response", "detail", "why", "evidence", "text", "content", "message", "summary", "heading"]);
// The tools a view may call, and the argument names it may send them.
const TOOLS = new Set(["get_turn_series", "get_turn", "get_session_cost", "list_findings"]);
const ARGUMENT_NAMES = new Set(["sessionId", "provider", "turnIndex", "maxTurns", "kind", "minSeverity"]);

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
    expect(files).toEqual(expect.arrayContaining([ADAPTER, "views/SessionCostView.tsx", "views/cost-rollup/AskAboutSession.tsx", "views/findings/use-findings-query.ts"]));
    expect(files.some((file) => file.endsWith(".test.tsx"))).toBe(false);
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
      'views/cost-rollup/DrillDown.tsx "get_session_cost"',
      'views/findings/use-findings-query.ts "list_findings"',
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
  });
});

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
