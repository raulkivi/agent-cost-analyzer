// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Statement } from "@agent-cost-analyzer/domain";

// Phase 15 step 15.11: where issued statements are kept (DIP: the service
// depends on this port; FileStatementStore is the standalone app's).
export interface StatementStore {
  list(projectId: string): string[]; // issued period keys, sorted
  read(projectId: string, periodKey: string): Statement | undefined;
  write(statement: Statement): void; // issued only; never overwrites
}
