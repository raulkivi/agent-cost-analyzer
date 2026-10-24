// Judges what the UI check's browser probe saw (step 10.11): the page must
// fit the panel's width, and every visible text must reach WCAG AA contrast
// (4.5:1, or 3:1 for large text) against the ground it is painted on.
import { compositeOver, contrastRatio, parseCssColor, type Rgba } from "./contrast.mts";

export interface ProbedText {
  label: string;
  text: string;
  color: string;
  // Background colours from the text's own element outwards to <html>.
  backgrounds: string[];
  fontSize: number;
  bold: boolean;
}

export interface Probe {
  viewportWidth: number;
  scrollWidth: number;
  overflowing: string[];
  texts: ProbedText[];
}

const OPAQUE_FALLBACK: Rgba = { r: 255, g: 255, b: 255, a: 1 };

function groundOf(backgrounds: string[]): Rgba {
  let ground = OPAQUE_FALLBACK;
  for (const value of [...backgrounds].reverse()) {
    const colour = parseCssColor(value);
    if (colour && colour.a > 0) ground = compositeOver(colour, ground);
  }
  return ground;
}

function isLarge(text: ProbedText): boolean {
  return text.fontSize >= 24 || (text.bold && text.fontSize >= 18.66);
}

export function judgeProbe(probe: Probe): string[] {
  const findings: string[] = [];
  if (probe.scrollWidth > probe.viewportWidth + 1) {
    findings.push(`overflow: page is ${probe.scrollWidth} px wide in a ${probe.viewportWidth} px panel`);
  }
  for (const element of probe.overflowing) findings.push(`overflow: ${element}`);

  const seen = new Set<string>();
  for (const text of probe.texts) {
    const foreground = parseCssColor(text.color);
    if (!foreground) continue;
    const ground = groundOf(text.backgrounds);
    const ratio = contrastRatio(compositeOver(foreground, ground), ground);
    const minimum = isLarge(text) ? 3 : 4.5;
    if (ratio >= minimum) continue;
    const finding = `contrast ${ratio.toFixed(1)}:1 < ${minimum}: ${text.label} ${JSON.stringify(text.text)}`;
    if (!seen.has(finding)) {
      seen.add(finding);
      findings.push(finding);
    }
  }
  return findings;
}
