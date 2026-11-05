import { z } from "zod";

// Phase 15 (docs/plans/cost-by-repository-and-project.md §3, §6.3): a
// channel is who sold the tokens and in which unit. The same model has
// different prices on different channels, so the price book (step 15.5)
// keys its versions by these ids; a user contract channel is any other id
// of the same form (the projects file's `channels`).
export const CHANNEL = {
  githubCopilot: "github-copilot",
  anthropicApi: "anthropic-api",
  openaiApi: "openai-api",
  googleApi: "google-api",
  xaiApi: "xai-api",
  moonshotApi: "moonshot-api",
} as const;

export type BundledChannelId = (typeof CHANNEL)[keyof typeof CHANNEL];

export const channelIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "channel id: lower-case letters, digits and hyphens, at most 64");

const CHANNEL_LABELS: Readonly<Record<BundledChannelId, string>> = {
  "github-copilot": "GitHub Copilot",
  "anthropic-api": "Anthropic API",
  "openai-api": "OpenAI API",
  "google-api": "Google API",
  "xai-api": "xAI API",
  "moonshot-api": "Moonshot AI API",
};

// The vendor's own API channel (VendorProfile.vendorId → channel), for
// agents that call a vendor's API directly (pi, mitmproxy captures). A
// vendor with no listed API channel has none (undefined), never a guess.
const VENDOR_API_CHANNELS: Readonly<Record<string, BundledChannelId>> = {
  anthropic: CHANNEL.anthropicApi,
  openai: CHANNEL.openaiApi,
  google: CHANNEL.googleApi,
  xai: CHANNEL.xaiApi,
  moonshot: CHANNEL.moonshotApi,
};

export function vendorApiChannel(vendorId: string): BundledChannelId | undefined {
  return Object.hasOwn(VENDOR_API_CHANNELS, vendorId) ? VENDOR_API_CHANNELS[vendorId] : undefined;
}

// A bundled channel's display name; a user channel shows its own id.
export function channelLabel(channelId: string): string {
  return Object.hasOwn(CHANNEL_LABELS, channelId) ? CHANNEL_LABELS[channelId as BundledChannelId] : channelId;
}
