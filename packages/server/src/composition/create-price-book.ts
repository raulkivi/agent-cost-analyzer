import { existsSync } from "node:fs";
import path from "node:path";
import type { ProjectsFile } from "@agent-cost-analyzer/domain";
import { FileProjectStore } from "../data-sources/projects/file-project-store.js";
import { ProjectCatalog } from "../services/cost-attribution/project-catalog.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { CompositePriceBookSource } from "../services/pricing/composite-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import { UserPriceBookSource } from "../services/pricing/user-price-book-source.js";

// Phase 15 step 15.5 (plan §9): the bundled price book, then the user's own
// versions from the projects file. The bundled files are read once (and
// stop startup if they are wrong); the projects file on every lookup.
export function createPriceBook(readProjectsFile: () => ProjectsFile, priceBookDir?: string): PriceBook {
  return new PriceBook(new CompositePriceBookSource([new BundledPriceBookSource(priceBookDir), new UserPriceBookSource(readProjectsFile)]));
}

// The standalone app's and its MCP server's price book: projects.json in the
// app settings folder (step 15.3).
export function createStandalonePriceBook(appSettingsDir: string, catalog = new ProjectCatalog(new FileProjectStore(appSettingsDir))): PriceBook {
  return createPriceBook(() => catalog.load().file);
}

// Step 15.6: the extension's price book, bundled prices only (it has no
// projects file until step 15.14), from media/price-book beside the vendor
// profiles, as the vendor-profile loader finds it. Undefined when absent.
export function createBundledPriceBookBeside(vendorProfilesDir: string): PriceBook | undefined {
  const dir = path.join(vendorProfilesDir, "..", "price-book");
  return existsSync(dir) ? new PriceBook(new BundledPriceBookSource(dir)) : undefined;
}
