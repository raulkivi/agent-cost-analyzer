/**
 * The narrow slice of filesystem behavior JsonlFileSink needs.
 * Kept separate from node:fs so tests can supply an in-memory fake.
 */
export interface FileSystemPort {
  mkdir(dirPath: string, options: { recursive: true }): Promise<unknown>;
  appendFile(filePath: string, data: string): Promise<void>;
}
