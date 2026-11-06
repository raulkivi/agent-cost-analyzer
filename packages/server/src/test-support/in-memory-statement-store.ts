import type { Statement } from "@agent-cost-analyzer/domain";
import type { StatementStore } from "../services/billing/statement-store.js";

// Phase 15 step 15.11: issued statements in memory, for tests.
export class InMemoryStatementStore implements StatementStore {
  private readonly files = new Map<string, Statement>();

  list(projectId: string): string[] {
    return [...this.files.keys()].filter((key) => key.startsWith(`${projectId}/`)).map((key) => key.slice(projectId.length + 1)).sort();
  }

  read(projectId: string, periodKey: string): Statement | undefined {
    return this.files.get(`${projectId}/${periodKey}`);
  }

  write(statement: Statement): void {
    const key = `${statement.project.id}/${statement.period.key}`;
    if (this.files.has(key)) throw new Error(`The statement for ${key} is already issued.`);
    this.files.set(key, statement);
  }
}
