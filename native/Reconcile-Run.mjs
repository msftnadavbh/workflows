import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";
import { reconcileNativeRun } from "../dist/reconcile.mjs";

const root = fileURLToPath(new URL("..\\", import.meta.url));
const filename = resolve(process.argv[2] ?? "");
if (dirname(filename) !== join(root, "runs") || !/^envelope-[a-zA-Z0-9_-]+\.json$/.test(basename(filename))) {
  throw new Error("Only a launcher-created envelope inside this demo's runs folder may be reconciled.");
}
const envelope = JSON.parse(await readFile(filename, "utf8"));
const run = envelope?.data?.run;
if (!run || typeof run.runId !== "string"
    || !["completed", "paused", "cancelled", "error", "halted"].includes(run.status)) {
  throw new Error("The launcher envelope contains no settled native run.");
}
await reconcileNativeRun(root, run);
