import { mkdir, appendFile } from "node:fs/promises";
import type { FileSystemPort } from "../ports/FileSystemPort.js";

export class NodeFileSystem implements FileSystemPort {
  mkdir(dirPath: string, options: { recursive: true }): Promise<unknown> {
    return mkdir(dirPath, options);
  }

  appendFile(filePath: string, data: string): Promise<void> {
    return appendFile(filePath, data, "utf8");
  }
}
