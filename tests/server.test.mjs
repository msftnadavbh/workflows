import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { makeServer } from "../demo/server.mjs";

test("local server is responsive, read-only, and does not expose workspace files", async (t) => {
  const server = makeServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.close(); await once(server, "close"); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  const readiness = await health.json();
  assert.equal(readiness.ready, true);
  assert.equal(readiness.pid, process.pid, "Readiness must identify the exact process serving the demo.");
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Watch the plan change/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const native = await fetch(`${url}/api/native/latest`);
  assert.equal(native.status, 200);
  assert.ok(Object.hasOwn(await native.json(), "run"));
  for (const path of ["/package.json", "/.github/agents/launch-analyst.agent.md", "/..%2fprivate", "/runs"]) {
    assert.equal((await fetch(`${url}${path}`)).status, 404);
  }
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 405);
});

test("the native API never advertises an actionable checkpoint after its SDK host exits", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "launch-rescue-server-host-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  await writeFile(join(root, "Launch-Rescue-Demo.html"), "<main>Fixture</main>");
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  await once(child, "exit");
  assert.ok(Number.isSafeInteger(pid));
  const directory = join(root, "runs", "stopped-sdk");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "state.json"), JSON.stringify({
    engine: "copilot-runtime", runId: "stopped-sdk", controller: "sdk-terminal",
    hostPid: pid, status: "awaiting-approval", report: { status: "draft" }, error: null,
  }));
  const server = makeServer({ directory: root });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.close(); await once(server, "close"); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/native/latest`);
  assert.equal(response.status, 200);
  const snapshot = (await response.json()).run;
  assert.equal(snapshot.status, "held");
  assert.match(snapshot.error, /host is no longer running/);
});
