import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { statementSchema, type Statement } from "@agent-cost-analyzer/domain";
import type { StatementStore } from "../../services/billing/statement-store.js";

// Phase 15 step 15.11 (plan §8.5): issued statements as JSON under
// statements/<project>/<period>.json in the app's settings folder (beside
// projects.json). The project id and period key are checked against their
// schema patterns before they become a path, so no request can choose
// where to read or write. A file is created exclusively ("wx"), so a
// frozen statement is never overwritten, and only the user can read it.

export const STATEMENTS_DIR_NAME = "statements";
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PERIOD_KEY = /^\d{4}-\d{2}(-\d{2}_\d{4}-\d{2}-\d{2})?$/;

export class StatementAlreadyIssuedError extends Error {
  constructor(projectId: string, periodKey: string) {
    super(`The statement for ${projectId}, ${periodKey} is already issued; a frozen statement is never changed.`);
  }
}

export class FileStatementStore implements StatementStore {
  private readonly root: string;

  constructor(settingsDir: string) {
    this.root = path.join(settingsDir, STATEMENTS_DIR_NAME);
  }

  private folder(projectId: string): string {
    if (!PROJECT_ID.test(projectId)) throw new Error(`"${projectId}" is not a project id.`);
    return path.join(this.root, projectId);
  }

  private file(projectId: string, periodKey: string): string {
    if (!PERIOD_KEY.test(periodKey)) throw new Error(`"${periodKey}" is not a statement period.`);
    return path.join(this.folder(projectId), `${periodKey}.json`);
  }

  list(projectId: string): string[] {
    try {
      return readdirSync(this.folder(projectId))
        .filter((name) => name.endsWith(".json") && PERIOD_KEY.test(name.slice(0, -5)))
        .map((name) => name.slice(0, -5))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  read(projectId: string, periodKey: string): Statement | undefined {
    const file = this.file(projectId, periodKey);
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const parsed = statementSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${file} is not a valid statement: ${parsed.error.issues[0]?.message ?? "unknown problem"}`);
    return parsed.data;
  }

  write(statement: Statement): void {
    if (statement.status !== "issued") throw new Error("Only an issued statement is stored.");
    const file = this.file(statement.project.id, statement.period.key);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(file, `${JSON.stringify(statement, null, 2)}\n`, { encoding: "utf-8", mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new StatementAlreadyIssuedError(statement.project.id, statement.period.key);
      throw error;
    }
  }
}
