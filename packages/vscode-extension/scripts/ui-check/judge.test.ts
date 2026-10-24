import { describe, expect, it } from "vitest";
import { judgeProbe, type Probe } from "./judge.mts";

const editor = "rgb(31, 31, 31)";
const base: Probe = { viewportWidth: 1000, scrollWidth: 1000, overflowing: [], texts: [] };

describe("judgeProbe", () => {
  it("passes a page that fits and whose text reads", () => {
    const probe: Probe = { ...base, texts: [{ label: "p", text: "Hello", color: "rgb(204, 204, 204)", backgrounds: ["rgba(0, 0, 0, 0)", editor], fontSize: 13, bold: false }] };
    expect(judgeProbe(probe)).toEqual([]);
  });

  it("reports a page wider than the panel and the elements that stick out", () => {
    const probe: Probe = { ...base, scrollWidth: 1650, overflowing: ["table.table right=1292"] };
    expect(judgeProbe(probe)).toEqual([
      "overflow: page is 1650 px wide in a 1000 px panel",
      "overflow: table.table right=1292",
    ]);
  });

  it("reports text under 4.5:1 against the background it is actually painted on", () => {
    const probe: Probe = {
      ...base,
      texts: [{ label: "span.note", text: "not enough credit data", color: "rgb(0, 0, 0)", backgrounds: ["rgba(0, 0, 0, 0)", editor], fontSize: 12, bold: false }],
    };
    expect(judgeProbe(probe)).toEqual(['contrast 1.3:1 < 4.5: span.note "not enough credit data"']);
  });

  it("composites translucent grounds from the outermost in", () => {
    // Light text on a 50% white highlight over the dark editor: about 2.2:1.
    const probe: Probe = {
      ...base,
      texts: [{ label: "span", text: "x", color: "rgb(204, 204, 204)", backgrounds: ["rgba(255, 255, 255, 0.5)", editor], fontSize: 13, bold: false }],
    };
    expect(judgeProbe(probe)).toHaveLength(1);
  });

  it("lets large text pass at 3:1", () => {
    const grey = { label: "h1", text: "Title", color: "rgb(120, 120, 120)", backgrounds: [editor], bold: false };
    expect(judgeProbe({ ...base, texts: [{ ...grey, fontSize: 24 }] })).toEqual([]);
    expect(judgeProbe({ ...base, texts: [{ ...grey, fontSize: 13 }] })).toHaveLength(1);
  });

  it("reports each failing text once", () => {
    const text = { label: "td", text: "1,146", color: "rgb(0, 0, 0)", backgrounds: [editor], fontSize: 13, bold: false };
    expect(judgeProbe({ ...base, texts: [text, text] })).toHaveLength(1);
  });
});
