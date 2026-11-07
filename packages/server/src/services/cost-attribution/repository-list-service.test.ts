// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import type { Session } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { FakeProvider } from "../../test-support/audit-fakes.js";
import { InMemoryFileSystem } from "../../test-support/in-memory-file-system.js";
import { InMemoryProjectStore } from "../../test-support/in-memory-project-store.js";
import { ProjectCatalog } from "./project-catalog.js";
import { RepositoryListService } from "./repository-list-service.js";
import { RepositoryResolver } from "./repository-resolver.js";
import { SessionAttributor } from "./session-attributor.js";
import { ProfileVendorResolver } from "./vendor-resolver.js";

function capture(id: string, filePath: string): Session {
  return {
    ...withFolder(id, "/unused"),
    workspace: { known: false, reason: "mitmproxy captures record no working folder." },
    capture: { filePath },
  };
}

function withFolder(id: string, cwd: string, startedAt = "2026-10-01T09:00:00.000Z"): Session {
  return {
    id,
    mode: "analyze",
    title: id,
    model: "m",
    turns: [],
    turnCount: 0,
    costAiCredits: { known: false, reason: "n/a" },
    usageDataAvailable: false,
    startedAt,
    workspace: { known: true, cwd },
  };
}

class UnavailableProvider extends FakeProvider {
  override async checkAvailability() {
    return { available: false, unavailableReason: "Not configured." };
  }
}

class FailingProvider extends FakeProvider {
  override async listSessions(): Promise<Session[]> {
    throw new Error("store is corrupted");
  }
}

describe("RepositoryListService", () => {
  const fs = new InMemoryFileSystem({ "/home/dev/app/.git/config": '[remote "origin"]\n\turl = git@github.com:org/app.git\n' });
  const catalog = new ProjectCatalog(
    new InMemoryProjectStore(
      JSON.stringify({
        version: 1,
        projects: [{ id: "app", name: "App", members: [{ repository: "github.com/org/app" }] }],
        captureRules: [{ glob: "~/captures/*.har", repository: "github.com/org/app" }],
      }),
    ),
  );

  function service(providers: LogProvider[]): RepositoryListService {
    const attributor = new SessionAttributor({
      repositories: new RepositoryResolver(fs),
      projects: catalog,
      vendors: new ProfileVendorResolver([]),
      homeDir: "/home/dev",
    });
    return new RepositoryListService({ listProviders: () => providers }, attributor);
  }

  it("lists the repositories of every available provider's sessions, with their projects", async () => {
    const list = await service([new FakeProvider("claude-code", [withFolder("a", "/home/dev/app")])]).getRepositoryList();

    expect(list.repositories).toEqual([
      expect.objectContaining({ key: "github.com/org/app", sessionCount: 1, providerIds: ["claude-code"], projectIds: ["app"] }),
    ]);
    expect(list.providers).toEqual([{ id: "claude-code", label: "Fake", available: true }]);
  });

  it("reports an unavailable provider and a failing one without failing the list", async () => {
    const list = await service([
      new UnavailableProvider("pi-agent", []),
      new FailingProvider("vscode", []),
      new FakeProvider("claude-code", [withFolder("a", "/home/dev/app")]),
    ]).getRepositoryList();

    expect(list.providers).toEqual([
      { id: "pi-agent", label: "Fake", available: false, unavailableReason: "Not configured." },
      { id: "vscode", label: "Fake", available: true, error: "store is corrupted" },
      { id: "claude-code", label: "Fake", available: true },
    ]);
    expect(list.repositories).toHaveLength(1);
  });

  it("assigns a mitmproxy capture to its repository by the projects file's capture rule (step 15.4)", async () => {
    const list = await service([
      new FakeProvider("mitmproxy", [capture("m1", "/home/dev/captures/one.har"), capture("m2", "/tmp/two.har")]),
    ]).getRepositoryList();

    expect(list.repositories).toEqual([expect.objectContaining({ key: "github.com/org/app", source: "capture-rule", sessionCount: 1 })]);
    expect(list.unattributed).toEqual([expect.objectContaining({ reason: "mitmproxy captures record no working folder.", sessionCount: 1 })]);
  });

  it("narrows to one provider and a start-date window (step 15.4)", async () => {
    const providers = [
      new FakeProvider("claude-code", [withFolder("a", "/home/dev/app", "2026-09-01T09:00:00.000Z"), withFolder("b", "/home/dev/app")]),
      new FakeProvider("vscode", [withFolder("c", "/home/dev/app")]),
    ];

    const narrowed = await service(providers).getRepositoryList({ providerId: "claude-code", since: "2026-09-15" });

    expect(narrowed.repositories).toEqual([expect.objectContaining({ sessionCount: 1, providerIds: ["claude-code"] })]);
    expect(narrowed.providers.map((provider) => provider.id)).toEqual(["claude-code"]);
  });

  it("reads only session summaries, never whole sessions", async () => {
    const provider = new FakeProvider("claude-code", [withFolder("a", "/home/dev/app")]);

    await service([provider]).getRepositoryList();

    expect(provider.reads).toBe(0);
  });
});
