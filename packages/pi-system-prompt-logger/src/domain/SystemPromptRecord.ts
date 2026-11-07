// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
export interface SystemPromptRecord {
  sessionId: string;
  sessionFile?: string;
  capturedAt: string;
  cwd: string;
  provider?: string;
  modelId?: string;
  systemPromptChars: number;
  systemPrompt: string;
  selectedTools?: string[];
  skillNames?: string[];
  contextFilePaths?: string[];
}
