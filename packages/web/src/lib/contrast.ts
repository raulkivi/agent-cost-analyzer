// WCAG 2.2 contrast maths over the small CSS colour grammar this app's
// stylesheets use: #hex, a few names, var() with fallbacks and
// `color-mix(in srgb, A p%, B)`. jsdom computes no colours, so axe's
// colour-contrast rule can't run in tests; theme-contrast.test.ts checks
// the theme's token pairs with this instead (vscode-extension.md §3.5).

export type Rgb = [number, number, number];

const NAMED: Record<string, Rgb> = { white: [255, 255, 255], black: [0, 0, 0] };

// The two label colours readableTextOn chooses between. Black rather than
// the Industry text colour: every colour reaches 4.58:1 against black or
// white, which mid-tone hues such as #2a78d6 don't against #1d1f20.
const DARK_TEXT = "#000000";
const LIGHT_TEXT = "#ffffff";

export function parseColor(value: string): Rgb {
  const color = value.trim().toLowerCase();
  const named = NAMED[color];
  if (named) return [...named];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(color);
  if (short) return [short[1]!, short[2]!, short[3]!].map((digit) => parseInt(digit + digit, 16)) as Rgb;
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(color);
  if (long) return [long[1]!, long[2]!, long[3]!].map((pair) => parseInt(pair, 16)) as Rgb;
  throw new Error(`Unsupported colour: ${value}`);
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

function mix(a: Rgb, b: Rgb, weightOfA: number): Rgb {
  return a.map((channel, index) => channel * weightOfA + b[index]! * (1 - weightOfA)) as Rgb;
}

// Splits a function's arguments at top-level commas.
function splitArguments(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function functionArguments(value: string, name: string): string[] | undefined {
  const prefix = `${name}(`;
  return value.startsWith(prefix) && value.endsWith(")") ? splitArguments(value.slice(prefix.length, -1)) : undefined;
}

export interface ResolveOptions {
  // Custom properties in scope, name → declared value.
  vars?: Record<string, string>;
  // What the colour is drawn on, for anything mixed with `transparent`.
  backdrop?: Rgb;
}

// A colour as the browser would paint it over `backdrop`. A var() with no
// declared value takes its fallback, as in a webview whose theme doesn't
// define that --vscode-* variable.
export function resolveCssColor(value: string, options: ResolveOptions = {}): Rgb {
  const color = value.trim();
  const varArgs = functionArguments(color, "var");
  if (varArgs) {
    const [name, fallback] = varArgs as [string, string | undefined];
    const declared = options.vars?.[name];
    if (declared !== undefined) return resolveCssColor(declared, options);
    if (fallback !== undefined) return resolveCssColor(fallback, options);
    throw new Error(`Undefined custom property ${name}`);
  }
  const mixArgs = functionArguments(color, "color-mix");
  if (mixArgs) {
    const [, first, second] = mixArgs as [string, string, string];
    const percent = /\s(\d+(?:\.\d+)?)%$/.exec(first);
    const weight = percent ? Number(percent[1]) / 100 : 0.5;
    const a = resolveCssColor(percent ? first.slice(0, percent.index) : first, options);
    const b = second === "transparent" ? options.backdrop : resolveCssColor(second, options);
    if (!b) throw new Error(`A mix with transparent needs a backdrop: ${value}`);
    return mix(a, b, weight);
  }
  return parseColor(color);
}

// Label colour for text drawn on a fill the app picks itself (the system
// prompt icicle's hues): dark or white, whichever contrasts more.
export function readableTextOn(background: string): typeof DARK_TEXT | typeof LIGHT_TEXT {
  const ground = resolveCssColor(background);
  return contrastRatio(parseColor(DARK_TEXT), ground) >= contrastRatio(parseColor(LIGHT_TEXT), ground)
    ? DARK_TEXT
    : LIGHT_TEXT;
}
