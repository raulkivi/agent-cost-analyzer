// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ViewBrand } from "../brand/view-brand.js";
import { ViewShell } from "./ViewShell.js";

export function CostRollupView({ brand }: { brand: ViewBrand }) {
  return <ViewShell brand={brand} kicker="Cost rollup" title="Cost rollup" />;
}
