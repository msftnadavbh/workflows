import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import test from "node:test";
import { browserSettings } from "../scripts/browser-runtime.mjs";
import { pythonCommand, runPython } from "../scripts/run-python.mjs";
import { nativeBuildFingerprint, NATIVE_VERIFICATION_FILES } from "../native/verification.mjs";

test("Python selection is explicit for Windows and macOS", () => {
  assert.equal(pythonCommand("win32"), "python");
  assert.equal(pythonCommand("darwin"), "python3");
});

test("Python arguments, terminal I/O, and exit status are preserved without a shell", async () => {
  let invocation;
  const result = await runPython(["script with spaces.py", "argument with spaces"], {
    platform: "darwin",
    spawnProcess: (command, args, options) => {
      invocation = { command, args, options };
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("exit", 17, null));
      return child;
    },
  });
  assert.deepEqual(invocation, {
    command: "python3", args: ["script with spaces.py", "argument with spaces"],
    options: { stdio: "inherit", shell: false },
  });
  assert.equal(result, 17);
});

test("missing Python is an explicit error, not a fallback interpreter", async () => {
  const messages = [];
  const result = await runPython(["fixture.py"], {
    platform: "darwin", error: (message) => messages.push(message),
    spawnProcess: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" })));
      return child;
    },
  });
  assert.equal(result, 127);
  assert.match(messages[0], /python3.*not found/);
});

test("browser tests and native E2E select Edge on Windows and provisioned Chromium on macOS", () => {
  assert.deepEqual(browserSettings("win32"), { name: "Microsoft Edge", launch: { channel: "msedge" } });
  assert.deepEqual(browserSettings("darwin"), { name: "Playwright Chromium", launch: {} });
  assert.throws(() => browserSettings("unsupported"), /No browser was substituted/);
});

test("native fingerprint keys stay unchanged while files are resolved from actual components", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "launch fingerprint with spaces-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const expected = {};
  for (const identifier of NATIVE_VERIFICATION_FILES) {
    const file = join(root, ...identifier.split("\\"));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, identifier);
    expected[identifier] = createHash("sha256").update(identifier).digest("hex");
  }
  assert.deepEqual((await nativeBuildFingerprint(root)).files, expected);
  assert.ok(Object.hasOwn(expected, "demo\\core.ts"));
  assert.equal(posix.join(...NATIVE_VERIFICATION_FILES[0].split("\\")), "demo/core.ts");
});

test("shell-facing npm commands contain no Windows-only path separators and preserve SDK pinning", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const [name, command] of Object.entries(manifest.scripts)) {
    assert.ok(!command.includes("\\"), `Nonportable npm command: ${name}`);
  }
  assert.equal(manifest.devDependencies["@github/copilot-sdk"], "1.0.19");
  assert.equal(manifest.scripts.native, "node native/Run-Sdk.mjs");
});
