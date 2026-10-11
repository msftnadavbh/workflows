import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runLaunchRescue, validateArgs } from "../dist/core.mjs";
import { LocalContext, newJournal } from "../dist/local-context.mjs";

const customerUrl = "/?scoutTheme=dark";
const copilotUrl = "/?scoutTheme=dark&execution=copilot";

async function expectCustomerView(page) {
  expect(await page.locator("body").innerText()).not.toMatch(
    /offline|rehearsal|presenter|stage view|presentation pacing|show run command|scripted demo|JS SUBSTITUTE|no LLM|walkthrough/i,
  );
  await expect(page.locator(
    "#offline-mode, #native-mode, #truth-strip, #cue-toggle, #presenter-cue, #stage-toggle, #native-panel, #pace-select, #seed-input, #workflow-source",
  )).toHaveCount(0);
}

async function nativeFixture(overrides = {}) {
  const args = validateArgs({ scenario: "capacity", mode: "rehearsal", pauseForApproval: false });
  const context = new LocalContext(newJournal(args, "native-regression"));
  const events = [];
  const report = await runLaunchRescue(context, async (event) => { events.push(event); });
  return {
    engine: "copilot-runtime", runId: context.runId, sessionId: "regression-session",
    controller: "sdk-terminal", args, status: "completed", phase: "Complete",
    updatedAt: "2026-10-10T21:00:00.000Z", events, report, error: null, ...overrides,
  };
}

async function begin(page, scenario) {
  await page.goto(customerUrl);
  await page.getByRole("button", { name: "Step by step", exact: true }).click();
  await page.locator(`[data-scenario="${scenario}"]`).click();
  await page.getByRole("button", { name: "Run rescue", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Review checkpoint");
}

for (const [scenario, confirmed, waitlisted] of [
  ["retries", "2,500", "0 waitlisted"], ["capacity", "2,300", "200 waitlisted"],
  ["parallel", "2,300", "200 waitlisted"], ["mixed", "2,300", "200 waitlisted"],
]) {
  test(`${scenario}: complete a real browser run and approve the local draft`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await begin(page, scenario);
    await expectCustomerView(page);
    await expect(page.locator("#proof-execution")).toHaveText("JavaScript · local execution");
    await expect(page.locator("#confirmed-count")).toHaveText(confirmed);
    await expect(page.locator("#waitlist-count")).toContainText(waitlisted);
    await expect(page.locator("#checks-total")).toHaveText("3 / 3 pass");
    await expect(page.locator("#duplicate-count")).toHaveText("0");
    await expect(page.locator("#oversold-count")).toHaveText("0");
    await expect(page.locator('[data-task="scan-retries"] .graph-status')).toHaveText("Completed");
    await expect(page.locator('[data-task="scan-inventory"] .graph-status')).toHaveText("Completed");
    await expect(page.locator('[data-task="reviewer"] .graph-status')).toHaveText("Completed");
    if (scenario === "mixed") await expect(page.locator('[data-task="capacity-specialist-2"]')).toBeVisible();
    if (scenario === "mixed") await expect(page.locator('[data-task="rescan-inventory"]')).toBeVisible();
    if (scenario === "parallel") {
      await expect(page.locator('[data-task="dedupe-specialist-1"]')).toBeVisible();
      await expect(page.locator('[data-task="capacity-specialist-1"]')).toBeVisible();
    }
    await page.getByRole("button", { name: "Approve local draft", exact: true }).click();
    await expect(page.locator("#status-label")).toHaveText("Draft approved");
    await page.reload();
    await expect(page.locator("#status-label")).toHaveText("Draft approved");
    expect(errors).toEqual([]);
  });
}

test("pause, reload, and resume preserve a saved run", async ({ page }) => {
  await page.goto(customerUrl);
  await page.getByRole("button", { name: "Step by step", exact: true }).click();
  await page.getByRole("button", { name: "Run rescue", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Running");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Paused");
  await expect(page.locator("#scenario-controls")).toBeHidden();
  await expect(page.locator('[data-scenario="capacity"]')).toBeDisabled();
  await expect(page.locator("#selected-challenge")).toContainText("Surprise me");
  await page.reload();
  await expect(page.locator("#status-label")).toHaveText("Paused");
  await page.getByRole("button", { name: "Resume saved run", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Review checkpoint");
});

test("hold survives reload and does not imply approval", async ({ page }) => {
  await begin(page, "mixed");
  await page.getByRole("button", { name: "Keep on hold", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("On hold");
  await page.reload();
  await expect(page.locator("#status-label")).toHaveText("On hold");
  await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
});

test("invalid saved input is reported instead of restoring a successful-looking run", async ({ page }) => {
  await begin(page, "retries");
  await page.evaluate(() => {
    const key = "launch-rescue.rehearsal.v3";
    const saved = JSON.parse(localStorage.getItem(key));
    saved.journal.args.seed = 0;
    localStorage.setItem(key, JSON.stringify(saved));
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("Seed must be");
  await expect(page.locator("#checks-total")).toHaveText("0 / 3 run");
  await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
});

test("actual evidence downloads as JSON with honest execution labeling", async ({ page }) => {
  await begin(page, "retries");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download evidence", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^launch-rescue-.*\.json$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  expect(result.engine).toBe("standalone-javascript");
  expect(result.report.synthetic).toBe(true);
  expect(result.report.status).toBe("draft");
  expect(result.report.after.uniqueConfirmed).toBe(2500);
});

test("native observation cannot approve a native checkpoint from the browser", async ({ page }) => {
  await page.route("**/api/native/latest", async (route) => {
    await route.fulfill({ json: { run: { engine: "copilot-runtime", runId: "test-native-observer", sessionId: "test-owning-session",
      controller: "copilot-session",
      args: { scenario: "parallel", mode: "live", seed: 42, pauseForApproval: true },
      status: "running", phase: "Observe", updatedAt: "2026-10-10T18:00:00.000Z",
      events: [{ type: "phase", id: "phase:Observe", title: "Observe" }],
      report: null, error: null } } });
  });
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Running");
  await expectCustomerView(page);
  await expect(page.locator("#mission-controls")).toBeHidden();
  await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
  await page.goto(customerUrl);
  await expect(page.locator("#mission-controls")).toBeVisible();
  await expect(page.locator("#proof-execution")).toHaveText("JavaScript · local execution");
});

test("waiting for Copilot never substitutes a local result or exposes setup controls", async ({ page }) => {
  await page.route("**/api/native/latest", (route) => route.fulfill({ json: { run: null } }));
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Waiting for run");
  await expect(page.locator("#proof-execution")).toHaveText("Waiting for Copilot execution");
  await expect(page.locator("#checks-total")).toHaveText("0 / 3 run");
  await expect(page.locator("#mission-controls")).toBeHidden();
  await expectCustomerView(page);
});

test("an invalid workflow link reports the problem instead of selecting a different runtime", async ({ page }) => {
  await page.goto("/?execution=unknown");
  await expect(page.getByRole("alert")).toContainText("Unknown workflow view");
  await expect(page.locator("#status-label")).toHaveText("Held / error");
  await expect(page.locator("#checks-total")).toHaveText("0 / 3 run");
  await expectCustomerView(page);
});

test("Copilot failures stay explicit without offering a rehearsal fallback", async ({ page }) => {
  const snapshot = await nativeFixture({
    status: "error", phase: "Repair", events: [], report: null,
    error: "Retry specialist returned no usable result. Retry or use the labeled rehearsal.",
  });
  await page.route("**/api/native/latest", (route) => route.fulfill({ json: { run: snapshot } }));
  await page.goto(copilotUrl);
  await expect(page.getByRole("alert")).toHaveText("Retry specialist returned no usable result. Retry the workflow.");
  await expect(page.locator("#status-label")).toHaveText("Held / error");
  await expect(page.locator("#checks-total")).toHaveText("0 / 3 run");
  await expectCustomerView(page);
});

test("the portable HTML executes offline directly from file:// and preserves its checkpoint", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(`${pathToFileURL(resolve("Launch-Rescue-Demo.html")).href}?scoutTheme=dark`);
  await page.getByRole("button", { name: "Step by step", exact: true }).click();
  await page.getByRole("button", { name: "Run rescue", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Review checkpoint");
  await expect(page.locator("#confirmed-count")).toHaveText("2,300");
  await page.reload();
  await expect(page.locator("#status-label")).toHaveText("Review checkpoint");
  await page.getByRole("button", { name: "Approve local draft", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Draft approved");
  expect(requests).toEqual([]);
});

test("native cancellation never appears as a resumable pause", async ({ page }) => {
  await page.route("**/api/native/latest", async (route) => {
    await route.fulfill({ json: { run: { engine: "copilot-runtime", runId: "cancelled-native", sessionId: "owning-native",
      controller: "copilot-session", args: { scenario: "mixed", mode: "live", seed: 42, pauseForApproval: true },
      status: "cancelled", phase: "Repair", updatedAt: "2026-10-10T18:00:00.000Z", events: [], report: null, error: null } } });
  });
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Cancelled");
  await expectCustomerView(page);
  await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
});

test("Copilot checkpoints stay read-only without exposing terminal instructions", async ({ page }) => {
  await page.route("**/api/native/latest", async (route) => {
    await route.fulfill({ json: { run: { engine: "copilot-runtime", runId: "sdk-paused", sessionId: "sdk-session",
      controller: "sdk-terminal", args: { scenario: "mixed", mode: "live", seed: 42, pauseForApproval: true },
      status: "paused", phase: "Approve", updatedAt: "2026-10-10T18:00:00.000Z", events: [], report: null, error: null } } });
  });
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Paused");
  await expectCustomerView(page);
  expect(await page.locator("body").innerText()).not.toMatch(/SDK terminal|--resume|Copy command/);
  await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
});

for (const [featureId, model, effort] of [
  ["repair", "gpt-6.1-sol", "max"],
  ["review", "claude-sonnet-5.5", "high"],
]) {
  test(`Copilot ${featureId} keeps the actual model and exact prompt visible without backstage UI`, async ({ page }) => {
    const snapshot = await nativeFixture();
    const stop = snapshot.events.findIndex((event) => event.type === "feature" && event.id === featureId);
    const events = snapshot.events.slice(0, stop + 1).map((event) => event.type === "feature"
      ? { ...event, handoffs: event.handoffs.map((handoff) => ({
        ...handoff, source: "model",
        model: event.id === "review" ? "claude-sonnet-5.5" : "gpt-6.1-sol",
        reasoningEffort: event.id === "review" ? "high" : "max",
      })) } : event.type === "task" && event.kind === "worker" ? { ...event, kind: "agent", detail: `${model} / ${effort}` } : event);
    const proof = events.at(-1);
    await page.route("**/api/native/latest", (route) => route.fulfill({ json: { run: {
      ...snapshot, args: { ...snapshot.args, mode: "live", pauseForApproval: true, walkthrough: true },
      status: "paused", phase: featureId === "review" ? "Challenge" : "Repair",
      pauseKey: `launch-rescue-v3:walkthrough:${featureId}`, events, report: null,
    } } }));
    await page.goto(copilotUrl);
    await expect(page.locator("#status-label")).toHaveText("Checkpoint");
    await expect(page.locator("#proof-feature")).toHaveText("AGENTIC WORKFLOW");
    await expect(page.locator("#proof-execution")).toContainText(`${model} / ${effort}`);
    await expect(page.locator("#proof-code")).toContainText("ctx.agent");
    await page.locator("#proof-prompt-label").click();
    await expect(page.locator("#proof-prompt")).toContainText(proof.handoffs[0].prompt);
    await expectCustomerView(page);
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
  });
}

test("completed native draft-only runs never invite approval in a closed terminal", async ({ page }) => {
  const snapshot = await nativeFixture();
  await page.route("**/api/native/latest", (route) => route.fulfill({ json: { run: snapshot } }));
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Draft complete");
  await expect(page.locator("#approval-detail")).not.toContainText("type APPROVE");
  await expect(page.locator('[data-task="approval"] .graph-status')).not.toContainText("Awaiting human review");
  await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
});

test("a recovered observer clears the old error even when the snapshot is unchanged", async ({ page }) => {
  const snapshot = await nativeFixture();
  let calls = 0;
  await page.route("**/api/native/latest", async (route) => {
    calls++;
    await route.fulfill(calls === 2 ? { status: 500, json: { error: "Temporary outage" } }
      : { json: { run: snapshot } });
  });
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Draft complete");
  await expect(page.getByRole("alert")).toContainText("HTTP 500");
  await expect.poll(() => calls).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole("alert")).toBeHidden();
});

test("native polling never overlaps requests on a slow observer", async ({ page }) => {
  const snapshot = await nativeFixture();
  let active = 0;
  let peak = 0;
  let calls = 0;
  await page.route("**/api/native/latest", async (route) => {
    active++;
    peak = Math.max(peak, active);
    calls++;
    if (calls === 1) await new Promise((done) => setTimeout(done, 1900));
    await route.fulfill({ json: { run: snapshot } });
    active--;
  });
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Draft complete");
  expect(peak).toBe(1);
});

test("an older native snapshot cannot regress the current completed run", async ({ page }) => {
  const completed = await nativeFixture();
  const earlier = { ...completed, status: "running", phase: "Observe", report: null,
    updatedAt: "2026-10-10T20:00:00.000Z", events: [] };
  let calls = 0;
  await page.route("**/api/native/latest", (route) => {
    calls++;
    return route.fulfill({ json: { run: calls === 1 ? completed : earlier } });
  });
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Draft complete");
  await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#status-label")).toHaveText("Draft complete");
});

test("the narrated normal-speed flow exposes the failed check before recovery", async ({ page }) => {
  await page.goto(customerUrl);
  await page.getByRole("button", { name: "Step by step", exact: true }).click();
  await page.getByRole("button", { name: "Run rescue", exact: true }).click();
  await expect(page.locator('[data-task="verify-1"]')).toHaveAttribute("data-state", "failed");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Paused");
  await page.locator('[data-task="verify-1"]').click();
  await expect(page.locator("#inspector-detail")).toContainText("200 seats over capacity");
  await expect(page.locator("#inspector-detail")).toContainText("0 duplicate outcomes");
  await expect(page.locator("#flow-summary")).toContainText("200 seats over capacity");
  await page.getByRole("button", { name: "Close task details" }).click();
  await page.getByRole("button", { name: "Resume saved run", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Review checkpoint");
  await expect(page.locator("#checks-total")).toHaveText("3 / 3 pass");
  await expect(page.locator("#flow-summary")).toContainText("failed capacity check added a specialist");
});

test("completed Copilot runs show results without any setup or presenter controls", async ({ page }) => {
  const snapshot = await nativeFixture();
  await page.route("**/api/native/latest", (route) => route.fulfill({ json: { run: snapshot } }));
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Draft complete");
  await expectCustomerView(page);
  await expect(page.locator("#mission-controls")).toBeHidden();
  await expect(page.locator("#proof-pause")).toHaveText("COMPLETED");
});

test("execution history refreshes its source labels when the observer moves to another run", async ({ page }) => {
  const javascript = await nativeFixture();
  const model = {
    ...javascript, runId: "model-history",
    args: { ...javascript.args, mode: "live" },
    report: { ...javascript.report, runId: "model-history", mode: "live" },
    events: javascript.events.map((event) => event.type === "feature" ? {
      ...event, handoffs: event.handoffs.map((handoff) => ({
        ...handoff, source: "model",
        model: event.id === "review" ? "claude-sonnet-5.5" : "gpt-6.1-sol",
        reasoningEffort: event.id === "review" ? "high" : "max",
      })),
    } : event),
  };
  let calls = 0;
  await page.route("**/api/native/latest", (route) => {
    calls++;
    return route.fulfill({ json: { run: calls === 1 ? model : javascript } });
  });
  await page.goto(copilotUrl);
  await expect(page.locator('#proof-step option[value="repair"]')).toContainText("Agentic Workflow");
  await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#proof-step option[value="repair"]')).toContainText("Repair logic");
  await expectCustomerView(page);
});

test("keyboard inspection exposes the same measured failure as pointer inspection", async ({ page }) => {
  await begin(page, "mixed");
  const failedCheck = page.locator('[data-task="verify-1"]');
  await failedCheck.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#inspector-detail")).toContainText("200 seats over capacity");
  await page.getByRole("button", { name: "Close task details" }).click();
  await expect(failedCheck).toBeFocused();
  await page.getByRole("button", { name: "Approve local draft", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#status-label")).toHaveText("Draft approved");
});

test("the default demo teaches Dynamic and Agentic Workflows as separate executed steps", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(customerUrl);
  await expect(page.getByRole("button", { name: "Step by step", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Dynamic Workflow: CODE controls execution", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agentic Workflow: MODEL reasons over evidence", exact: true })).toBeVisible();
  await expectCustomerView(page);
  await page.getByRole("button", { name: "Run rescue", exact: true }).click();
  const lessons = ["route", "repair", "adapt", "verify", "review"];
  for (const id of lessons) {
    await expect(page.locator("#status-label")).toHaveText("Checkpoint");
    await expect(page.locator("#proof-step")).toHaveValue(id);
    await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
    expect(await page.locator("#continue-walkthrough").evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    if (id === "route") {
      await expect(page.locator("#proof-feature")).toHaveText("DYNAMIC WORKFLOW");
      await expect(page.locator("#proof-code")).toContainText("ctx.parallel");
      await expect(page.locator("#proof-output")).toContainText("dedupe");
      await expect(page.locator("#proof-benefit")).toContainText("0 unavailable seats skip capacity work");
      await expect(page.locator('[data-task="scan-retries"] .graph-kind')).toHaveText("PARALLEL SCAN / CODE");
      await expect(page.locator('[data-task="dedupe-specialist-1"]')).toHaveCount(0);
    }
    if (id === "repair" || id === "review") {
      await expect(page.locator("#proof-feature")).toHaveText(id === "review" ? "CODE / REVIEW" : "CODE / REPAIR");
      await expect(page.locator("#proof-execution")).toHaveText("JavaScript · local execution");
      await expect(page.locator("#proof-code")).not.toContainText("ctx.agent");
      await expect(page.locator("#proof-output")).toContainText("rationale");
      await expect(page.locator("#proof-prompt-details")).toBeHidden();
      await expect(page.locator('[data-task="reviewer"] .graph-kind')).toHaveText("JAVASCRIPT");
    }
    if (id === "review") {
      await expect(page.locator("#proof-verdict-rule")).toContainText("REJECT → run held");
      expect((await page.locator("#proof-step option").allTextContents()).join(" ")).not.toMatch(/Agentic Workflow|new agent/);
    }
    if (id === "adapt") {
      await expect(page.locator("#proof-input")).toContainText("200 seats over capacity");
      await expect(page.locator("#proof-output")).toContainText("capacity specialist");
      await expect(page.locator('[data-task="capacity-specialist-2"]')).toHaveAttribute("data-state", "waiting");
    }
    await expectCustomerView(page);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  }
  await expect(page.locator("#status-label")).toHaveText("Review checkpoint");
  await expect(page.locator("#proof-feature")).toHaveText("DYNAMIC WORKFLOW / HUMAN");
  await page.locator('[data-task="verify-1"]').click();
  await page.getByRole("button", { name: "Close task details" }).click();
  await expect(page.locator("#proof-step")).toHaveValue("approval");
  await page.getByRole("button", { name: "Approve local draft", exact: true }).click();
  await expect(page.locator("#status-label")).toHaveText("Draft approved");
  await expect(page.locator("#proof-output")).toContainText("reusedStepsThisAttempt");
  await page.reload();
  await expect(page.locator("#status-label")).toHaveText("Draft approved");
});

test("reloading a teaching stop preserves the lesson and cannot approve the draft", async ({ page }) => {
  await page.goto(customerUrl);
  await page.getByRole("button", { name: "Run rescue", exact: true }).click();
  await expect(page.locator("#proof-step")).toHaveValue("route");
  await page.reload();
  await expect(page.locator("#status-label")).toHaveText("Checkpoint");
  await expect(page.locator("#proof-step")).toHaveValue("route");
  await expect(page.getByRole("button", { name: "Approve local draft", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("#proof-step")).toHaveValue("repair");
});

test("Copilot review and evidence controls fit the customer viewport without a stage toggle", async ({ page }) => {
  const report = (await nativeFixture()).report;
  const snapshot = await nativeFixture({
    status: "awaiting-approval", phase: "Approve", report,
    args: { scenario: "capacity", mode: "rehearsal", seed: 42, pauseForApproval: true },
  });
  await page.route("**/api/native/latest", (route) => route.fulfill({ json: { run: snapshot } }));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(copilotUrl);
  await expect(page.locator("#status-label")).toHaveText("Review checkpoint");
  expect(await page.locator("#approval-panel").evaluate((element) => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1080);
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 960, height: 540 }]) {
  test(`the flow remains operable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await begin(page, "mixed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Approve local draft", exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Approve local draft", exact: true }).click();
    await expect(page.locator("#status-label")).toHaveText("Draft approved");
  });
}

test("capture desktop and mobile evidence without page-level overflow", async ({ page, browser, baseURL }, testInfo) => {
  const assets = process.env.LAUNCH_RESCUE_CAPTURE_ARTIFACTS === "1"
    ? join("presentation", "assets") : testInfo.outputPath("screenshots");
  await mkdir(assets, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await begin(page, "mixed");
  await page.screenshot({ path: join(assets, "demo-desktop.png"), fullPage: true });
  const desktopFitsWidth = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  const desktopHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const rectangle = await page.locator("#workflow-graph").boundingBox();
  expect(rectangle).not.toBeNull();
  const scale = rectangle.width / 1540;
  const clippedPaths = await page.locator("#workflow-graph path").evaluateAll((paths) => {
    const clipped = [];
    for (const [index, path] of paths.entries()) {
      const bounds = path.getBBox();
      if (bounds.x < 260 || bounds.x + bounds.width > 1020) {
        path.style.visibility = "hidden";
        clipped.push(index);
      }
    }
    return clipped;
  });
  await page.screenshot({ path: join(assets, "demo-trace.png"),
    clip: { x: rectangle.x + 260 * scale, y: rectangle.y + 32 * scale, width: 760 * scale, height: 312 * scale } });
  await page.locator("#workflow-graph path").evaluateAll((paths, clipped) => {
    clipped.forEach((index) => { paths[index].style.visibility = ""; });
  }, clippedPaths);
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(new URL("/?scoutTheme=light", baseURL).href);
  await mobile.getByRole("button", { name: "Step by step", exact: true }).click();
  await mobile.getByRole("button", { name: "Room switch", exact: true }).click();
  await mobile.getByRole("button", { name: "Run rescue", exact: true }).click();
  await expect(mobile.locator("#status-label")).toHaveText("Review checkpoint");
  await expectCustomerView(mobile);
  expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mobile.screenshot({ path: join(assets, "demo-mobile.png"), fullPage: true });
  await mobile.close();
  expect(desktopFitsWidth).toBe(true);
  expect(desktopHeight).toBeLessThanOrEqual(1080);
});
