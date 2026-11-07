import { describe, expect, it, vi } from "vitest";
import { browserClipboard } from "./clipboard-port.js";

describe("browserClipboard", () => {
  it("writes through navigator.clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const port = browserClipboard({ clipboard: { writeText } });
    await port?.writeText("hello");
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("is undefined when the environment has no clipboard, so the affordance hides", () => {
    expect(browserClipboard({})).toBeUndefined();
    expect(browserClipboard(undefined)).toBeUndefined();
  });
});
