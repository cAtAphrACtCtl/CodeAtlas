import * as esbuild from "esbuild";
import { mkdir, rm } from "node:fs/promises";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });

    build.onEnd((result) => {
      for (const error of result.errors) {
        console.error(`✘ [ERROR] ${error.text}`);
        if (error.location) {
          console.error(`    ${error.location.file}:${error.location.line}:${error.location.column}:`);
        }
      }

      console.log("[watch] build finished");
    });
  },
};

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
  logLevel: production ? "info" : "warning",
  plugins: [esbuildProblemMatcherPlugin],
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