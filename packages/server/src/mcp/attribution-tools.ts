import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { projectListSchema, repositoryListSchema } from "@agent-cost-analyzer/domain";
import type { AttributionQueries } from "../services/cost-attribution/attribution-query-service.js";
import type { McpToolDeps } from "./mcp-server.js";
import { json, projectIdArg, providerArg, READ_ONLY, sinceArg, untilArg, type Guard } from "./tool-helpers.js";

// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md
// §10.1.1, §10.1.4): which repositories and projects the sessions belong
// to. Read-only, every available provider unless `provider` is given, and
// no local folder path unless `includePaths` (§10.1.5).
export function registerAttributionTools(server: McpServer, deps: McpToolDeps, attribution: AttributionQueries, guarded: Guard): void {
  server.registerTool(
    "list_repositories",
    {
      title: "List repositories",
      description:
        "Lists the code repositories the sessions worked in, across every available provider unless `provider` is given: start here to find a `repository` key for list_sessions or to see which project each repository is in. Each entry has its key (a normalised remote such as github.com/org/app; a repository without a remote, or a folder outside one, is local:<folder name> or path:<folder name>), session and turn counts, first and last use, AI Credits with coverage (null is unknown, never zero) and project ids. Sessions with no repository are grouped by reason under `unattributed`. Folder paths are left out unless includePaths is true.",
      inputSchema: {
        provider: providerArg(deps.identity).describe("Log provider id (see list_log_providers). Omit to read every available provider."),
        since: sinceArg,
        until: untilArg,
        projectId: projectIdArg.optional().describe("Only repositories with a member in this project (see list_projects)."),
        includeUnattributed: z.boolean().optional().describe("Include the Unattributed buckets with their reasons (default true)."),
        includePaths: z
          .boolean()
          .optional()
          .describe("Return local folder paths (full local:/path: keys and each repository's root folder). Default false: folder names only."),
      },
      outputSchema: repositoryListSchema,
      annotations: READ_ONLY,
    },
    ({ provider, since, until, projectId, includeUnattributed, includePaths }) =>
      guarded(async () =>
        json(await attribution.listRepositories({ providerId: provider, since, until, projectId, includeUnattributed, includePaths })),
      ),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description:
        "Lists the user's projects from their local projects file: each project's id, name, client, billing code and members (a repository key, optionally narrowed to a path inside it and branch patterns). A turn counts in at most one project, the most specific matching member. Use it to pick a `projectId` for list_repositories or list_sessions; `problems` lists what is wrong with the file, if anything.",
      outputSchema: projectListSchema,
      annotations: READ_ONLY,
    },
    () => guarded(async () => json(attribution.listProjects())),
  );
}
