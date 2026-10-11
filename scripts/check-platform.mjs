import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";

const { values } = parseArgs({ options: {
  platform: { type: "string" }, arch: { type: "string" },
}, strict: true, allowPositionals: false });
if (values.platform) assert.equal(process.platform, values.platform, "The CI runner is not on the requested operating system.");
if (values.arch) assert.equal(process.arch, values.arch, "The CI runner architecture differs from the requested architecture.");
if (process.env.RUNNER_ARCH) {
  assert.equal(process.arch, process.env.RUNNER_ARCH.toLowerCase(), "Node is not running in the CI runner's native architecture.");
}
const name = `@github/copilot-sdk-${process.platform}-${process.arch}`;
const runtime = JSON.parse(await readFile(fileURLToPath(import.meta.resolve(`${name}/package.json`)), "utf8"));
assert.equal(runtime.version, "1.0.19", "The native runtime package must match the pinned SDK.");
assert.ok(runtime.os.includes(process.platform));
assert.ok(runtime.cpu.includes(process.arch));
console.log(`Runner: ${process.platform}/${process.arch}; native package: ${name}@${runtime.version}.`);
const client = new CopilotClient({ connection: RuntimeConnection.forStdio(), logLevel: "error" });
try {
  await client.start();
  const status = await client.getStatus();
  assert.equal(status.version, "1.0.95", "The SDK must start its pinned runtime without substituting another version.");
  console.log(`Native runtime started: ${status.version}; no session or model call was created.`);
} finally {
  const errors = await client.stop();
  if (errors.length) throw new AggregateError(errors, "Platform runtime probe cleanup failed.");
}
