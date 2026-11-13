// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sceneOutputs } from "./output-names.mts";

describe("sceneOutputs", () => {
  it("names the MP4 and metadata in masters and the GIF in gifs", () => {
    expect(sceneOutputs({ id: "E5", slug: "savings" }, { masters: "/m", gifs: "/g" })).toEqual({
      mp4: path.join("/m", "e5-savings.mp4"),
      gif: path.join("/g", "e5-savings.gif"),
      meta: path.join("/m", "e5-savings.json"),
    });
  });

  it("lowercases the id and handles a multi-digit id", () => {
    expect(sceneOutputs({ id: "M12", slug: "x-y" }, { masters: "m", gifs: "g" }).mp4).toBe(path.join("m", "m12-x-y.mp4"));
  });
});
