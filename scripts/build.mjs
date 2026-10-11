import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..\\", import.meta.url));
export function inlineApplication(template, script) {
  const marker = "<!-- BUNDLED_APPLICATION -->";
  if (!template.includes(marker)) throw new Error("HTML application marker is missing.");
  return template.replace(marker, () => `<script>${script.replaceAll("</script", "<\\/script")}</script>`);
}

async function main() {
  const template = await readFile(join(root, "demo", "index.html"), "utf8");
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, ".github", "extensions", "launch-rescue"), { recursive: true });
  await Promise.all([
    build({
      absWorkingDir: root,
      entryPoints: [join(root, "demo", "core.ts"), join(root, "demo", "local-context.ts")],
      outdir: join(root, "dist"), bundle: true, platform: "neutral", format: "esm", target: "es2022",
      outExtension: { ".js": ".mjs" }, logLevel: "warning",
    }),
    build({
      absWorkingDir: root,
      entryPoints: [join(root, "native", "extension.ts")],
      outfile: join(root, ".github", "extensions", "launch-rescue", "extension.mjs"),
      bundle: true, platform: "node", format: "esm", target: "node22",
      external: ["@github/copilot-sdk/extension"], logLevel: "warning",
    }),
    build({
      absWorkingDir: root,
      entryPoints: [join(root, "native", "io.ts")],
      outfile: join(root, "dist", "io.mjs"),
      bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning",
    }),
    build({
      absWorkingDir: root,
      entryPoints: [join(root, "native", "reconcile.ts")],
      outfile: join(root, "dist", "reconcile.mjs"),
      bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "warning",
    }),
  ]);
  const browser = await build({
    absWorkingDir: root,
    entryPoints: [join(root, "demo", "browser.ts")],
    bundle: true, platform: "browser", format: "iife", target: "es2022",
    write: false, minify: false, logLevel: "warning",
  });
  const script = browser.outputFiles[0]?.text;
  if (!script) throw new Error("Browser build produced no JavaScript.");
  const html = inlineApplication(template, script);
  const output = join(root, "Launch-Rescue-Demo.html");
  await writeFile(output, html, "utf8");
  console.log(`Built standalone HTML and native Copilot extension (${Math.round(html.length / 1024)} KB HTML).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
