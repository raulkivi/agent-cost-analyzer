import { dirname } from "node:path";
import type { SystemPromptRecord } from "../domain/SystemPromptRecord.js";
import type { FileSystemPort } from "../ports/FileSystemPort.js";
import type { SystemPromptSink } from "../ports/SystemPromptSink.js";

export class JsonlFileSink implements SystemPromptSink {
  constructor(
    private readonly filePath: string,
    private readonly fs: FileSystemPort,
  ) {}

  async write(record: SystemPromptRecord): Promise<void> {
    await this.fs.mkdir(dirname(this.filePath), { recursive: true });
    await this.fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`);
  }
}
