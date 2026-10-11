// native/reconcile.ts
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

// demo/core.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isJsonValue(value, depth = 0) {
  if (depth > 30) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

// native/io.ts
import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
var operations = {
  write: async (path, contents) => {
    await writeFile(path, contents, "utf8");
  },
  rename,
  wait: async (milliseconds) => {
    await new Promise((done) => setTimeout(done, milliseconds));
  },
  cleanup: async (path) => {
    await rm(path, { force: true });
  }
};
async function writeAtomic(path, value, io = operations) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const contents = JSON.stringify(value, null, 2);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await io.write(temporary, contents);
        await io.rename(temporary, path);
        return;
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : void 0;
        if (code !== "EPERM" && code !== "EBUSY" || attempt >= 2) throw error;
        await io.wait(20 * 2 ** attempt);
      }
    }
  } catch (error) {
    try {
      await io.cleanup?.(temporary);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Atomic observation write and cleanup failed.");
    }
    throw error;
  }
}

// native/reconcile.ts
var terminal = /* @__PURE__ */ new Set(["completed", "cancelled", "error", "halted"]);
var statusOrder = { paused: 0, halted: 1, error: 2, completed: 3, cancelled: 4 };
function runDirectory(root, runId) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error("Invalid native run ID.");
  return join(root, "runs", runId);
}
async function readSnapshot(directory, runId) {
  const snapshot = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  if (!isRecord(snapshot) || !isJsonValue(snapshot) || snapshot.engine !== "copilot-runtime" || snapshot.runId !== runId) {
    throw new Error("Native observation is invalid or belongs to a different run.");
  }
  return snapshot;
}
function readAttempt(value) {
  if (value === null || value === void 0) return 1;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Native observation has an invalid attempt.");
  }
  return value;
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true;
    throw error;
  }
}
async function reconcileNativeRun(root, run, options = {}) {
  const directory = runDirectory(root, run.runId);
  if (run.status === "pending" || run.status === "running") return;
  let snapshot;
  try {
    snapshot = await readSnapshot(directory, run.runId);
  } catch (error) {
    throw new AggregateError(
      [error],
      `Native run reported ${run.status}: ${run.error ?? run.reason ?? run.runId}. Its progress snapshot could not be read.`
    );
  }
  const attempt = readAttempt(run.attempt ?? snapshot.attempt);
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (options.hostClosed) {
    await writeAtomic(join(directory, "host-closed.json"), { runId: run.runId, updatedAt, hostClosed: true });
  }
  await writeAtomic(join(directory, `lifecycle-${attempt}-${run.status}.json`), {
    runId: run.runId,
    attempt,
    status: run.status,
    updatedAt,
    pauseKey: run.status === "paused" && run.pauseInfo?.type === "checkpoint" ? run.pauseInfo.key : null,
    error: run.status === "error" || run.status === "halted" ? run.error ?? run.reason ?? "Native workflow stopped; inspect its run details." : null
  });
}
async function readNativeState(root, runId, hostAlive = isProcessAlive) {
  const directory = runDirectory(root, runId);
  const snapshot = await readSnapshot(directory, runId);
  const names = await readdir(directory);
  const lifecycle = await Promise.all(names.filter((name) => /^lifecycle-\d+-(paused|completed|cancelled|error|halted)\.json$/.test(name)).map(async (name) => {
    const value = JSON.parse(await readFile(join(directory, name), "utf8"));
    if (!isRecord(value) || !isJsonValue(value) || value.runId !== runId || typeof value.status !== "string" || !Object.hasOwn(statusOrder, value.status) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || value.error !== null && typeof value.error !== "string") {
      throw new Error("Native lifecycle record is invalid.");
    }
    const attempt = readAttempt(value.attempt);
    if (name !== `lifecycle-${attempt}-${value.status}.json`) throw new Error("Native lifecycle identity does not match its filename.");
    return {
      attempt,
      status: value.status,
      updatedAt: value.updatedAt,
      error: value.error,
      pauseKey: typeof value.pauseKey === "string" ? value.pauseKey : null
    };
  }));
  lifecycle.sort((left, right) => right.attempt - left.attempt || (statusOrder[right.status] ?? 0) - (statusOrder[left.status] ?? 0));
  const latest = lifecycle.find((value) => value.attempt >= readAttempt(snapshot.attempt));
  const result = { ...snapshot };
  if (latest) {
    result.attempt = latest.attempt;
    result.runtimeStatus = latest.status;
    result.pauseKey = latest.pauseKey;
    result.status = latest.status === "paused" ? isRecord(result.report) ? "awaiting-approval" : "paused" : latest.status;
    result.error = latest.error;
    if (typeof result.updatedAt !== "string" || Date.parse(latest.updatedAt) > Date.parse(result.updatedAt)) {
      result.updatedAt = latest.updatedAt;
    }
  }
  let hostClosed = result.hostClosed === true;
  if (names.includes("host-closed.json")) {
    const marker = JSON.parse(await readFile(join(directory, "host-closed.json"), "utf8"));
    if (!isRecord(marker) || marker.runId !== runId || marker.hostClosed !== true || typeof marker.updatedAt !== "string" || !Number.isFinite(Date.parse(marker.updatedAt))) throw new Error("Native host-close marker is invalid.");
    hostClosed = true;
    if (typeof result.updatedAt !== "string" || Date.parse(marker.updatedAt) > Date.parse(result.updatedAt)) {
      result.updatedAt = marker.updatedAt;
    }
  }
  if (!terminal.has(String(result.status)) && result.controller === "sdk-terminal" && !hostClosed) {
    if (result.hostPid === null || result.hostPid === void 0) {
      hostClosed = true;
      result.error = "SDK host identity was not recorded. Start a new run instead of resuming this old snapshot.";
    } else if (typeof result.hostPid !== "number" || !Number.isSafeInteger(result.hostPid) || result.hostPid <= 0) {
      throw new Error("Native observation has an invalid SDK host PID.");
    } else if (!hostAlive(result.hostPid)) {
      hostClosed = true;
      result.error = "The SDK host is no longer running. Start a new run; the closed terminal cannot approve or resume work.";
    }
  }
  result.hostClosed = hostClosed;
  if (hostClosed && !terminal.has(String(result.status))) result.status = "held";
  return result;
}
export {
  readNativeState,
  reconcileNativeRun
};
