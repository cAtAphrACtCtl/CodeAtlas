import * as esbuild from "esbuild";
import { mkdir, rm } from "node:fs/promises";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: production ? false : "linked",
  sourcesContent: false,
  platform: "node",
  target: "node20",
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  logLevel: "info",
};

async function main() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("dist", { recursive: true });

  const context = await esbuild.context(buildOptions);

  if (watch) {
    await context.watch();
    return;
  }

  await context.rebuild();
  await context.dispose();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});