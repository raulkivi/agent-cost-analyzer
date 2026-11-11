// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import type { ViewBrand } from "../brand/view-brand.js";
import type { DisplayMode } from "../host/app-host-port.js";

// The branded frame shared by U1-U3 (plan §5.1, §5.5): the corner-mark card,
// the product mark and kicker, the title, and the read-only footer. `meta`
// (right of the title) and `actions` (right of the footer) are optional.

// The product mark: the app icon at 16px. Its colours come from brand.css
// tokens, so it follows the theme; aria-hidden because the name beside it
// is the label.
function BrandMark() {
  return (
    <svg className="brand-mark" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24">
      <rect width="24" height="24" rx="5" fill="var(--brand-mark)" />
      <g transform="translate(3.2 3.6) scale(0.7)" fill="none" stroke="var(--brand-on-accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-7" />
        <path d="M21 20H3" />
      </g>
    </svg>
  );
}

export function ViewShell({
  brand,
  kicker,
  title,
  meta,
  actions,
  lead,
  displayMode,
  children,
}: {
  brand: ViewBrand;
  kicker: string;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  // Between the kicker and the title: the back control of an in-place drill-down.
  lead?: ReactNode;
  // Set by views that lay out for the host's display mode (A31): CSS reads it
  // as data-display-mode, so the narrow layouts can yield to fullscreen.
  displayMode?: DisplayMode;
  children?: ReactNode;
}) {
  const footer = brand.version ? `Read-only · local logs · v${brand.version}` : "Read-only · local logs";
  return (
    // <main>, not Blueprint's <div role="region">: the view is the whole
    // document in the host's frame, so it is the page's one main landmark,
    // and the footer inside it is not a nested contentinfo landmark (A14:
    // axe landmark-contentinfo-is-top-level). Same classes and corner marks
    // as Blueprint.
    <main className="blueprint card view-shell" aria-labelledby="view-title" data-display-mode={displayMode}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <div className="view-kicker">
        <BrandMark />
        <p className="card-kicker">
          {brand.displayName} · {kicker}
        </p>
      </div>
      {lead}
      <div className="view-heading">
        <h1 id="view-title">{title}</h1>
        {meta !== undefined && <span className="view-meta">{meta}</span>}
      </div>
      {children}
      <footer className="view-footer">
        <span className="view-footer-note">{footer}</span>
        {actions !== undefined && <span className="view-footer-actions">{actions}</span>}
      </footer>
    </main>
  );
}
