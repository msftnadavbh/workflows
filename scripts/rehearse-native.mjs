import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";
import { makeServer } from "../demo/server.mjs";
import { withNativeSession } from "../native/Run-Sdk.mjs";
import { promptCheckpoint } from "../native/checkpoint.mjs";
import { nativeBuildFingerprint } from "../native/verification.mjs";
import { readNativeState, reconcileNativeRun } from "../dist/reconcile.mjs";
import { isWalkthroughCheckpoint } from "../dist/core.mjs";

const root = fileURLToPath(new URL("..\\", import.meta.url));
const { values } = parseArgs({ options: { live: { type: "boolean" }, walkthrough: { type: "boolean" } }, strict: true });
const mode = values.live ? "live" : "rehearsal";
const nativeBuild = await nativeBuildFingerprint(root);
const browserHash = createHash("sha256").update(await readFile(join(root, "Launch-Rescue-Demo.html"))).digest("hex");
const assets = join(root, "presentation", "assets");
await mkdir(assets, { recursive: true });
const server = makeServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("The E2E observer did not get a loopback port.");
let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}/?scoutTheme=dark&execution=copilot`);

  await withNativeSession(async ({ client, session, runtime }) => {
    if (mode === "live") {
      const models = await client.listModels();
      for (const id of ["gpt-6.1-sol", "claude-sonnet-5.5"]) {
        assert.ok(models.some((model) => model.id === id), `Required model unavailable: ${id}.`);
      }
    }
    console.log(`E2E: real Copilot runtime ${runtime.version}, ${mode} mode, actual browser observer.`);
    let paused = await session.workflow.run("launch-rescue", {
      args: { scenario: "mixed", mode, seed: 42, pauseForApproval: true, walkthrough: values.walkthrough ?? false }, notifyOnComplete: false,
    });
    const featureStops = [];
    while (paused.status === "paused" && paused.pauseInfo?.type === "checkpoint" && isWalkthroughCheckpoint(paused.pauseInfo.key)) {
      await reconcileNativeRun(root, paused);
      const featureId = paused.pauseInfo.key.split(":").at(-1);
      await expect(page.locator("#status-label")).toHaveText("Checkpoint");
      await expect(page.locator("#proof-step")).toHaveValue(featureId);
      await expect(page.locator("#proof-pause")).toHaveText("CHECKPOINT");
      await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeHidden();
      await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
      const observation = await session.workflow.getRunDetail(paused.runId);
      featureStops.push({ featureId, agents: observation.agents.length });
      if (featureId === "route") {
        await expect(page.locator("#proof-feature")).toHaveText("DYNAMIC WORKFLOW");
        await expect(page.locator("#proof-code")).toContainText("ctx.parallel");
        await expect(page.locator("#proof-output")).toContainText("dedupe");
        assert.equal(observation.agents.length, 0, "Code selects the branch before agents are launched.");
      }
      if (featureId === "repair" || featureId === "review") {
        await expect(page.locator("#proof-feature")).toHaveText(mode === "live" ? "AGENTIC WORKFLOW"
          : featureId === "review" ? "CODE / REVIEW" : "CODE / REPAIR");
        if (mode === "live") await expect(page.locator("#proof-code")).toContainText("ctx.agent");
        else await expect(page.locator("#proof-code")).not.toContainText("ctx.agent");
        await expect(page.locator("#proof-output")).toContainText("rationale");
        await expect(page.locator("#proof-execution")).toContainText(mode === "live" ? "Copilot model" : "JavaScript");
        const state = await readNativeState(root, paused.runId);
        const proof = state.events.find((event) => event.type === "feature" && event.id === featureId);
        assert.ok(proof?.handoffs.length);
        if (mode === "live") {
          await page.locator("#proof-prompt-label").click();
          assert.ok((await page.locator("#proof-prompt").textContent()).includes(proof.handoffs[0].prompt),
            "The browser must show the exact prompt supplied to this model handoff.");
          await page.locator("#proof-prompt-label").click();
        } else await expect(page.locator("#proof-prompt-details")).toBeHidden();
        await page.locator("#proof-body").evaluate((element) => { element.scrollTop = 0; });
      }
      if (featureId === "adapt") {
        await expect(page.locator("#proof-feature")).toHaveText("DYNAMIC WORKFLOW");
        await expect(page.locator("#proof-input")).toContainText("200 seats over capacity");
        await expect(page.locator("#proof-output")).toContainText("capacity specialist");
        assert.equal(observation.agents.length, mode === "live" ? 1 : 0);
      }
      if (["route", "repair", "adapt", "review"].includes(featureId)) {
        await page.screenshot({ path: join(assets, `native-${mode}-feature-${featureId}.png`), fullPage: false });
        await page.locator("#feature-proof").screenshot({ path: join(assets, `native-${mode}-proof-${featureId}.png`) });
        if (featureId === "repair") {
          const execution = await page.locator("#proof-execution").boundingBox();
          const code = await page.locator("#proof-code").boundingBox();
          assert.ok(execution && code);
          await page.screenshot({
            path: join(assets, `native-${mode}-call-repair.png`),
            clip: { x: code.x, y: execution.y - 4, width: code.width, height: code.y + code.height - execution.y + 8 },
          });
        }
      }
      const input = new PassThrough();
      const output = new PassThrough();
      const decision = promptCheckpoint(input, output, "NEXT");
      input.write("next\n");
      assert.equal(await decision, "next");
      input.destroy(); output.destroy();
      paused = await session.workflow.resume(paused.runId, { notifyOnComplete: false });
    }
    if (values.walkthrough) {
      assert.deepEqual(featureStops.map((stop) => stop.featureId), ["route", "repair", "adapt", "verify", "review"]);
    }
    assert.equal(paused.status, "paused", `Expected a checkpoint; got ${paused.status}: ${paused.error ?? paused.reason ?? ""}`);
    await reconcileNativeRun(root, paused);
    await expect(page.locator("#status-label")).toHaveText("Review checkpoint");
    await expect(page.locator("#flow-summary")).toContainText("failed capacity check added a specialist");
    await expect(page.locator("#confirmed-count")).toHaveText("2,300");
    await expect(page.locator("#waitlist-count")).toContainText("200 waitlisted");
    await expect(page.locator("#checks-total")).toHaveText("3 / 3 pass");
    await expect(page.locator('[data-task="verify-1"]')).toHaveAttribute("data-state", "failed");
    await expect(page.locator('[data-task="verify-2"]')).toHaveAttribute("data-state", "passed");
    await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
    await expect(page.locator("#approval-detail")).toContainText("approval from the workflow owner");
    await page.locator('[data-task="verify-1"]').click();
    await expect(page.locator("#inspector-detail")).toContainText("200 seats over capacity");
    await expect(page.locator("#inspector-detail")).toContainText("0 duplicate outcomes");
    await page.getByRole("button", { name: "Close task details" }).click();
    await expect(page.locator("#proof-step")).toHaveValue("approval");
    const checkpointFits = await page.evaluate(() => {
      const gate = document.querySelector("#approval-panel").getBoundingClientRect();
      return gate.top >= 0 && gate.bottom <= innerHeight && document.documentElement.scrollHeight <= innerHeight;
    });
    await page.screenshot({ path: join(assets, `native-${mode}-checkpoint.png`), fullPage: false });

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download evidence", exact: true }).click();
    const downloaded = await downloadPromise;
    const stream = await downloaded.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(exported.engine, "copilot-runtime");
    assert.equal(exported.report.runId, paused.runId, "The browser must export the current native run, not earlier results.");
    assert.equal(exported.report.status, "draft");
    assert.equal(exported.report.mode, mode);
    const atCheckpoint = await session.workflow.getRunDetail(paused.runId);
    assert.equal(atCheckpoint.agents.length, mode === "live" ? 3 : 0);

    // Exercise the same terminal decision reader without authorizing any external action.
    const input = new PassThrough();
    const output = new PassThrough();
    const decision = promptCheckpoint(input, output);
    input.write("approve\n");
    assert.equal(await decision, "approve");
    input.destroy(); output.destroy();
    const completed = await session.workflow.resume(paused.runId, { notifyOnComplete: false });
    await reconcileNativeRun(root, completed);
    assert.equal(completed.status, "completed", completed.error);
    assert.equal(completed.result.status, "approved");
    const detail = await session.workflow.getRunDetail(paused.runId);
    assert.equal(detail.agents.length, atCheckpoint.agents.length, "Resume must not spawn agents for journaled work.");
    assert.ok(detail.agents.every((agent) => agent.status === "completed"));
    if (mode === "live") {
      assert.deepEqual(detail.agents.map((agent) => agent.label).sort(),
        ["capacity-specialist-2", "dedupe-specialist-1", "independent-review"]);
      for (const agent of detail.agents) {
        const expected = agent.label === "independent-review" ? "claude-sonnet-5.5" : "gpt-6.1-sol";
        assert.equal(agent.requestedModel, expected);
        assert.equal(agent.resolvedModel, expected);
      }
    }
    await expect(page.locator("#status-label")).toHaveText("Draft approved");
    await expect(page.locator("#proof-step")).toHaveValue("complete");
    await expect(page.locator("#proof-pause")).toHaveText("COMPLETED");
    await expect(page.locator("#duplicate-count")).toHaveText("0");
    await expect(page.locator("#oversold-count")).toHaveText("0");
    assert.equal((await readNativeState(root, paused.runId)).status, "completed");
    await page.screenshot({ path: join(assets, `native-${mode}-completed.png`), fullPage: false });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await nativeBuildFingerprint(root), nativeBuild);
    assert.equal(createHash("sha256").update(await readFile(join(root, "Launch-Rescue-Demo.html"))).digest("hex"), browserHash);
    await mkdir(join(root, "evidence"), { recursive: true });
    const evidence = {
      verifiedAt: new Date().toISOString(), mode, nativeBuild, sdkRuntime: runtime,
      browserArtifact: { file: "Launch-Rescue-Demo.html", sha256: browserHash },
      realBrowser: "Microsoft Edge", viewport: "1920x1080", scenario: "mixed",
      runId: completed.runId, checkpointStatus: paused.status, finalStatus: completed.status,
      browserExportedCurrentRun: exported.report.runId === completed.runId,
      browserApprovalUnavailable: true, inspectorExplainsFailure: true,
      agentsAtCheckpoint: atCheckpoint.agents.length, agentsAddedOnResume: detail.agents.length - atCheckpoint.agents.length,
      featureStops, walkthrough: values.walkthrough ?? false,
      checkpointFitsViewport: checkpointFits, pageErrors,
      verifiedCounts: completed.result.after, note: "Synthetic local draft; no deployment, purchase, or remote write.",
    };
    await writeFile(join(root, "evidence", `browser-native-${mode}-e2e.json`), JSON.stringify(evidence, null, 2), "utf8");
    if (mode === "live") {
      await writeFile(join(root, "evidence", "native-live-proof.json"), JSON.stringify({
        verifiedAt: evidence.verifiedAt, engine: "actual Copilot dynamic-workflow runtime",
        sdkRuntime: runtime, mode, nativeBuild, status: completed.status, pausedStatus: paused.status,
        sameRunResume: completed.runId === paused.runId, agentsAddedOnResume: evidence.agentsAddedOnResume,
        actualWorkflowOwnedAgents: detail.agents.map((agent) => ({
          label: agent.label, status: agent.status, requestedModel: agent.requestedModel,
          resolvedModel: agent.resolvedModel, activeMs: agent.activeMs,
        })),
        explicitReasoningOptions: { analyst: "max", independentReviewer: "high" },
        report: completed.result, browserE2E: true, note: evidence.note,
        featureStops,
      }, null, 2), "utf8");
    }
    assert.ok(checkpointFits, "The native checkpoint instructions and evidence control must fit the 1080p stage viewport.");
    console.log(`PASS: browser observed ${mode} workflow, explained the failure, exported current evidence, and followed same-run resume.`);
  });
} finally {
  await browser?.close();
  const closed = once(server, "close");
  server.close();
  await closed;
}
