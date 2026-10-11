import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertResolvedModel, writeAtomic } from "../dist/io.mjs";
import { readNativeState, reconcileNativeRun } from "../dist/reconcile.mjs";

function agent(overrides = {}) {
  return {
    agentId: "a", toolCallId: "t", runId: "r", phaseId: null, label: "reviewer", agentType: "launch-reviewer",
    status: "completed", requestedModel: "claude-sonnet-5.5", resolvedModel: "claude-sonnet-5.5",
    startedAt: 100, completedAt: 200, activeMs: 100, ...overrides,
  };
}

test("model guard ignores an earlier failed attempt but never accepts a fallback", () => {
  assert.doesNotThrow(() => assertResolvedModel([
    agent({ status: "error", resolvedModel: undefined, startedAt: 10, completedAt: 20 }),
    agent(),
  ], "reviewer", "claude-sonnet-5.5"));
  assert.throws(() => assertResolvedModel([
    agent(), agent({ startedAt: 300, completedAt: 400, resolvedModel: "gpt-6.1-sol" }),
  ], "reviewer", "claude-sonnet-5.5"), /No fallback/);
  assert.throws(() => assertResolvedModel([], "reviewer", "claude-sonnet-5.5"));
});

test("atomic writes recover from bounded Windows sharing violations", async () => {
  let attempts = 0;
  const waits = [];
  await writeAtomic("state.json", { ready: true }, {
    write: async (_path, contents) => { assert.equal(JSON.parse(contents).ready, true); },
    rename: async () => {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error("File is in use"), { code: "EPERM" });
    },
    wait: async (milliseconds) => { waits.push(milliseconds); },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [20, 40]);
});

test("persistent or non-sharing I/O failures remain explicit errors", async () => {
  let attempts = 0;
  await assert.rejects(writeAtomic("state.json", {}, {
    write: async () => {},
    rename: async () => { attempts++; throw Object.assign(new Error("Still locked"), { code: "EBUSY" }); },
    wait: async () => {},
  }), /Still locked/);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(writeAtomic("state.json", {}, {
    write: async () => { attempts++; throw Object.assign(new Error("Disk is full"), { code: "ENOSPC" }); },
    rename: async () => {},
    wait: async () => { throw new Error("Do not retry non-sharing failures"); },
  }), /Disk is full/);
  assert.equal(attempts, 1);
});

test("native observer reconciles cooperative abort from the settled runtime envelope", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "launch-rescue-observer-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const directory = join(root, "runs", "owned-run");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "state.json");
  await writeFile(path, JSON.stringify({ engine: "copilot-runtime", runId: "owned-run",
    status: "settling", error: null, report: { status: "draft" } }));
  await reconcileNativeRun(root, { runId: "owned-run", status: "paused" });
  let snapshot = await readNativeState(root, "owned-run");
  assert.equal(snapshot.status, "awaiting-approval");
  assert.equal(snapshot.error, null);
  await reconcileNativeRun(root, { runId: "owned-run", status: "cancelled" });
  snapshot = await readNativeState(root, "owned-run");
  assert.equal(snapshot.status, "cancelled", "Cancellation must not masquerade as a pause.");
  await reconcileNativeRun(root, { runId: "owned-run", status: "paused" }, { hostClosed: true });
  snapshot = await readNativeState(root, "owned-run");
  assert.equal(snapshot.status, "cancelled", "A host hold cannot turn cancellation into a resumable pause.");
  assert.equal(snapshot.hostClosed, true);
  await reconcileNativeRun(root, { runId: "owned-run", status: "paused" });
  snapshot = await readNativeState(root, "owned-run");
  assert.equal(snapshot.status, "cancelled");
  assert.equal(snapshot.hostClosed, true, "A later pause observation must preserve the host-closed marker.");
});

test("concurrent observation writes use separate temporary files", async () => {
  const temporary = [];
  const io = {
    write: async (path) => { temporary.push(path); },
    rename: async () => {},
    wait: async () => {},
  };
  await Promise.all([writeAtomic("state.json", { id: 1 }, io), writeAtomic("state.json", { id: 2 }, io)]);
  assert.equal(new Set(temporary).size, 2);
});

test("concurrent lifecycle observations can never clear an explicit host hold", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "launch-rescue-hold-race-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  let holdsLost = 0;
  for (let index = 0; index < 12; index++) {
    const runId = `hold-race-${index}`;
    const directory = join(root, "runs", runId);
    await mkdir(directory, { recursive: true });
    const path = join(directory, "state.json");
    await writeFile(path, JSON.stringify({ engine: "copilot-runtime", runId,
      attempt: 1, status: "awaiting-approval", error: null, report: { status: "draft" } }));
    await Promise.all([
      reconcileNativeRun(root, { runId, attempt: 1, status: "paused" }, { hostClosed: true }),
      reconcileNativeRun(root, { runId, attempt: 1, status: "paused" }),
    ]);
    if ((await readNativeState(root, runId)).status !== "held") holdsLost++;
  }
  assert.equal(holdsLost, 0, `${holdsLost} explicit holds were overwritten by concurrent observations.`);
});

test("lifecycle reconciliation never overwrites progress from a resumed attempt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "launch-rescue-resume-race-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const directory = join(root, "runs", "resumed");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "state.json");
  const first = { engine: "copilot-runtime", runId: "resumed", attempt: 1,
    status: "settling", error: null, report: { status: "draft" } };
  await writeFile(path, JSON.stringify(first));
  await reconcileNativeRun(root, { runId: "resumed", attempt: 1, status: "paused" });
  const second = { ...first, attempt: 2, status: "running", phase: "Complete" };
  await Promise.all([
    reconcileNativeRun(root, { runId: "resumed", attempt: 1, status: "paused" }),
    writeAtomic(path, second),
  ]);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), second);
  const observed = await readNativeState(root, "resumed");
  assert.equal(observed.attempt, 2);
  assert.equal(observed.status, "running");
});

test("closed SDK hosts are held without changing the persisted progress", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "launch-rescue-dead-host-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const directory = join(root, "runs", "dead-host");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "state.json");
  const progress = { engine: "copilot-runtime", runId: "dead-host", controller: "sdk-terminal",
    hostPid: 1234, status: "awaiting-approval", error: null, report: { status: "draft" } };
  await writeFile(path, JSON.stringify(progress));
  const observed = await readNativeState(root, "dead-host", () => false);
  assert.equal(observed.status, "held");
  assert.equal(observed.hostClosed, true);
  assert.match(observed.error, /no longer running/);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), progress);
});

test("missing observer files do not hide the native runtime's original failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "launch-rescue-missing-observation-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  await assert.rejects(reconcileNativeRun(root, {
    runId: "failed-before-progress", status: "error", error: "The required model is unavailable",
  }), /The required model is unavailable/);
});
