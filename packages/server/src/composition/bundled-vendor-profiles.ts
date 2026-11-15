// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { VendorProfile } from "@agent-cost-analyzer/domain";
import { loadVendorProfiles } from "../data-sources/vendor-profiles/loader.js";
import { BundledPriceBookSource } from "../services/pricing/bundled-price-book-source.js";
import { PriceBook } from "../services/pricing/price-book.js";
import type { BundledDataDirs } from "./package-layout.js";

// The standalone app's vendor profiles, with their Copilot prices from the
// same bundled price book the app prices turns with. Without a price book
// folder the loader looks beside the profiles, as it always has.
export function loadBundledVendorProfiles({ vendorProfilesDir, priceBookDir }: Pick<BundledDataDirs, "vendorProfilesDir" | "priceBookDir">): VendorProfile[] {
  if (priceBookDir === undefined) return loadVendorProfiles(vendorProfilesDir);
  return loadVendorProfiles(vendorProfilesDir, new PriceBook(new BundledPriceBookSource(priceBookDir)));
}
