import { readFile } from "node:fs/promises";
import path from "node:path";

import { CodeAtlasError, invariant } from "../common/errors.js";
import type { ReadSourceResponse } from "../contracts/search.js";
import type { RepositoryRecord } from "../registry/repository-registry.js";
import type { SourceReader } from "./source-reader.js";

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export class FileSystemSourceReader implements SourceReader {
  async readRange(repository: RepositoryRecord, relativePath: string, startLine: number, endLine: number): Promise<ReadSourceResponse> {
    invariant(startLine >= 1, "start_line must be >= 1");
    invariant(endLine >= startLine, "end_line must be >= start_line");

    const resolvedPath = path.resolve(repository.rootPath, relativePath);
    const relativeFromRoot = path.relative(repository.rootPath, resolvedPath);

    if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
      throw new CodeAtlasError("Requested path escapes repository root");
    }

    const fileContents = await readFile(resolvedPath, "utf8");
    const lines = fileContents.split(/\r?\n/);
    const safeEndLine = Math.min(endLine, lines.length);
    const content = lines.slice(startLine - 1, safeEndLine).join("\n");

    return {
      repo: repository.name,
      path: toPosixPath(relativeFromRoot),
      start_line: startLine,
      end_line: safeEndLine,
      content,
    };
  }
}