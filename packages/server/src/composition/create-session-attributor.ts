import os from "node:os";
import { emptyProjectsFile, type VendorProfile } from "@agent-cost-analyzer/domain";
import { NodeReadOnlyFileSystem } from "../platform/file-system/node-read-only-file-system.js";
import { RepositoryResolver } from "../services/cost-attribution/repository-resolver.js";
import { SessionAttributor, type ProjectsSource } from "../services/cost-attribution/session-attributor.js";
import { ProfileVendorResolver } from "../services/cost-attribution/vendor-resolver.js";

// Phase 15 step 15.4: one wiring of SessionAttributor for every product.
// The standalone app passes its projects catalog; a product without a
// projects file yet (the extension, until step 15.14) gets an empty one, so
// repositories, vendors and channels still resolve and every turn is in "No
// project".
export interface SessionAttributorOptions {
  projects?: ProjectsSource;
  vendorProfiles: readonly VendorProfile[];
  homeDir?: string;
}

const NO_PROJECTS: ProjectsSource = { load: () => ({ file: emptyProjectsFile() }) };

export function createSessionAttributor(options: SessionAttributorOptions): SessionAttributor {
  return new SessionAttributor({
    repositories: new RepositoryResolver(new NodeReadOnlyFileSystem()),
    projects: options.projects ?? NO_PROJECTS,
    vendors: new ProfileVendorResolver(options.vendorProfiles),
    homeDir: options.homeDir ?? os.homedir(),
  });
}
