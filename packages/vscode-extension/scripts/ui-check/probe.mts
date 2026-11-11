// What the UI check reads from the page (step 10.11). The browser only
// reports positions and computed colours; judge.mts decides. A string, not a
// function: the transpiler's helpers don't exist in the page.
import type { Page } from "playwright";
import type { Probe } from "./judge.mts";

export const PROBE_SCRIPT = `(() => {
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
  // Chart marks (chart-marks.ts): svg shapes and html bars that carry data,
  // found by the series attributes the chart components set, plus the legend
  // swatches. Gridlines, bands, crosshairs and transparent hit areas are not
  // data and are not marks.
  const SERIES_ATTRS = ["data-line", "data-status", "data-segment", "data-bar", "data-step"];
  const seriesOf = (el) => {
    for (const name of SERIES_ATTRS) {
      const owner = el.closest("[" + name + "]");
      if (owner) return owner.getAttribute(name);
    }
    return "";
  };
  const chartOf = (el) => {
    const named = el.closest("[role='group'][aria-label], [role='img'][aria-label], .hbars[aria-label], .chart[aria-label]");
    const name = named ? named.getAttribute("aria-label") : (el.closest("svg") || {getAttribute: () => null}).getAttribute("aria-label");
    return (name || "chart").split(". Arrow")[0].slice(0, 60);
  };
  // From the parent: a bar's own background is its paint, not its ground.
  const backgroundsOf = (el) => {
    const out = [];
    for (let a = el.parentElement; a; a = a.parentElement) out.push(getComputedStyle(a).backgroundColor);
    return out;
  };
  const patternOf = (el) => {
    const m = /url\\(["']?#([^"')]+)["']?\\)/.exec(getComputedStyle(el).fill);
    return m ? document.getElementById(m[1]) : null;
  };
  const marks = [];
  const pushMark = (el, kind, paint, cue, labelled) => {
    marks.push({ chart: chartOf(el), series: seriesOf(el), kind, paint, backgrounds: backgroundsOf(el), cue, labelled });
  };
  for (const el of document.body.querySelectorAll("svg path, svg rect, svg circle, svg polyline")) {
    if (!shown(el) || el.closest("defs")) continue;
    const cls = typeof el.className === "string" ? el.className : (el.getAttribute("class") || "");
    if (/(grid|baseline|band|crosshair|axis|link|marker-line)/.test(cls)) continue;
    const svg = el.closest("svg");
    const style = getComputedStyle(el);
    const series = seriesOf(el);
    const isChart = svg.classList.contains("chart-svg") || svg.classList.contains("waterfall") || svg.getAttribute("role") === "img" && svg.hasAttribute("aria-label");
    if (!isChart) continue;
    const labelled = el.hasAttribute("data-step") || !!svg.querySelector("[data-direct-label]");
    const pattern = patternOf(el);
    if (pattern) {
      const tile = pattern.querySelector("rect[data-series-fill]");
      const hatch = pattern.querySelector("line, path, circle");
      if (tile) {
        // A series drawn as a patterned tile: the tile's colour is the bar,
        // the hatching on it the cue, and must show against the tile.
        const tileFill = getComputedStyle(tile).fill;
        const cue = "pattern:" + pattern.id;
        pushMark(el, "bar", tileFill, cue, labelled);
        if (hatch) {
          const hatchPaint = hatch.tagName === "circle" ? getComputedStyle(hatch).fill : getComputedStyle(hatch).stroke;
          marks.push({ chart: chartOf(el), series: seriesOf(el), kind: "hatch", paint: hatchPaint, backgrounds: [tileFill, ...backgroundsOf(el)], cue, labelled });
        }
      } else if (hatch) {
        pushMark(el, "hatch", getComputedStyle(hatch).stroke, "pattern", labelled);
      }
      continue;
    }
    const filled = style.fill !== "none" && style.fill !== "rgba(0, 0, 0, 0)" && !/^url/.test(style.fill) && el.getAttribute("fill") !== "transparent";
    const stroked = style.stroke !== "none" && parseFloat(style.strokeWidth) > 0;
    if (el.tagName === "circle") {
      pushMark(el, "marker", filled ? style.fill : style.stroke, "", labelled);
    } else if (el.tagName === "path" && stroked && !filled) {
      pushMark(el, "line", style.stroke, style.strokeDasharray === "none" ? "" : style.strokeDasharray, labelled);
    } else if (filled && series) {
      pushMark(el, "bar", style.fill, "", labelled);
    } else if (filled && el.tagName === "path") {
      pushMark(el, "bar", style.fill, "", labelled);
    }
  }
  // Html bars. A bar alone in its row (a replay bar, one segment of a row) is
  // named by the row's label; segments stacked in a row only by the legend.
  for (const el of document.body.querySelectorAll("[data-segment], [data-bar]")) {
    if (!shown(el)) continue;
    const row = el.closest(".hbar-row, [data-row]");
    const alone = !!row && row.querySelectorAll("[data-segment], [data-bar]").length === 1;
    const image = getComputedStyle(el).backgroundImage;
    pushMark(el, "bar", getComputedStyle(el).backgroundColor, image === "none" ? "" : image, alone);
  }
  for (const el of document.body.querySelectorAll(".chart-legend-swatch, .cost-tooltip-key")) {
    if (!shown(el)) continue;
    const item = el.closest("li");
    marks.push({ chart: "legend", series: item ? item.textContent.trim().slice(0, 30) : "", kind: "swatch", paint: getComputedStyle(el).backgroundColor, backgrounds: backgroundsOf(el.parentElement), cue: "", labelled: true });
  }
  return { viewportWidth, scrollWidth: document.documentElement.scrollWidth, overflowing, texts, marks };
})()`;

export async function probePage(page: Page): Promise<Probe> {
  return (await page.evaluate(PROBE_SCRIPT)) as Probe;
}
