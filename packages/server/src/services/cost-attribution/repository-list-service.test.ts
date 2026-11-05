import { describe, expect, it } from "vitest";
import type { Session } from "@agent-cost-analyzer/domain";
import type { LogProvider } from "../../data-sources/log-providers/log-provider.js";
import { FakeProvider } from "../../test-support/audit-fakes.js";
import { InMemoryFileSystem } from "../../test-support/in-memory-file-system.js";
import { InMemoryProjectStore } from "../../test-support/in-memory-project-store.js";
import { ProjectCatalog } from "./project-catalog.js";
import { RepositoryListService } from "./repository-list-service.js";
import { RepositoryResolver } from "./repository-resolver.js";

function withFolder(id: string, cwd: string): Session {
  return {
    id,
    mode: "analyze",
    title: id,
    model: "m",
    turns: [],
    turnCount: 0,
    costAiCredits: { known: false, reason: "n/a" },
    usageDataAvailable: false,
    startedAt: "2026-10-01T09:00:00.000Z",
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
    new InMemoryProjectStore(JSON.stringify({ version: 1, projects: [{ id: "app", name: "App", members: [{ repository: "github.com/org/app" }] }] })),
  );

  function service(providers: LogProvider[]): RepositoryListService {
    return new RepositoryListService({ listProviders: () => providers }, new RepositoryResolver(fs), catalog);
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

  it("reads only session summaries, never whole sessions", async () => {
    const provider = new FakeProvider("claude-code", [withFolder("a", "/home/dev/app")]);

    await service([provider]).getRepositoryList();

    expect(provider.reads).toBe(0);
  });
});
