import type { ProjectsFile } from "@agent-cost-analyzer/domain";
import type { PriceBookData, PriceBookSource } from "./price-book-source.js";

// Phase 15 step 15.5 (plan §6.1, §7): the user's own price versions, from
// the projects file's channels.priceVersions. Read on every load, so an edit
// saved through PUT /api/projects applies at once. The projects file's own
// schema has already validated each version.
export class UserPriceBookSource implements PriceBookSource {
  constructor(private readonly readProjectsFile: () => ProjectsFile) {}

  load(): PriceBookData {
    const versions = this.readProjectsFile().channels?.priceVersions ?? [];
    return { versions: versions.map((version) => ({ ...version, origin: "user" as const })), sources: [], problems: [] };
  }
}
