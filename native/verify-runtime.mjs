import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withNativeSession } from "./Run-Sdk.mjs";
import { readNativeState, reconcileNativeRun } from "../dist/reconcile.mjs";
import { nativeBuildFingerprint } from "./verification.mjs";
import { recordRunCost } from "./cost.mjs";

const root = fileURLToPath(new URL("..\\", import.meta.url));
const nativeBuild = await nativeBuildFingerprint(root);
await withNativeSession(async ({ session, runtime }) => {
  console.log(`Version-matched SDK runtime: ${runtime.version}`);
  const paused = await session.workflow.run("launch-rescue", {
    args: { scenario: "mixed", mode: "rehearsal", seed: 42, pauseForApproval: true },
    notifyOnComplete: false,
  });
  assert.equal(paused.status, "paused");
  await reconcileNativeRun(root, paused);
  const pausedObservation = await readNativeState(root, paused.runId);
  assert.equal(pausedObservation.status, "awaiting-approval");
  assert.equal(pausedObservation.hostPid, process.pid);
  assert.equal(paused.pauseInfo.type, "checkpoint");
  const beforeResume = await session.workflow.getRunDetail(paused.runId);
  const checkpointCost = await recordRunCost({ root, session, runId: paused.runId, mode: "rehearsal" });
  assert.equal(checkpointCost?.run?.aiCredits, 0, "The native no-model run must report zero model credits.");
  const resumed = await session.workflow.resume(paused.runId, { notifyOnComplete: false });
  assert.equal(resumed.status, "completed");
  await reconcileNativeRun(root, resumed);
  assert.equal((await readNativeState(root, resumed.runId)).status, "completed");
  assert.ok(resumed.result && typeof resumed.result === "object" && !Array.isArray(resumed.result));
  assert.equal(resumed.result.status, "approved");
  assert.equal(resumed.result.after.uniqueConfirmed, 2300);
  assert.equal(resumed.result.after.waitlisted, 200);
  assert.ok(resumed.result.after.checks.every((check) => check.passed));
  const detail = await session.workflow.getRunDetail(paused.runId);
  const cost = await recordRunCost({ root, session, runId: paused.runId, mode: "rehearsal" });
  assert.equal(cost?.run?.aiCredits, 0);
  assert.equal(cost?.run?.subagents, 0);
  assert.ok(Array.isArray(detail.agents));
  assert.equal(detail.agents.length, 0);
  assert.deepEqual(await nativeBuildFingerprint(root), nativeBuild, "The native code changed during verification.");
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "evidence", "native-runtime-proof.json"), JSON.stringify({
    verifiedAt: new Date().toISOString(),
    engine: "actual Copilot dynamic-workflow runtime",
    sdkRuntime: runtime, mode: "rehearsal",
    nativeBuild,
    pausedStatus: paused.status, resumedStatus: resumed.status, reportStatus: resumed.result.status,
    runId: resumed.runId, workflowOwnedAgents: detail.agents.length,
    verificationRounds: resumed.result.verificationRounds,
    verifiedCounts: {
      uniqueConfirmed: resumed.result.after.uniqueConfirmed, waitlisted: resumed.result.after.waitlisted,
      duplicateOutcomes: resumed.result.after.duplicateOutcomes, oversoldSeats: resumed.result.after.oversoldSeats,
      missingAttendees: resumed.result.after.missingAttendees,
    },
    paidLiveModelPath: "Not invoked by this no-model proof.",
    costMeter: cost,
  }, null, 2), "utf8");
  console.log("Native checkpoint and same-run resume verified, with zero model calls.");
});
