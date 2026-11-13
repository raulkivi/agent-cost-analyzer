// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { compositeOver, contrastRatio, groundOf, parseCssColor } from "../../../scripts/ui-check/contrast.mts";

// WCAG 1.4.11: the parts of a control a person needs to see (a glyph, a
// border) reach 3:1 against the ground they are drawn on. The page reports
// computed colours; this judges them (step 10.19, plan section 7).
export interface NonTextSample {
  label: string;
  // The computed stroke, fill or border colour.
  paint: string;
  // The element's parents' computed backgrounds, nearest first.
  backgrounds: string[];
}

export function judgeNonTextContrast(samples: NonTextSample[], minimum = 3): string[] {
  if (samples.length === 0) return ["no samples to judge"];
  const findings: string[] = [];
  for (const sample of samples) {
    const paint = parseCssColor(sample.paint);
    if (!paint) {
      findings.push(`${sample.label}: paint "${sample.paint}" is not a colour`);
      continue;
    }
    const ground = groundOf(sample.backgrounds);
    const ratio = contrastRatio(compositeOver(paint, ground), ground);
    if (ratio < minimum) {
      findings.push(`${sample.label}: ${ratio.toFixed(2)}:1 on rgb(${Math.round(ground.r)}, ${Math.round(ground.g)}, ${Math.round(ground.b)})`);
    }
  }
  return findings;
}
