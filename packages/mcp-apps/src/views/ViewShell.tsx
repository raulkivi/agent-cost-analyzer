// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import type { ViewBrand } from "../brand/view-brand.js";

// Placeholder shell shared by U1-U3 until A9-A11 build the real views.
export function ViewShell({ brand, kicker, title, children }: { brand: ViewBrand; kicker: string; title: string; children?: ReactNode }) {
  return (
    <section className="card" aria-labelledby="view-title">
      <p className="card-kicker">
        {brand.displayName} · {kicker}
      </p>
      <h1 id="view-title">{title}</h1>
      {children}
    </section>
  );
}
