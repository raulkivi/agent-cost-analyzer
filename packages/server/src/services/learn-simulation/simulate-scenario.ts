import {
  sumTokenCounts,
  unavailableTokenCount,
  type CachingKind,
  type Harness,
  type Layer,
  type ModelPrice,
  type ScenarioScript,
  type ScriptEvent,
  type Session,
  type TokenCount,
  type TriggeredEvent,
  type Turn,
  type VendorProfile,
} from "@agent-cost-analyzer/domain";
import { isKnown, type CacheModel } from "./cache-model.js";
import { createCacheModel } from "./cache-models/index.js";
import { imageTokens } from "./image-tokens.js";
import { InvalidationPolicy } from "./invalidation-policy.js";
import { priceTurn } from "./pricer.js";
import { buildPrompt } from "./prompt-builder.js";

export interface SimulateOptions {
  profile: VendorProfile;
  modelId: string;
  harness: Harness;
  // Cache lifetime for best-effort vendors; no doc states one (D5).
  assumedTtlMinutes?: number;
  // Apply what a harness does on its own, unless told otherwise. Claude Code
  // requests the 1-hour cache lifetime (its logs show it on 186 of 188
  // sessions, docs/plans/learn-calibration-findings.md); the scenario docs
  // turn this off to teach the vendor's own default.
  harnessCacheDefaults?: boolean;
}

const DEFAULT_GAP_MINUTES = 1;
const HARNESSES_WITH_LONG_CACHE: Harness[] = ["claude-code"];
const DEFAULT_ASSUMED_TTL_MINUTES = 5;
const UNKNOWN_REASON = (vendor: string): string =>
  `${vendor}'s cache behaviour for this turn is unknown, so it isn't simulated.`;

const TRIGGER: Partial<Record<ScriptEvent["type"], TriggeredEvent>> = {
  "model-switch": "model-switch",
  "tools-changed": "tool-change",
  "system-changed": "instructions-change",
  "image-added": "image-change",
  "image-removed": "image-change",
  "thinking-changed": "reasoning-toggle",
  compaction: "compaction",
  clear: "clear",
  rewind: "rewind",
  fork: "fork",
};

const known = (value: number): TokenCount => ({ known: true, value });

// Which of the two model roles the session starts on: a script's first
// model-switch event says where it ends up, so it starts on the other role.
function initialRole(script: ScenarioScript): "primary" | "cheaper" {
  const first = script.steps
    .flatMap((s) => s.events)
    .find((e) => e.type === "model-switch");
  if (first === undefined || first.type !== "model-switch") return "primary";
  const onFirstStep = script.steps[0]?.events.includes(first) === true;
  if (onFirstStep) return first.toRole;
  return first.toRole === "primary" ? "cheaper" : "primary";
}

export function simulateScenario(
  script: ScenarioScript,
  options: SimulateOptions,
): Session {
  const { profile, harness } = options;
  if (!script.harnesses.includes(harness)) {
    throw new Error(
      `Scenario "${script.id}" does not apply to harness "${harness}"`,
    );
  }
  const primary = findModel(profile, options.modelId);
  const cheaper = primary.cheaperSiblingId
    ? findModel(profile, primary.cheaperSiblingId)
    : undefined;
  const policy = new InvalidationPolicy(profile);
  // A harness with a long cache lifetime has its own break lengths and
  // wording (the scripts that teach cache expiry); with its defaults off the
  // script's vendor-default story applies instead.
  const harnessDefaults = options.harnessCacheDefaults !== false;
  const text =
    harnessDefaults || !HARNESSES_WITH_LONG_CACHE.includes(harness)
      ? script.textByHarness?.[harness]
      : undefined;
  const caches = new Map<string, CacheModel>();
  const cacheFor = (model: ModelPrice): CacheModel => {
    let cache = caches.get(model.modelId);
    if (cache === undefined) {
      const kind: CachingKind = model.cachingKind ?? profile.caching;
      cache = createCacheModel(kind, {
        assumedTtlMinutes:
          options.assumedTtlMinutes ?? DEFAULT_ASSUMED_TTL_MINUTES,
      });
      caches.set(model.modelId, cache);
    }
    return cache;
  };

  let role = initialRole(script);
  let tools = script.staticPrefix.toolsTokens;
  let system = script.staticPrefix.systemTokens;
  let messages = 0;
  let clock = 0;
  let extendedTtl =
    harnessDefaults && HARNESSES_WITH_LONG_CACHE.includes(harness);
  let afterCompaction = false;
  const messagesAfter = new Map<number, number>();
  const turns: Turn[] = [];

  const idleFor = (
    step: ScenarioScript["steps"][number],
    position: number,
  ): number | undefined =>
    text?.idleMinutes?.[position] ?? step.idleMinutesBefore;

  script.steps.forEach((step, position) => {
    const events = step.events;
    let sharedPrefix: number | undefined;

    for (const event of events) {
      switch (event.type) {
        case "tools-changed":
          tools += event.deltaTokens;
          break;
        case "system-changed":
          system += event.deltaTokens;
          break;
        case "model-switch":
          role = event.toRole;
          break;
        case "extended-ttl":
          extendedTtl = true;
          break;
        case "clear":
          messages = 0;
          break;
        case "rewind":
          messages = stateAfter(
            messagesAfter,
            event.toStep,
            step.index,
            "toStep",
          );
          sharedPrefix = tools + system + messages;
          break;
        case "fork":
          messages = stateAfter(
            messagesAfter,
            event.fromStep,
            step.index,
            "fromStep",
          );
          sharedPrefix = tools + system + messages;
          break;
        default:
          break;
      }
    }

    const model = role === "cheaper" ? requireModel(cheaper, primary) : primary;
    clock +=
      position === 0
        ? (idleFor(step, position) ?? 0)
        : (idleFor(step, position) ?? DEFAULT_GAP_MINUTES);

    const images = (step.newContent.images ?? []).map((img) =>
      imageTokens(profile.vendorId, img),
    );
    const imageTotal = images.reduce((sum, img) => sum + img.tokens, 0);
    const prompt = buildPrompt({
      tools,
      system,
      messages:
        messages +
        step.newContent.userTokens +
        step.newContent.toolResultTokens +
        imageTotal,
    });

    // Compaction and fork/rewind sequencing is done here (the request reads
    // the warm prefix / the shared prefix), so only the rest goes to the policy.
    const policyEvents = events.filter(
      (e) =>
        e.type !== "compaction" && e.type !== "rewind" && e.type !== "fork",
    );
    const verdict = policy.evaluate(policyEvents);
    let invalidatedFrom: Layer | undefined = verdict.invalidatedFrom;
    if (afterCompaction)
      invalidatedFrom = earlierLayer(invalidatedFrom, "messages");

    const result = cacheFor(model).request({
      prompt,
      atMinute: clock,
      invalidatedFrom,
      extendedTtl,
      sharedPrefixTokens: sharedPrefix,
    });

    const unknown = !isKnown(result) || verdict.unknown;
    const output =
      step.newContent.outputTokens + step.newContent.reasoningTokens;
    const reason = UNKNOWN_REASON(profile.displayName);

    let usage: Turn["usage"];
    if (!isKnown(result) || unknown) {
      const na = unavailableTokenCount(reason);
      usage = {
        uncachedInput: na,
        cacheWrite: na,
        cacheRead: na,
        tool: known(step.newContent.toolResultTokens),
        vision: known(imageTotal),
        reasoning: known(step.newContent.reasoningTokens),
        output: known(step.newContent.outputTokens),
        costAiCredits: na,
        model: model.modelId,
        roundsCount: 1,
      };
    } else {
      const cost = priceTurn(model, {
        uncachedInput: result.uncachedInput,
        cacheRead: result.cacheRead,
        cacheWrite: result.cacheWrite,
        extendedCacheWrite: result.extendedCacheWrite,
        output,
      });
      usage = {
        uncachedInput: known(result.uncachedInput),
        cacheWrite: known(result.cacheWrite + result.extendedCacheWrite),
        cacheRead: known(result.cacheRead),
        // Attribution within the input counts above, not an extra charge.
        tool: known(step.newContent.toolResultTokens),
        vision: known(imageTotal),
        reasoning: known(step.newContent.reasoningTokens),
        output: known(step.newContent.outputTokens),
        costAiCredits: known(cost.aiCredits),
        model: model.modelId,
        roundsCount: 1,
      };
    }

    const outcome = unknown
      ? "unknown"
      : (result as { outcome: "hit" | "partial" | "miss" }).outcome;
    const explicitTrigger = events
      .map((e) => TRIGGER[e.type])
      .find((t) => t !== undefined);
    const triggeredEvent: TriggeredEvent | undefined =
      explicitTrigger ??
      (position > 0 && outcome === "miss" ? "cache-expiry" : undefined);

    const confidence = unknown
      ? "unknown"
      : verdict.sourceIds.length === 0 && verdict.confidence === "documented"
        ? "inferred"
        : verdict.confidence;
    turns.push({
      index: step.index,
      userMessage: text?.userMessages?.[position] ?? step.userMessage,
      assistantResponse: step.assistantResponse,
      toolCalls: step.toolCalls,
      usage,
      explanation: text?.explanations?.[position] ?? step.explanation,
      ...(triggeredEvent ? { triggeredEvent } : {}),
      simulation: {
        vendorId: profile.vendorId,
        modelId: model.modelId,
        cacheOutcome: outcome,
        ...(invalidatedFrom && !unknown ? { invalidatedFrom } : {}),
        note: narrate(model, outcome, invalidatedFrom, unknown, usage),
        confidence,
        sourceIds:
          unknown ||
          (confidence === "inferred" && verdict.sourceIds.length === 0)
            ? []
            : verdict.sourceIds,
      },
    });

    afterCompaction = false;
    messages =
      prompt.segments[2]!.end -
      prompt.segments[2]!.start +
      step.newContent.outputTokens;
    const compaction = events.find((e) => e.type === "compaction");
    if (compaction?.type === "compaction") {
      messages = compaction.summaryTokens;
      afterCompaction = true;
    }
    messagesAfter.set(step.index, messages);
  });

  return {
    id: script.id,
    mode: "learn",
    title: text?.title ?? script.title,
    model: primary.modelId,
    turns,
    turnCount: turns.length,
    costAiCredits: sumTokenCounts(
      turns.map((t) => t.usage.costAiCredits),
      "At least one turn's cost is unknown for this vendor.",
    ),
    usageDataAvailable: true,
    category: script.category,
  };
}

function findModel(profile: VendorProfile, modelId: string): ModelPrice {
  const model = profile.models.find((m) => m.modelId === modelId);
  if (model === undefined)
    throw new Error(
      `Model "${modelId}" is not in the ${profile.vendorId} profile`,
    );
  return model;
}

// A scenario that switches model needs a curated cheaper sibling (D4); a
// vendor without one is reported, never faked.
export class NoCheaperModelError extends Error {
  constructor(modelId: string) {
    super(
      `Model "${modelId}" has no cheaper sibling, so this scenario can't be simulated on it`,
    );
  }
}

function requireModel(
  cheaper: ModelPrice | undefined,
  primary: ModelPrice,
): ModelPrice {
  if (cheaper === undefined) throw new NoCheaperModelError(primary.modelId);
  return cheaper;
}

function stateAfter(
  saved: Map<number, number>,
  target: number,
  current: number,
  field: string,
): number {
  const messages = saved.get(target);
  if (target >= current || messages === undefined) {
    throw new Error(
      `${field} ${target} must point at an earlier step than step ${current}`,
    );
  }
  return messages;
}

const LAYERS: Layer[] = ["tools", "system", "messages"];
function earlierLayer(a: Layer | undefined, b: Layer): Layer {
  return a === undefined || LAYERS.indexOf(b) < LAYERS.indexOf(a) ? b : a;
}

function narrate(
  model: ModelPrice,
  outcome: string,
  invalidatedFrom: Layer | undefined,
  unknown: boolean,
  usage: Turn["usage"],
): string {
  if (unknown)
    return `On ${model.displayName}: the cache outcome for this turn is unknown.`;
  const read = usage.cacheRead.known
    ? usage.cacheRead.value.toLocaleString("en-US")
    : "?";
  const from = invalidatedFrom ? ` from the ${invalidatedFrom} layer` : "";
  switch (outcome) {
    case "hit":
      return `On ${model.displayName}: cache hit, ${read} tokens read from cache.`;
    case "partial":
      return `On ${model.displayName}: the cache was invalidated${from}; ${read} tokens were still read from cache.`;
    default:
      return `On ${model.displayName}: cache miss, nothing was read from cache${from ? ` (invalidated${from})` : ""}.`;
  }
}
