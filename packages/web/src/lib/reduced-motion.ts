// The slice of `window` the reduced-motion check needs; matchMedia is
// optional because jsdom doesn't have it.
export interface MediaQueryHost {
  matchMedia?: (query: string) => { matches: boolean };
}

// §3.5 Accessibility: the user's OS-level "reduce motion" setting. theme.css
// turns CSS motion off with it; this covers motion started from script.
export function prefersReducedMotion(host: MediaQueryHost = window): boolean {
  return host.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function scrollBehavior(host: MediaQueryHost = window): ScrollBehavior {
  return prefersReducedMotion(host) ? "auto" : "smooth";
}
