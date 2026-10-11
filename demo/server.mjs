import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readNativeState } from "../dist/reconcile.mjs";

const root = fileURLToPath(new URL("..\\", import.meta.url));
const host = "127.0.0.1";
const port = Number(process.env.DEMO_PORT ?? 4173);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("DEMO_PORT must be an integer from 1024 to 65535.");

const files = new Map([
  ["/", { path: "Launch-Rescue-Demo.html", type: "text/html; charset=utf-8" }],
  ["/demo.html", { path: "Launch-Rescue-Demo.html", type: "text/html; charset=utf-8" }],
  ["/sources.json", { path: join("sources", "research.json"), type: "application/json; charset=utf-8" }],
]);

async function latestNative(directory) {
  let names;
  try { names = await readdir(join(directory, "runs"), { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const candidates = await Promise.all(names
    .filter((entry) => entry.isDirectory() && /^[a-zA-Z0-9_-]{1,100}$/.test(entry.name))
    .map(async (entry) => {
      const path = join(directory, "runs", entry.name, "state.json");
      try { return { runId: entry.name, modified: (await stat(path)).mtimeMs }; }
      catch (error) { if (error.code === "ENOENT") return null; throw error; }
    }));
  const newest = candidates.filter((value) => value !== null).sort((a, b) => b.modified - a.modified)[0];
  if (!newest) return null;
  return readNativeState(directory, newest.runId);
}

export function makeServer({ directory = root } = {}) {
  return createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy",
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:; font-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const sendJson = (code, value) => {
      response.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : JSON.stringify(value));
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendJson(405, { error: "Read-only demo server: only GET and HEAD are supported." });
      return;
    }
    try {
      const pathname = new URL(request.url ?? "/", `http://${host}:${port}`).pathname;
      if (pathname === "/health") {
        await stat(join(directory, "Launch-Rescue-Demo.html"));
        sendJson(200, { ready: true, version: "1.0.0", pid: process.pid, nativeObserver: true, synthetic: true });
      } else if (pathname === "/api/native/latest") {
        sendJson(200, { run: await latestNative(directory) });
      } else {
        const file = files.get(pathname);
        if (!file) { sendJson(404, { error: "Not found. Only demo assets and read-only native observation are served." }); return; }
        const body = await readFile(join(directory, file.path));
        response.writeHead(200, { "Content-Type": file.type });
        response.end(request.method === "HEAD" ? undefined : body);
      }
    } catch (error) {
      console.error(`Demo request failed: ${error instanceof Error ? error.message : String(error)}`);
      sendJson(500, { error: "Demo data could not be read. Check the server terminal; no fallback result was substituted." });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = makeServer();
  server.on("error", (error) => {
    console.error(`Unable to start the demo: ${error.message}. Use a different DEMO_PORT or open Launch-Rescue-Demo.html.`);
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log(`Local: http://${host}:${port}/?scoutTheme=dark`));
}
