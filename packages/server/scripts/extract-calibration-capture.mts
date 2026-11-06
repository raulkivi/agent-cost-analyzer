// Reduces one past Copilot Chat session to a calibration capture (plan step
// 13.5a): numbers only, no text, titles or paths.
//
//   npx tsx scripts/extract-calibration-capture.mts copilot <sessionId> <outFile> \
//     [--user-data-dir <dir>] [--copilot-home <dir>] [--model-prefix claude] \
//     [--model-id <price-table id>] [--limit <n>]
//
// A local-harness session is read from its debug log (main.jsonl); an Agent
// Host session from the Copilot CLI event log its catalog row points to.
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { calibrationCaptureSchema } from "../src/services/learn-simulation/calibration/capture.ts";
import {
  captureFromAgentHostEvents,
  captureFromCopilotRequests,
  type CopilotCaptureOptions,
  type CopilotRequestUsage,
} from "../src/services/learn-simulation/calibration/extract-copilot-capture.ts";
import { agentHostDbPath } from "../src/data-sources/agent-host/agent-host-paths.ts";
import {
  getAgentHostSessionRow,
  readAgentHostSdkSessionId,
} from "../src/data-sources/agent-host/agent-host-catalog.ts";
import {
  copilotEventLogPath,
  resolveCopilotHome,
} from "../src/data-sources/agent-host/copilot-cli-paths.ts";
import { readCopilotEventLog } from "../src/data-sources/agent-host/copilot-event-log-reader.ts";
import { extractLlmRequestUsage } from "../src/data-sources/jsonl/llm-request-extractor.ts";
import { readMainJsonlEnvelopes } from "../src/data-sources/jsonl/main-jsonl-reader.ts";
import {
  listWorkspaceDebugLogsDirPaths,
  resolveMainJsonlPath,
} from "../src/data-sources/jsonl/session-log-path.ts";
import { loadAgentTraceUsageForResponseIds } from "../src/data-sources/agent-traces/agent-traces-reader.ts";
import { resolveAgentTracesDbPath } from "../src/data-sources/agent-traces/agent-traces-db-path.ts";
import { resolveUserDataDir } from "../src/platform/vscode-paths/resolve-user-data-dir.ts";
import { openReadOnlyDb } from "../src/data-sources/sqlite/session-store.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    "user-data-dir": { type: "string" },
    "copilot-home": { type: "string" },
    "model-prefix": { type: "string", default: "claude" },
    "model-id": { type: "string" },
    limit: { type: "string" },
  },
});
const [command, sessionId, outFile] = positionals;
if (command !== "copilot" || !sessionId || !outFile) {
  console.error(
    "Usage: extract-calibration-capture.mts copilot <sessionId> <outFile> [options]",
  );
  process.exit(2);
}

const userDataDir = values["user-data-dir"] ?? resolveUserDataDir();
if (userDataDir === null)
  throw new Error("No VS Code user-data dir found; pass --user-data-dir");
const shortId = sessionId.slice(0, 8);
const common = {
  id: `copilot-${shortId}`,
  modelPrefix: values["model-prefix"],
  limit: values.limit === undefined ? undefined : Number(values.limit),
};

async function fromLocal(
  mainJsonl: string,
): Promise<ReturnType<typeof captureFromCopilotRequests>> {
  const envelopes = await readMainJsonlEnvelopes(mainJsonl);
  const rows = envelopes.flatMap((envelope) => {
    const usage = extractLlmRequestUsage(envelope);
    return usage === null || envelope.ts === undefined
      ? []
      : [{ envelope, usage }];
  });
  const writes = loadAgentTraceUsageForResponseIds(
    resolveAgentTracesDbPath({ homeDir: os.homedir() }),
    rows.flatMap((row) =>
      row.usage.responseId === null ? [] : [row.usage.responseId],
    ),
  );
  const requests: CopilotRequestUsage[] = rows.map(({ envelope, usage }) => {
    const write =
      usage.responseId === null ? undefined : writes.get(usage.responseId);
    return {
      startedAtMs: envelope.ts!,
      model: usage.model,
      inputTokens: usage.uncachedInput + usage.cacheRead,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: write === undefined ? null : write.cacheWrite,
      outputTokens: usage.output,
    };
  });
  const modelId =
    values["model-id"] ??
    requests.find((r) => r.model.startsWith(common.modelPrefix ?? ""))?.model ??
    "unknown";
  return captureFromCopilotRequests(requests, {
    ...common,
    source: "copilot-local",
    harness: "vscode-local",
    modelId,
  } satisfies CopilotCaptureOptions);
}

async function fromAgentHost(): Promise<
  ReturnType<typeof captureFromAgentHostEvents>
> {
  const db = openReadOnlyDb(agentHostDbPath(userDataDir!));
  const row = getAgentHostSessionRow(db, sessionId!);
  if (row === undefined)
    throw new Error(`No local or Agent Host session "${shortId}…" found`);
  const sdkId = readAgentHostSdkSessionId(db, `copilotcli:/${sessionId}`);
  const logPath =
    sdkId === null
      ? null
      : copilotEventLogPath(
          values["copilot-home"] ?? resolveCopilotHome(),
          sdkId,
        );
  const log =
    logPath === null
      ? null
      : await readCopilotEventLog(logPath, {
          include: (type) => type === "session.usage_record",
        });
  if (log === null)
    throw new Error(
      "This Agent Host session has no readable Copilot CLI event log",
    );
  const model = values["model-id"] ?? "unknown";
  return captureFromAgentHostEvents(log.events, {
    ...common,
    source: "copilot-agent-host",
    harness: "copilot-agent-host",
    modelId: model,
  });
}

const debugDirs = listWorkspaceDebugLogsDirPaths({ userDataDir });
const mainJsonl = resolveMainJsonlPath(debugDirs, sessionId);
const capture = calibrationCaptureSchema.parse(
  mainJsonl === null ? await fromAgentHost() : await fromLocal(mainJsonl),
);
writeFileSync(path.resolve(outFile), `${JSON.stringify(capture, null, 2)}\n`);
console.log(
  `${capture.id}: ${capture.requests.length} requests, source ${capture.source}`,
);
