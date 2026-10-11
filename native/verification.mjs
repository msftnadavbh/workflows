import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const NATIVE_VERIFICATION_FILES = [
  "demo\\core.ts", "native\\extension.ts", "native\\io.ts", "native\\reconcile.ts",
  "native\\checkpoint.mjs", "native\\Run-Sdk.mjs", "native\\verification.mjs",
  ".github\\agents\\launch-analyst.agent.md", ".github\\agents\\launch-reviewer.agent.md",
  ".github\\extensions\\launch-rescue\\extension.mjs",
  "dist\\core.mjs", "dist\\io.mjs", "dist\\reconcile.mjs",
];

export async function nativeBuildFingerprint(root) {
  const files = await Promise.all(NATIVE_VERIFICATION_FILES.map(async (path) => {
    const contents = await readFile(join(root, ...path.split("\\")));
    return [path, createHash("sha256").update(contents).digest("hex")];
  }));
  return { algorithm: "sha256", files: Object.fromEntries(files) };
}
