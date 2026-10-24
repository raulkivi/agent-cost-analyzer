import { describe, expect, it, vi } from "vitest";
import { MAX_HOST_COMMAND_TEXT_LENGTH, type ConfigStatus, type ConfigWarning } from "@copilot-cost-analyzer/domain";
import { HostCommandHandler, type HostCommands } from "./host-command-handler.js";

const LOGGING_ENABLED = "github.copilot.chat.agentDebugLog.fileLogging.enabled";
const MAX_RETAINED = "github.copilot.chat.agentDebugLog.fileLogging.maxRetainedSessionLogs";
const AGENT_TRACES = "github.copilot.chat.otel.dbSpanExporter.enabled";

function fakeCommands(overrides: Partial<HostCommands> = {}): HostCommands {
  return {
    openSetting: vi.fn(async () => undefined),
    copyToClipboard: vi.fn(async () => undefined),
    openTextDocument: vi.fn(async () => undefined),
    ...overrides,
  };
}

function warning(settingId: string): ConfigWarning {
  return {
    code: "agent-traces-unavailable",
    severity: "optional",
    settingId,
    currentValue: false,
    recommendedValue: true,
    message: "m",
    helpSteps: [],
  };
}

function statusWith(warnings: ConfigWarning[]): () => Promise<ConfigStatus> {
  return async () => ({
    checkedAt: "2026-10-24T00:00:00.000Z",
    vscodeUserSettingsPath: null,
    loggingEnabled: true,
    maxRetainedSessionLogs: 200,
    minRetainedSessionLogsThreshold: 200,
    warnings,
  });
}

function command(name: unknown, args?: unknown) {
  return { kind: "command", id: "cmd-1", command: name, args };
}

describe("HostCommandHandler (vscode-extension.md G8)", () => {
  it("opens a setting named by a current config warning", async () => {
    const commands = fakeCommands();
    const handler = new HostCommandHandler(commands, statusWith([warning(AGENT_TRACES)]));

    const response = await handler.handle(command("openSetting", { settingId: AGENT_TRACES }));

    expect(commands.openSetting).toHaveBeenCalledWith(AGENT_TRACES);
    expect(response).toEqual({ kind: "response", id: "cmd-1", ok: true });
  });

  it.each([LOGGING_ENABLED, MAX_RETAINED])("always allows the known Copilot setting %s", async (settingId) => {
    const commands = fakeCommands();
    const handler = new HostCommandHandler(commands, statusWith([]));

    expect(await handler.handle(command("openSetting", { settingId }))).toMatchObject({ ok: true });
    expect(commands.openSetting).toHaveBeenCalledWith(settingId);
  });

  it.each(["workbench.action.terminal.new", "security.workspace.trust.enabled", AGENT_TRACES])(
    "rejects any other setting id (%s) with 400, without opening anything",
    async (settingId) => {
      const commands = fakeCommands();
      const handler = new HostCommandHandler(commands, statusWith([warning(LOGGING_ENABLED)]));

      const response = await handler.handle(command("openSetting", { settingId }));

      expect(response).toEqual({
        kind: "response",
        id: "cmd-1",
        ok: false,
        error: { status: 400, message: `Setting "${settingId}" can't be opened from the analyzer` },
      });
      expect(commands.openSetting).not.toHaveBeenCalled();
    },
  );

  it("still allows the known Copilot settings when the config status can't be read", async () => {
    const commands = fakeCommands();
    const handler = new HostCommandHandler(commands, async () => {
      throw new Error("settings unreadable");
    });

    expect(await handler.handle(command("openSetting", { settingId: LOGGING_ENABLED }))).toMatchObject({ ok: true });
    expect(await handler.handle(command("openSetting", { settingId: AGENT_TRACES }))).toMatchObject({
      ok: false,
      error: { status: 400 },
    });
  });

  it("copies text to the clipboard", async () => {
    const commands = fakeCommands();

    const response = await new HostCommandHandler(commands, statusWith([])).handle(
      command("copyToClipboard", { text: "bundle" }),
    );

    expect(commands.copyToClipboard).toHaveBeenCalledWith("bundle");
    expect(response).toMatchObject({ ok: true });
  });

  it("opens text as a document in the given language", async () => {
    const commands = fakeCommands();

    await new HostCommandHandler(commands, statusWith([])).handle(
      command("openTextDocument", { content: "You are a helpful assistant.", language: "plaintext" }),
    );

    expect(commands.openTextDocument).toHaveBeenCalledWith("You are a helpful assistant.", "plaintext");
  });

  it.each([
    ["copyToClipboard", { text: "x".repeat(MAX_HOST_COMMAND_TEXT_LENGTH + 1) }],
    ["openTextDocument", { content: "x".repeat(MAX_HOST_COMMAND_TEXT_LENGTH + 1), language: "plaintext" }],
  ])("rejects %s text over the 5 MB bound with 400", async (name, args) => {
    const commands = fakeCommands();

    const response = await new HostCommandHandler(commands, statusWith([])).handle(command(name, args));

    expect(response).toMatchObject({ ok: false, error: { status: 400 } });
    expect((response as { error: { message: string } }).error.message).toContain(`Invalid args for ${name}`);
    expect(commands.copyToClipboard).not.toHaveBeenCalled();
    expect(commands.openTextDocument).not.toHaveBeenCalled();
  });

  it("accepts text right at the bound", async () => {
    const commands = fakeCommands();

    const response = await new HostCommandHandler(commands, statusWith([])).handle(
      command("copyToClipboard", { text: "x".repeat(MAX_HOST_COMMAND_TEXT_LENGTH) }),
    );

    expect(response).toMatchObject({ ok: true });
  });

  it.each(["runShell", "executeCommand", "__proto__", 42, undefined])(
    "rejects the command %s, which isn't on the allow-list, with 400",
    async (name) => {
      const response = await new HostCommandHandler(fakeCommands(), statusWith([])).handle(command(name));

      expect(response).toEqual({
        kind: "response",
        id: "cmd-1",
        ok: false,
        error: { status: 400, message: `Unknown command "${String(name)}"` },
      });
    },
  );

  it.each([
    ["openSetting", {}, "settingId"],
    ["openSetting", { settingId: 7 }, "settingId"],
    ["copyToClipboard", { text: 1 }, "text"],
    ["openTextDocument", { content: "x", language: "html" }, "language"],
  ])("rejects %s args %j with a 400 that names %s", async (name, args, field) => {
    const commands = fakeCommands();

    const response = await new HostCommandHandler(commands, statusWith([])).handle(command(name, args));

    expect(response).toMatchObject({ ok: false, error: { status: 400 } });
    expect((response as { error: { message: string } }).error.message).toContain(field);
    for (const call of Object.values(commands)) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it.each([["text"], [[1]], [null]])("rejects args that aren't an object (%j) with 400", async (args) => {
    const response = await new HostCommandHandler(fakeCommands(), statusWith([])).handle(
      command("copyToClipboard", args),
    );

    expect(response).toMatchObject({ ok: false, error: { status: 400, message: "args must be an object" } });
  });

  it("answers a failing editor call with a generic 500 and reports it", async () => {
    const failure = new Error("EACCES: /home/someone/secret");
    const onInternalError = vi.fn();
    const commands = fakeCommands({
      copyToClipboard: vi.fn(async () => {
        throw failure;
      }),
    });

    const response = await new HostCommandHandler(commands, statusWith([]), { onInternalError }).handle(
      command("copyToClipboard", { text: "x" }),
    );

    expect(response).toEqual({ kind: "response", id: "cmd-1", ok: false, error: { status: 500, message: "Internal error" } });
    expect(onInternalError).toHaveBeenCalledWith("copyToClipboard", failure);
  });
});
