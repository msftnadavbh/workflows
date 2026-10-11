import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { JsonValue, WorkflowRunResult } from "@github/copilot-sdk/extension";
import { isJsonValue, isRecord } from "../demo/core.js";
import { writeAtomic } from "./io.js";

const terminal = new Set(["completed", "cancelled", "error", "halted"]);
const statusOrder: Record<string, number> = { paused: 0, halted: 1, error: 2, completed: 3, cancelled: 4 };

function runDirectory(root: string, runId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error("Invalid native run ID.");
  return join(root, "runs", runId);
}

async function readSnapshot(directory: string, runId: string): Promise<Record<string, JsonValue>> {
  const snapshot: unknown = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  if (!isRecord(snapshot) || !isJsonValue(snapshot) || snapshot.engine !== "copilot-runtime" || snapshot.runId !== runId) {
    throw new Error("Native observation is invalid or belongs to a different run.");
  }
  return snapshot;
}

function readAttempt(value: unknown): number {
  if (value === null || value === undefined) return 1;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("Native observation has an invalid attempt.");
  }
  return value;
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true;
    throw error;
  }
}

export async function reconcileNativeRun(root: string, run: WorkflowRunResult, options: { hostClosed?: boolean } = {}): Promise<void> {
  const directory = runDirectory(root, run.runId);
  if (run.status === "pending" || run.status === "running") return;
  let snapshot;
  try { snapshot = await readSnapshot(directory, run.runId); }
  catch (error) {
    throw new AggregateError([error],
      `Native run reported ${run.status}: ${run.error ?? run.reason ?? run.runId}. Its progress snapshot could not be read.`);
  }
  const attempt = readAttempt(run.attempt ?? snapshot.attempt);
  const updatedAt = new Date().toISOString();
  // Lifecycle writers never replace the extension's progress, or clear an explicit host hold.
  if (options.hostClosed) {
    await writeAtomic(join(directory, "host-closed.json"), { runId: run.runId, updatedAt, hostClosed: true });
  }
  await writeAtomic(join(directory, `lifecycle-${attempt}-${run.status}.json`), {
    runId: run.runId, attempt, status: run.status, updatedAt,
    error: run.status === "error" || run.status === "halted" ? run.error ?? run.reason ?? "Native workflow stopped; inspect its run details." : null,
  });
}

export async function readNativeState(
  root: string, runId: string, hostAlive: (pid: number) => boolean = isProcessAlive,
): Promise<Record<string, JsonValue>> {
  const directory = runDirectory(root, runId);
  const snapshot = await readSnapshot(directory, runId);
  const names = await readdir(directory);
  const lifecycle = await Promise.all(names.filter((name) => /^lifecycle-\d+-(paused|completed|cancelled|error|halted)\.json$/.test(name))
    .map(async (name) => {
      const value: unknown = JSON.parse(await readFile(join(directory, name), "utf8"));
      if (!isRecord(value) || !isJsonValue(value) || value.runId !== runId || typeof value.status !== "string"
          || !Object.hasOwn(statusOrder, value.status) || typeof value.updatedAt !== "string"
          || !Number.isFinite(Date.parse(value.updatedAt)) || (value.error !== null && typeof value.error !== "string")) {
        throw new Error("Native lifecycle record is invalid.");
      }
      const attempt = readAttempt(value.attempt);
      if (name !== `lifecycle-${attempt}-${value.status}.json`) throw new Error("Native lifecycle identity does not match its filename.");
      return { attempt, status: value.status, updatedAt: value.updatedAt, error: value.error };
    }));
  lifecycle.sort((left, right) => right.attempt - left.attempt
    || (statusOrder[right.status] ?? 0) - (statusOrder[left.status] ?? 0));
  const latest = lifecycle.find((value) => value.attempt >= readAttempt(snapshot.attempt));
  const result = { ...snapshot };
  if (latest) {
    result.attempt = latest.attempt;
    result.runtimeStatus = latest.status;
    result.status = latest.status === "paused" ? isRecord(result.report) ? "awaiting-approval" : "paused" : latest.status;
    result.error = latest.error;
    if (typeof result.updatedAt !== "string" || Date.parse(latest.updatedAt) > Date.parse(result.updatedAt)) {
      result.updatedAt = latest.updatedAt;
    }
  }
  let hostClosed = result.hostClosed === true;
  if (names.includes("host-closed.json")) {
    const marker: unknown = JSON.parse(await readFile(join(directory, "host-closed.json"), "utf8"));
    if (!isRecord(marker) || marker.runId !== runId || marker.hostClosed !== true || typeof marker.updatedAt !== "string"
        || !Number.isFinite(Date.parse(marker.updatedAt))) throw new Error("Native host-close marker is invalid.");
    hostClosed = true;
    if (typeof result.updatedAt !== "string" || Date.parse(marker.updatedAt) > Date.parse(result.updatedAt)) {
      result.updatedAt = marker.updatedAt;
    }
  }
  if (!terminal.has(String(result.status)) && result.controller === "sdk-terminal" && !hostClosed) {
    if (result.hostPid === null || result.hostPid === undefined) {
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
