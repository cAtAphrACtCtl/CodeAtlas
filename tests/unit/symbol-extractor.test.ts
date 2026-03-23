import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { TypeScriptSymbolExtractor } from "../../packages/core/src/search/symbol-extractor.js";

test("TypeScriptSymbolExtractor returns accurate line ranges for nested symbols", async () => {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "codeatlas-symbol-extractor-"));
  await mkdir(path.join(repositoryRoot, "src"), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, "src", "feature.ts"),
    [
      "export class AtlasBuilder {",
      "  buildAtlas() {",
      "    return true;",
      "  }",
      "}",
    ].join("\n"),
    "utf8",
  );

  const extractor = new TypeScriptSymbolExtractor();
  const symbols = await extractor.extractRepository({
    name: "sample",
    rootPath: repositoryRoot,
    registeredAt: new Date().toISOString(),
  });

  const atlasBuilder = symbols.find((symbol) => symbol.name === "AtlasBuilder");
  const buildAtlas = symbols.find((symbol) => symbol.name === "buildAtlas");

  assert.ok(atlasBuilder);
  assert.equal(atlasBuilder?.start_line, 1);
  assert.equal(atlasBuilder?.end_line, 5);
  assert.ok(buildAtlas);
  assert.equal(buildAtlas?.start_line, 2);
  assert.equal(buildAtlas?.end_line, 4);
  assert.equal(buildAtlas?.container_name, "AtlasBuilder");
});