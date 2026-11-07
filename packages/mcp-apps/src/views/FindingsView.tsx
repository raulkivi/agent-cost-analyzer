// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ViewBrand } from "../brand/view-brand.js";
import { ViewShell } from "./ViewShell.js";

export function FindingsView({ brand }: { brand: ViewBrand }) {
  return <ViewShell brand={brand} kicker="Findings" title="Findings" />;
}
