// What the UI check reads from the page (step 10.11). The browser only
// reports positions and computed colours; judge.mts decides. A string, not a
// function: the transpiler's helpers don't exist in the page.
import type { Page } from "playwright";
import type { Probe } from "./judge.mts";

const PROBE_SCRIPT = `(() => {
  const viewportWidth = document.documentElement.clientWidth;
  const label = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 2) : [];
    return el.tagName.toLowerCase() + (cls.length ? "." + cls.join(".") : "");
  };
  const shown = (el) => {
    if (el.closest("[hidden], [aria-hidden='true']")) return false;
    const style = getComputedStyle(el);
    if (style.visibility !== "visible" || style.display === "none" || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  // Inside a scroll box that itself fits, sticking out is content to scroll
  // to. Clipped (overflow hidden) content is cut off, so it still counts.
  const inFittingScrollBox = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const overflowX = getComputedStyle(a).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") return a.getBoundingClientRect().right <= viewportWidth + 1;
    }
    return false;
  };
  const overflowing = [];
  const texts = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!shown(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.right > viewportWidth + 1 && !inFittingScrollBox(el) && overflowing.length < 8) {
      overflowing.push(label(el) + " right=" + Math.round(rect.right));
    }
    if (el.closest("[disabled], [aria-disabled='true']")) continue;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
    if (!own) continue;
    const style = getComputedStyle(el);
    // SVG text is painted with fill, not color; only <text> and <tspan> hold it.
    const isSvg = el instanceof SVGElement;
    if (isSvg && !(el.tagName === "text" || el.tagName === "tspan")) continue;
    const backgrounds = [];
    for (let a = el; a; a = a.parentElement) backgrounds.push(getComputedStyle(a).backgroundColor);
    texts.push({
      label: label(el),
      text: own.slice(0, 40),
      color: isSvg ? style.fill : style.color,
      backgrounds,
      fontSize: parseFloat(style.fontSize),
      bold: Number(style.fontWeight) >= 600,
    });
  }
  return { viewportWidth, scrollWidth: document.documentElement.scrollWidth, overflowing, texts };
})()`;

export async function probePage(page: Page): Promise<Probe> {
  return (await page.evaluate(PROBE_SCRIPT)) as Probe;
}
