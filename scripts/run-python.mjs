import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { constants } from "node:os";

export function pythonCommand(platform = process.platform) {
  return platform === "win32" ? "python" : "python3";
}

export async function runPython(args, {
  platform = process.platform, spawnProcess = spawn, error = console.error,
} = {}) {
  const command = pythonCommand(platform);
  return await new Promise((resolve) => {
    const child = spawnProcess(command, args, { stdio: "inherit", shell: false });
    child.once("error", (cause) => {
      error(cause.code === "ENOENT"
        ? `Required interpreter "${command}" was not found. Install Python 3 and make ${command} available on PATH.`
        : `Could not start ${command}: ${cause.message}`);
      resolve(127);
    });
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1)));
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/run-python.mjs SCRIPT [ARGUMENTS]");
    process.exitCode = 1;
  } else process.exitCode = await runPython(args);
}
