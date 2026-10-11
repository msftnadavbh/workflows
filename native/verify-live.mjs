import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { withNativeSession } from "./Run-Sdk.mjs";
import { readNativeState, reconcileNativeRun } from "../dist/reconcile.mjs";
import { nativeBuildFingerprint } from "./verification.mjs";

const root = fileURLToPath(new URL("..\\", import.meta.url));
const nativeBuild = await nativeBuildFingerprint(root);
await withNativeSession(async ({ client, session, runtime }) => {
  const models = await client.listModels();
  for (const required of ["gpt-6.1-sol", "claude-sonnet-5.5"]) {
    assert.ok(models.some((model) => model.id === required), `Required model unavailable: ${required}. No fallback is allowed.`);
  }
  console.log(`Real model verification on SDK runtime ${runtime.version}: two Sol / max analysts, one Sonnet / high reviewer.`);
  const paused = await session.workflow.run("launch-rescue", {
    args: { scenario: "mixed", mode: "live", seed: 42, pauseForApproval: true },
    notifyOnComplete: false,
  });
  assert.equal(paused.status, "paused", `Expected live checkpoint, got ${paused.status}: ${paused.error ?? ""}`);
  await reconcileNativeRun(root, paused);
  const pausedObservation = await readNativeState(root, paused.runId);
  assert.equal(pausedObservation.status, "awaiting-approval");
  assert.equal(pausedObservation.hostPid, process.pid);
  const atCheckpoint = await session.workflow.getRunDetail(paused.runId);
  const result = await session.workflow.resume(paused.runId, { notifyOnComplete: false });
  await reconcileNativeRun(root, result);
  assert.equal((await readNativeState(root, result.runId)).status, result.status);
  if (result.status !== "completed") {
    const observed = await session.workflow.getRunDetail(result.runId);
    console.error(JSON.stringify({
      status: result.status,
      agents: observed.agents.map((agent) => ({
        label: agent.label, status: agent.status, requestedModel: agent.requestedModel,
        resolvedModel: agent.resolvedModel, activity: agent.activity,
      })),
    }, null, 2));
    throw new Error(`Live native run failed: ${result.error ?? result.reason ?? JSON.stringify(result.failure) ?? result.status}`);
  }
  assert.equal(result.result.status, "approved");
  assert.equal(result.result.after.uniqueConfirmed, 2300);
  assert.equal(result.result.after.waitlisted, 200);
  assert.equal(result.result.verificationRounds, 2);
  assert.equal(result.result.reviewer.verdict, "accept");
  assert.ok(result.result.after.checks.every((check) => check.passed));
  const detail = await session.workflow.getRunDetail(result.runId);
  assert.equal(detail.agents.length, atCheckpoint.agents.length, "Resume must not spawn additional model agents for saved steps.");
  assert.deepEqual([...new Set(detail.agents.map((agent) => agent.label))].sort(),
    ["capacity-specialist-2", "dedupe-specialist-1", "independent-review"]);
  assert.ok(detail.agents.every((agent) => agent.status === "completed"));
  assert.equal(detail.agents.length, 3, "This rehearsal expects exactly three successful model calls.");
  const analysts = detail.agents.filter((agent) => agent.label.includes("specialist"));
  const reviewers = detail.agents.filter((agent) => agent.label === "independent-review");
  assert.ok(analysts.length >= 2 && reviewers.length >= 1);
  assert.ok(analysts.every((agent) => agent.requestedModel === "gpt-6.1-sol" && agent.resolvedModel === "gpt-6.1-sol"),
    "Analyst runtime resolution must match the requested model.");
  assert.ok(reviewers.every((agent) => agent.requestedModel === "claude-sonnet-5.5" && agent.resolvedModel === "claude-sonnet-5.5"),
    "Reviewer runtime resolution must match the requested independent model.");
  assert.deepEqual(await nativeBuildFingerprint(root), nativeBuild, "The native code changed during verification.");
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "evidence", "native-live-proof.json"), JSON.stringify({
    verifiedAt: new Date().toISOString(), engine: "actual Copilot dynamic-workflow runtime",
    sdkRuntime: runtime, mode: "live", status: result.status, pausedStatus: paused.status,
    nativeBuild,
    sameRunResume: result.runId === paused.runId, agentsAddedOnResume: detail.agents.length - atCheckpoint.agents.length,
    actualWorkflowOwnedAgents: detail.agents.map((agent) => ({
      label: agent.label, status: agent.status, requestedModel: agent.requestedModel, resolvedModel: agent.resolvedModel,
      activeMs: agent.activeMs,
    })),
    explicitReasoningOptions: { analyst: "max", independentReviewer: "high" },
    report: result.result,
    note: "Actual live model calls on synthetic evidence. Test-only local draft checkpoint resumed. No deployment, remote writes, or external tool calls.",
  }, null, 2), "utf8");
  console.log(`Live native workflow verified with ${detail.agents.length} actual agents and all three measured acceptance checks.`);
});
