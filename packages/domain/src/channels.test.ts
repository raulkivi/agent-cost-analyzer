import { describe, expect, it } from "vitest";
import { CHANNEL, channelIdSchema, channelLabel, vendorApiChannel } from "./channels.js";

describe("channels", () => {
  it("names the bundled channels with stable ids", () => {
    expect(CHANNEL).toMatchObject({
      githubCopilot: "github-copilot",
      anthropicApi: "anthropic-api",
      openaiApi: "openai-api",
      googleApi: "google-api",
      xaiApi: "xai-api",
    });
  });

  it("maps a vendor to its own API channel, and an unknown vendor to none", () => {
    expect(vendorApiChannel("anthropic")).toBe("anthropic-api");
    expect(vendorApiChannel("openai")).toBe("openai-api");
    expect(vendorApiChannel("google")).toBe("google-api");
    expect(vendorApiChannel("xai")).toBe("xai-api");
    expect(vendorApiChannel("microsoft")).toBeUndefined();
    expect(vendorApiChannel("toString")).toBeUndefined();
  });

  it("labels bundled channels and shows a user channel's id as is", () => {
    expect(channelLabel("github-copilot")).toBe("GitHub Copilot");
    expect(channelLabel("anthropic-api")).toBe("Anthropic API");
    expect(channelLabel("acme-bedrock")).toBe("acme-bedrock");
  });

  it("accepts lower-case ids with hyphens only", () => {
    expect(channelIdSchema.safeParse("github-copilot").success).toBe(true);
    expect(channelIdSchema.safeParse("acme-bedrock-2").success).toBe(true);
    expect(channelIdSchema.safeParse("").success).toBe(false);
    expect(channelIdSchema.safeParse("Has Space").success).toBe(false);
  });
});
