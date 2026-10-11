import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { browserCommand, launchDemo, openBrowser, validatePort } from "../scripts/launch.mjs";

const fixtureServer = `
import { createServer } from "node:http";
const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ ready: true, version: "1.0.0", pid: process.pid }));
});
server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
server.listen(Number(process.env.DEMO_PORT), "127.0.0.1");
`;

async function fixture(context, source = fixtureServer) {
  const directory = await mkdtemp(join(tmpdir(), "launch rescue with spaces-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "demo"));
  await writeFile(join(directory, "Launch-Rescue-Demo.html"), "<h1>Launch fixture</h1>");
  await writeFile(join(directory, "demo", "server.mjs"), source);
  return directory;
}

async function port() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}

test("launcher preserves the default port and accepted range", () => {
  assert.equal(validatePort(4173), 4173);
  assert.equal(validatePort(1024), 1024);
  assert.equal(validatePort(65535), 65535);
  for (const invalid of [0, 1023, 65536, -1, NaN, 4173.5]) assert.throws(() => validatePort(invalid));
});

test("launcher opens the browser only after health identifies its own child, including paths with spaces", async (context) => {
  const directory = await fixture(context);
  const selectedPort = await port();
  let child;
  let opened = 0;
  const before = process.env.DEMO_PORT;
  const launcher = await launchDemo({
    directory, port: selectedPort, signals: new EventEmitter(), log: () => {},
    spawnProcess: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [join(directory, "demo", "server.mjs")]);
      assert.equal(options.shell, false);
      child = spawn(command, args, options);
      return child;
    },
    browser: async (url) => {
      assert.equal(url, `http://127.0.0.1:${selectedPort}/?scoutTheme=dark`);
      const health = await (await fetch(`http://127.0.0.1:${selectedPort}/health`)).json();
      assert.equal(health.pid, child.pid);
      opened++;
    },
  });
  context.after(launcher.stop);
  assert.equal(launcher.pid, child.pid);
  assert.equal(opened, 1);
  assert.equal(process.env.DEMO_PORT, before);
  await launcher.stop();
});

test("no-browser mode starts a responsive server without invoking a browser", async (context) => {
  const directory = await fixture(context);
  const launcher = await launchDemo({
    directory, port: await port(), noBrowser: true, signals: new EventEmitter(), log: () => {},
    browser: () => { throw new Error("No browser may start."); },
  });
  context.after(launcher.stop);
  assert.equal((await (await fetch(new URL("/health", launcher.url))).json()).pid, launcher.pid);
  await launcher.stop();
});

test("the shared launcher starts the real read-only observer without model calls", async (context) => {
  const directory = fileURLToPath(new URL("..", import.meta.url));
  const launcher = await launchDemo({
    directory, port: await port(), noBrowser: true, signals: new EventEmitter(), log: () => {},
  });
  context.after(launcher.stop);
  const health = await (await fetch(new URL("/health", launcher.url))).json();
  assert.equal(health.pid, launcher.pid);
  assert.equal(health.nativeObserver, true);
  assert.equal((await fetch(new URL("/api/native/latest", launcher.url))).status, 200);
  assert.equal((await fetch(new URL("/", launcher.url), { method: "POST" })).status, 405);
  await launcher.stop();
});

test("startup failure is explicit and preserves the child exit code", async (context) => {
  const directory = await fixture(context, 'console.error("Fixture startup failure"); process.exit(23);');
  await assert.rejects(launchDemo({
    directory, port: await port(), signals: new EventEmitter(), log: () => {},
    browser: () => { throw new Error("No browser may start."); },
  }), (error) => error.exitCode === 23 && /Fixture startup failure/.test(error.message));
});

test("a foreign port never opens the browser or stops the foreign process", async (context) => {
  const directory = await fixture(context);
  const foreign = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ready: true, version: "1.0.0", pid: process.pid }));
  });
  foreign.listen(0, "127.0.0.1");
  await once(foreign, "listening");
  context.after(() => new Promise((resolve) => foreign.close(resolve)));
  const selectedPort = foreign.address().port;
  await assert.rejects(launchDemo({
    directory, port: selectedPort, signals: new EventEmitter(), log: () => {},
    browser: () => { throw new Error("No browser may start."); },
  }), /another server|exited before becoming ready/);
  assert.equal((await (await fetch(`http://127.0.0.1:${selectedPort}/health`)).json()).pid, process.pid);
  assert.ok(foreign.listening);
});

test("interruption cleans up only the owned server and removes signal handlers", async (context) => {
  const directory = await fixture(context);
  const signals = new EventEmitter();
  const launcher = await launchDemo({ directory, port: await port(), noBrowser: true, signals, log: () => {} });
  context.after(launcher.stop);
  signals.emit("SIGINT");
  await launcher.closed;
  assert.equal(launcher.interruption, "SIGINT");
  assert.equal(signals.listenerCount("SIGINT"), 0);
  assert.equal(signals.listenerCount("SIGTERM"), 0);
  await assert.rejects(fetch(new URL("/health", launcher.url)));
});

test("interruption during startup stops the child without opening a browser", async (context) => {
  const directory = await fixture(context, "setInterval(() => {}, 1000);");
  const signals = new EventEmitter();
  let child;
  await assert.rejects(launchDemo({
    directory, port: await port(), signals, log: () => {},
    spawnProcess: (...args) => {
      child = spawn(...args);
      queueMicrotask(() => signals.emit("SIGINT"));
      return child;
    },
    browser: () => { throw new Error("No browser may start."); },
  }), (error) => error.exitCode === 130);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("an unresponsive startup is timed out and its owned child is cleaned up", async (context) => {
  const directory = await fixture(context, "setInterval(() => {}, 1000);");
  let child;
  await assert.rejects(launchDemo({
    directory, port: await port(), timeoutMs: 150, noBrowser: true,
    signals: new EventEmitter(), log: () => {},
    spawnProcess: (...args) => { child = spawn(...args); return child; },
  }), /did not become responsive/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});

test("missing demo files are reported before any child is started", async (context) => {
  const directory = await fixture(context);
  await rm(join(directory, "demo", "server.mjs"));
  await assert.rejects(launchDemo({
    directory, noBrowser: true,
    spawnProcess: () => { throw new Error("No child may start."); },
  }), /Required demo file is missing.*server\.mjs/);
});

test("missing browser tools are reported with no browser substitution", async () => {
  const calls = [];
  await assert.rejects(openBrowser("http://127.0.0.1:4173/", {
    platform: "darwin",
    spawnProcess: (command, args, options) => {
      calls.push({ command, args, options });
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" })));
      return child;
    },
  }), /Could not open.*open.*not found/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/usr/bin/open");
  assert.deepEqual(calls[0].args, ["http://127.0.0.1:4173/"]);
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(browserCommand("win32"), { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler"] });
});

test("browser failure after readiness stops the owned server", async (context) => {
  const directory = await fixture(context);
  let child;
  await assert.rejects(launchDemo({
    directory, port: await port(), signals: new EventEmitter(), log: () => {},
    spawnProcess: (...args) => { child = spawn(...args); return child; },
    browser: async () => { throw new Error("Browser startup failure"); },
  }), /Browser startup failure/);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
