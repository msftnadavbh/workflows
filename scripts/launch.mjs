import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, posix } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));

export function validatePort(port) {
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Port must be an integer between 1024 and 65535.");
  }
  return port;
}

export function browserCommand(platform) {
  if (platform === "darwin") return { command: posix.join(posix.sep, "usr", "bin", "open"), args: [] };
  if (platform === "win32") return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler"] };
  throw new Error(`Default-browser launch is not configured for ${platform}. Use --no-browser and open the printed URL yourself.`);
}

export async function openBrowser(url, { platform = process.platform, spawnProcess = spawn } = {}) {
  const { command, args } = browserCommand(platform);
  await new Promise((resolve, reject) => {
    const child = spawnProcess(command, [...args, url], { stdio: "ignore", shell: false });
    child.once("error", (cause) => reject(new Error(
      `Could not open the default browser with ${command}: ${cause.message}. Use --no-browser.`, { cause },
    )));
    child.once("exit", (code, signal) => code === 0 ? resolve()
      : reject(new Error(`${command} failed (${signal ?? code}). Use --no-browser.`)));
  });
}

function interruptedError(signal) {
  const error = new Error(`Launch interrupted (${signal}). Only the owned server was stopped.`);
  error.exitCode = signal === "SIGINT" ? 130 : 143;
  return error;
}

export async function launchDemo({
  port = 4173, noBrowser = false, directory = root, timeoutMs = 10000,
  spawnProcess = spawn, browser = openBrowser, signals = process, log = console.log,
} = {}) {
  validatePort(port);
  for (const path of [join(directory, "Launch-Rescue-Demo.html"), join(directory, "demo", "server.mjs")]) {
    try {
      if (!(await stat(path)).isFile()) throw new Error("Not a file.");
    } catch (cause) {
      throw new Error(`Required demo file is missing or unreadable: ${path}. Run npm run build.`, { cause });
    }
  }
  const server = spawnProcess(process.execPath, [join(directory, "demo", "server.mjs")], {
    cwd: directory, env: { ...process.env, DEMO_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"], shell: false,
  });
  let outcome = null;
  let interruption = null;
  let stopping = null;
  let ready = false;
  let stderr = "";
  server.stderr?.on("data", (data) => {
    stderr = (stderr + String(data)).slice(-8000);
    if (ready) process.stderr.write(data);
  });
  const closed = new Promise((resolve) => {
    const finish = (result) => {
      if (outcome !== null) return;
      outcome = result;
      resolve(result);
    };
    server.once("error", (error) => finish({ code: 127, signal: null, error }));
    server.once("exit", (code, signal) => finish({ code, signal, error: null }));
  });
  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      if (outcome === null) server.kill("SIGTERM");
      let timer;
      try {
        const result = await Promise.race([closed, new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 2000);
        })]);
        if (result === null && outcome === null) server.kill("SIGKILL");
        return await closed;
      } finally {
        clearTimeout(timer);
      }
    })();
    return stopping;
  };
  const onInterrupt = (signal) => {
    interruption = signal;
    void stop();
  };
  const sigint = () => onInterrupt("SIGINT");
  const sigterm = () => onInterrupt("SIGTERM");
  signals.on("SIGINT", sigint);
  signals.on("SIGTERM", sigterm);
  void closed.then(() => {
    signals.removeListener("SIGINT", sigint);
    signals.removeListener("SIGTERM", sigterm);
  });
  const url = `http://127.0.0.1:${port}/?scoutTheme=dark`;
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (interruption) throw interruptedError(interruption);
      if (outcome !== null) {
        const error = new Error(`Demo server exited before becoming ready (${outcome.error?.message ?? outcome.signal ?? outcome.code}). ${stderr.trim()}`);
        error.exitCode = outcome.code || 1;
        throw error;
      }
      let response = null;
      try {
        response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
      } catch (cause) {
        if (cause.name !== "TimeoutError" && cause.cause?.code !== "ECONNREFUSED"
            && cause.cause?.code !== "UND_ERR_CONNECT_TIMEOUT") {
          throw new Error(`The demo health check failed: ${cause.message}`, { cause });
        }
      }
      if (response) {
        if (!response.ok) throw new Error(`Port ${port} is occupied by another server (HTTP ${response.status}). No browser was opened.`);
        const health = await response.json();
        if (health.ready !== true || health.version !== "1.0.0" || health.pid !== server.pid) {
          throw new Error(`Port ${port} belongs to another server or returned an invalid health response. No browser was opened.`);
        }
        if (interruption) throw interruptedError(interruption);
        if (outcome !== null) throw new Error("The demo server exited during its readiness check.");
        if (!noBrowser) await browser(url);
        if (interruption) throw interruptedError(interruption);
        if (outcome !== null) throw new Error("The demo server exited while opening the browser.");
        ready = true;
        log(`Local: ${url}`);
        log("Press Ctrl+C to stop this local server.");
        return { url, pid: server.pid, closed, stop, get interruption() { return interruption; } };
      }
      await delay(50);
    }
    throw new Error(`The demo server did not become responsive within ${timeoutMs / 1000} seconds. ${stderr.trim()}`);
  } catch (error) {
    await stop();
    throw error;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const { values } = parseArgs({ options: {
      port: { type: "string", default: "4173" }, "no-browser": { type: "boolean" },
    }, strict: true, allowPositionals: false });
    const launcher = await launchDemo({ port: Number(values.port), noBrowser: values["no-browser"] ?? false });
    const result = await launcher.closed;
    process.exitCode = launcher.interruption === "SIGINT" ? 130
      : launcher.interruption === "SIGTERM" ? 143 : result.code ?? 1;
    if (result.error || (!launcher.interruption && process.exitCode !== 0)) {
      console.error(`Demo server stopped unexpectedly: ${result.error?.message ?? result.signal ?? result.code}.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
