// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { McpClientId } from "../../../server/src/mcp/client-setup/client-setup.js";
import type {
  CommandResult,
  CommandRunner,
} from "../../src/mcp-setup/command-runner.js";
import type { ConfigFileStore } from "../../src/mcp-setup/config-file-store.js";
import type {
  InstallPlan,
  McpClientTarget,
  UninstallPlan,
} from "../../src/mcp-setup/mcp-client-target.js";
import type { SetupDeps } from "../../src/mcp-setup/setup-deps.js";
import { fakeEnv } from "./fake-client-env.js";

export function fakeTarget(
  id: McpClientId,
  opts: {
    label?: string;
    detected?: boolean;
    install?: Partial<InstallPlan>;
    uninstall?: Partial<UninstallPlan>;
  } = {},
): McpClientTarget {
  return {
    id,
    label: opts.label ?? id,
    detect: async () => opts.detected ?? true,
    status: async () => ({ kind: "not-registered" }),
    planInstall: async () => ({
      status: { kind: "not-registered" },
      actions: [],
      needsConfirmation: false,
      ...opts.install,
    }),
    planUninstall: async () => ({
      status: { kind: "not-registered" },
      actions: [],
      ...opts.uninstall,
    }),
  };
}

export interface Harness {
  deps: SetupDeps;
  out: string[];
  err: string[];
  asked: string[];
  runs: { file: string; args: readonly string[] }[];
  merges: unknown[];
  removes: unknown[];
}

export function harness(
  targets: readonly McpClientTarget[],
  opts: {
    interactive?: boolean;
    answer?: boolean;
    run?: (file: string) => CommandResult;
  } = {},
): Harness {
  const h: Harness = {
    out: [],
    err: [],
    asked: [],
    runs: [],
    merges: [],
    removes: [],
  } as unknown as Harness;
  const runner: CommandRunner = {
    run: async (file, args) => {
      h.runs.push({ file, args });
      return opts.run?.(file) ?? { ok: true };
    },
  };
  const store = {
    read: async () => ({ kind: "absent" }),
    merge: async (request: unknown) => {
      h.merges.push(request);
      return { kind: "added", backupPath: "/bak/one" };
    },
    remove: async (ref: unknown) => {
      h.removes.push(ref);
      return { kind: "removed", backupPath: "/bak/two" };
    },
  } as unknown as ConfigFileStore;
  h.deps = {
    targets,
    store,
    runner,
    env: fakeEnv(),
    version: "1.2.3",
    io: {
      out: (text) => void h.out.push(text),
      err: (text) => void h.err.push(text),
      interactive: opts.interactive ?? true,
      confirm: async (question) => {
        h.asked.push(question);
        return opts.answer ?? true;
      },
    },
  };
  return h;
}
