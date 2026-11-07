// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ViewBrand } from "../brand/view-brand.js";
import { ViewShell } from "./ViewShell.js";

export function NoViewState({ brand }: { brand: ViewBrand }) {
  return (
    <ViewShell brand={brand} kicker="Cost views" title="No view for this result">
      <p>This result has no visual view. The text answer above is complete.</p>
    </ViewShell>
  );
}
