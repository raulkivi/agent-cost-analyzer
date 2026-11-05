import { CHANNEL, channelIdSchema, vendorApiChannel } from "@agent-cost-analyzer/domain";
import type { VendorResolution } from "./vendor-resolver.js";

// Phase 15 step 15.4 (docs/plans/cost-by-repository-and-project.md §6.3):
// which channel sold a turn's tokens. Copilot bills every VS Code turn in
// AI Credits; Claude Code is taken to use the Anthropic API (subscription
// use is API-equivalent, §5); pi and mitmproxy captures call a vendor's API
// directly, so their channel is the model vendor's API. The projects file's
// `channels.providers` overrides a provider's channel ("Claude Code here goes
// through Bedrock"). An unknown channel keeps its reason (constraint 6).

export type ChannelResolution = { known: true; channel: string } | { known: false; reason: string };

export interface ChannelQuery {
  providerId: string;
  vendor: VendorResolution;
  overrides?: Readonly<Record<string, string>>;
}

type ProviderDefault = { kind: "fixed"; channel: string } | { kind: "vendor-api" };

const PROVIDER_DEFAULTS: Readonly<Record<string, ProviderDefault>> = {
  vscode: { kind: "fixed", channel: CHANNEL.githubCopilot },
  "claude-code": { kind: "fixed", channel: CHANNEL.anthropicApi },
  "pi-agent": { kind: "vendor-api" },
  mitmproxy: { kind: "vendor-api" },
};

function override(query: ChannelQuery): string | undefined {
  const { overrides, providerId } = query;
  if (!overrides || !Object.hasOwn(overrides, providerId)) {
    return undefined;
  }
  const value = overrides[providerId];
  return channelIdSchema.safeParse(value).success ? value : undefined;
}

export function resolveChannel(query: ChannelQuery): ChannelResolution {
  const overridden = override(query);
  if (overridden) {
    return { known: true, channel: overridden };
  }
  const fallback = Object.hasOwn(PROVIDER_DEFAULTS, query.providerId) ? PROVIDER_DEFAULTS[query.providerId] : undefined;
  if (!fallback) {
    return {
      known: false,
      reason: `No channel is known for the provider "${query.providerId}"; set one under channels.providers in the projects file.`,
    };
  }
  if (fallback.kind === "fixed") {
    return { known: true, channel: fallback.channel };
  }
  if (!query.vendor.known) {
    return { known: false, reason: `This provider calls the model vendor's own API, but the vendor is unknown: ${query.vendor.reason}` };
  }
  const channel = vendorApiChannel(query.vendor.vendorId);
  return channel
    ? { known: true, channel }
    : { known: false, reason: `No API channel is listed for the vendor "${query.vendor.vendorId}"; set one under channels.providers in the projects file.` };
}
