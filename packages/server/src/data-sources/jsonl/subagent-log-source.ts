// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { readMainJsonlFile } from "./main-jsonl-reader.js";
import type { SubagentLogSource } from "./subagent-attribution.js";
import { listSubagentLogFiles, resolveSubagentLogPath } from "./subagent-log-path.js";

// The file-system adapter of SubagentLogSource for one session folder. Files
// stream through readMainJsonlFile, so the same attrs allow-list drops every
// prompt, response, tool and hook text (§11.2).
export function folderSubagentLogSource(sessionDir: string): SubagentLogSource {
  return {
    resolve: (childLogFile) => resolveSubagentLogPath(sessionDir, childLogFile),
    list: () => listSubagentLogFiles(sessionDir),
    read: (filePath) => readMainJsonlFile(filePath),
  };
}
