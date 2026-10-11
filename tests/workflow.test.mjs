import assert from "node:assert/strict";
import test from "node:test";
import { ANALYST, REVIEWER, VERSION, isWalkthroughCheckpoint, runLaunchRescue, validateArgs } from "../dist/core.mjs";
import { CheckpointPause, LocalContext, PresenterPause, UserCancel, newJournal } from "../dist/local-context.mjs";

function recorder() {
  const events = [];
  return { events, emit: async (event) => { events.push(structuredClone(event)); } };
}

for (const [scenario, repairs, rounds, confirmed, waitlisted] of [
  ["retries", ["dedupe"], 1, 2500, 0], ["capacity", ["capacity"], 1, 2300, 200],
  ["parallel", ["dedupe", "capacity"], 1, 2300, 200], ["mixed", ["dedupe", "capacity"], 2, 2300, 200],
]) {
  test(`${scenario}: evidence selects the exact execution path`, async () => {
    const args = validateArgs({ scenario, pauseForApproval: false });
    const ctx = new LocalContext(newJournal(args));
    const { events, emit } = recorder();
    const result = await runLaunchRescue(ctx, emit);
    assert.deepEqual(result.repairs.map((proposal) => proposal.repair), repairs);
    assert.equal(result.verificationRounds, rounds);
    assert.equal(result.after.uniqueConfirmed, confirmed);
    assert.equal(result.after.waitlisted, waitlisted);
    assert.equal(result.status, "draft", "No checkpoint means no approval may be claimed.");
    assert.ok(result.after.checks.every((check) => check.passed));
    assert.equal(events.some((event) => event.type === "twist"), scenario === "mixed");
    assert.equal(events.some((event) => event.id === "capacity-specialist-2"), scenario === "mixed");
    assert.ok(events.filter((event) => event.type === "task").every((event) => event.kind !== "agent"),
      "Rehearsal must never label functions as model agents.");
  });
}

test("durable review checkpoint reuses every completed producer on resume", async () => {
  const journal = newJournal(validateArgs({ scenario: "mixed", pauseForApproval: true }));
  const ctx = new LocalContext(journal);
  const first = recorder();
  await assert.rejects(runLaunchRescue(ctx, first.emit), CheckpointPause);
  const steps = Object.keys(journal.steps);
  assert.ok(steps.includes(`${VERSION}:reviewer`));
  assert.equal(journal.checkpoints[`${VERSION}:approve-local-draft`], true);
  const resumed = new LocalContext(structuredClone(journal));
  const second = recorder();
  const result = await runLaunchRescue(resumed, second.emit);
  assert.equal(result.status, "approved");
  assert.equal(resumed.producerCounts.size, 0, "No saved producer should execute again.");
  assert.equal(Object.keys(resumed.journal.steps).length, steps.length);
  assert.deepEqual(result.after, first.events.find((event) => event.type === "ready").report.after);
});

test("presenter pause preserves completed evidence but does not authorize a draft", async () => {
  const journal = newJournal(validateArgs({ scenario: "retries", pauseForApproval: false }));
  const ctx = new LocalContext(journal);
  await assert.rejects(runLaunchRescue(ctx, async (event) => {
    if (event.type === "branch") ctx.pauseNow();
  }), PresenterPause);
  assert.ok(Object.hasOwn(journal.steps, `${VERSION}:baseline`));
  assert.ok(!Object.hasOwn(journal.steps, `${VERSION}:reviewer`));
  const resumed = new LocalContext(journal);
  const result = await runLaunchRescue(resumed, async () => {});
  assert.equal(result.status, "draft");
  assert.ok(!resumed.producerCounts.has(`${VERSION}:baseline`));
});

test("cancellation stops before any release artifact", async () => {
  const ctx = new LocalContext(newJournal(validateArgs({ pauseForApproval: false })));
  const events = [];
  await assert.rejects(runLaunchRescue(ctx, async (event) => {
    events.push(event);
    if (event.type === "phase") ctx.cancel();
  }), UserCancel);
  assert.ok(!events.some((event) => event.type === "ready" || event.type === "complete"));
});

function liveStub(args, respond) {
  const calls = [];
  const cache = new Map();
  const checkpoints = new Set();
  const signal = new AbortController().signal;
  const ctx = {
    runId: "native-unit-fixture", args, signal, phase() {}, log() {},
    async step(key, producer) {
      if (!cache.has(key)) cache.set(key, await producer());
      return structuredClone(cache.get(key));
    },
    async parallel(thunks) {
      return Promise.all(thunks.map(async (thunk) => {
        try { return await thunk(); } catch (error) {
          if (error.name === "ResponseError" || error.name === "AbortError") throw error;
          return null;
        }
      }));
    },
    async agent(prompt, options) { calls.push({ prompt, options }); return respond(prompt, options); },
    async pause(key) {
      if (!checkpoints.has(key)) { checkpoints.add(key); throw new CheckpointPause(key); }
    },
  };
  return { ctx, calls };
}

function validAgent(_prompt, options) {
  if (options.agent === "launch-reviewer") {
    return { verdict: "accept", rationale: "The independently supplied deterministic checks all pass without unknown evidence.",
      evidenceIds: ["E-RETRY", "E-INVENTORY"] };
  }
  const repair = options.schema.properties.repair.const;
  return { repair, rationale: "Apply only this bounded policy based on the measured synthetic evidence.",
    evidenceIds: [repair === "dedupe" ? "E-RETRY" : "E-INVENTORY"] };
}

test("live routing pins Sol max and independent Sonnet high without fallback", async () => {
  const { ctx, calls } = liveStub(validateArgs({ scenario: "mixed", mode: "live", pauseForApproval: false }), validAgent);
  const result = await runLaunchRescue(ctx, async () => {});
  assert.equal(result.after.uniqueConfirmed, 2300);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(0, 2).map((call) => [call.options.model, call.options.reasoningEffort]),
    [[ANALYST.model, "max"], [ANALYST.model, "max"]]);
  assert.equal(calls[2].options.model, REVIEWER.model);
  assert.equal(calls[2].options.reasoningEffort, "high");
  assert.equal(new Set(calls.map((call) => call.options.label)).size, 3);
  assert.ok(calls.every((call) => call.options.schema));
});

test("live specialist context stays scoped and every repair preserves its observation round", async () => {
  const { ctx, calls } = liveStub(validateArgs({ scenario: "mixed", mode: "live", pauseForApproval: false }), validAgent);
  const emitted = [];
  const report = await runLaunchRescue(ctx, async (event) => { emitted.push(event); });
  const dedupe = calls.find((call) => call.options.label === "dedupe-specialist-1");
  const capacity = calls.find((call) => call.options.label === "capacity-specialist-2");
  const reviewer = calls.find((call) => call.options.label === "independent-review");
  assert.ok(dedupe.prompt.includes("E-RETRY"));
  assert.ok(!dedupe.prompt.includes("E-INVENTORY"), "Irrelevant inventory must not enter the retry specialist context.");
  assert.ok(capacity.prompt.includes("E-INVENTORY"));
  assert.ok(!capacity.prompt.includes("E-RETRY"));
  assert.match(reviewer.prompt, /immutable evidenceSnapshot/);
  assert.match(reviewer.prompt, /changed after round 1/);
  assert.ok(calls.every((call) => call.prompt.includes("12 to 1200 characters")
    && call.prompt.includes("no repeated or unknown IDs")), "Every model must receive its actual output constraints.");
  assert.deepEqual(report.repairs.map((repair) => [repair.round, repair.evidenceSnapshot[0].id, repair.evidenceSnapshot[0].count]),
    [[1, "E-RETRY", 500], [2, "E-INVENTORY", 200]]);
  const initial = emitted.find((event) => event.type === "evidence");
  assert.equal(initial.evidence.find((item) => item.id === "E-INVENTORY").count, 0,
    "Later input changes must not mutate the initial execution event.");
});

test("live checkpoint resume does not spawn agents for completed saved work", async () => {
  const { ctx, calls } = liveStub(validateArgs({ scenario: "mixed", mode: "live", pauseForApproval: true }), validAgent);
  await assert.rejects(runLaunchRescue(ctx, async () => {}), CheckpointPause);
  assert.equal(calls.length, 3);
  const emitted = [];
  const result = await runLaunchRescue(ctx, async (event) => { emitted.push(event); });
  assert.equal(result.status, "approved");
  assert.equal(calls.length, 3);
  assert.equal(emitted.find((event) => event.type === "ready").report.status, "draft");
  assert.equal(emitted.find((event) => event.type === "complete").report.status, "approved");
});

test("both-at-once really overlaps two independent specialist calls", async () => {
  let active = 0;
  let peak = 0;
  const { ctx } = liveStub(validateArgs({ scenario: "parallel", mode: "live", pauseForApproval: false }),
    async (prompt, options) => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return validAgent(prompt, options);
    });
  await runLaunchRescue(ctx, async () => {});
  assert.equal(peak, 2);
});

test("null or malformed specialist outputs visibly hold the candidate", async () => {
  for (const response of [null, { repair: "dedupe", rationale: "Invent a fake evidence ID for this repair.", evidenceIds: ["FAKE"] }]) {
    const { ctx } = liveStub(validateArgs({ mode: "live", scenario: "retries", pauseForApproval: false }), () => response);
    const { events, emit } = recorder();
    await assert.rejects(runLaunchRescue(ctx, emit), /required specialist failed/);
    assert.ok(events.some((event) => event.type === "task" && event.state === "error"));
    assert.ok(!events.some((event) => event.type === "ready"));
  }
});

test("independent reviewer rejection cannot become a successful report", async () => {
  const { ctx } = liveStub(validateArgs({ mode: "live", scenario: "retries", pauseForApproval: false }),
    (prompt, options) => options.agent === "launch-reviewer"
      ? { verdict: "reject", rationale: "The reviewer requires additional evidence before a release is authorized.", evidenceIds: ["E-RETRY"] }
      : validAgent(prompt, options));
  await assert.rejects(runLaunchRescue(ctx, async () => {}), /reviewer held the candidate/);
});

test("hard runtime failures propagate rather than becoming ordinary null results", async () => {
  const { ctx } = liveStub(validateArgs({ mode: "live", scenario: "parallel", pauseForApproval: false }), () => {
    const error = new Error("workflow_limit_reached");
    error.name = "ResponseError";
    throw error;
  });
  await assert.rejects(runLaunchRescue(ctx, async () => {}), /workflow_limit_reached/);
});

for (const scenario of ["retries", "capacity", "parallel", "mixed"]) {
  test(`${scenario}: guided feature stops are durable and distinct from final approval`, async () => {
      const args = validateArgs({ scenario, walkthrough: true, pauseForApproval: true });
      const journal = newJournal(args);
      const stops = [];
      const producers = new Map();
      let report;
      for (let attempt = 0; attempt < 10 && !report; attempt++) {
        const ctx = new LocalContext(journal);
        try { report = await runLaunchRescue(ctx, async () => {}); }
        catch (error) {
          assert.ok(error instanceof CheckpointPause);
          stops.push(error.key);
        }
        for (const [key, count] of ctx.producerCounts) producers.set(key, (producers.get(key) ?? 0) + count);
      }
      assert.ok(report);
      assert.equal(report.status, "approved");
      const lessons = ["route", "repair", ...(scenario === "mixed" ? ["adapt"] : []), "verify", "review"];
      assert.deepEqual(stops.filter(isWalkthroughCheckpoint), lessons.map((id) => `${VERSION}:walkthrough:${id}`));
      assert.equal(stops.at(-1), `${VERSION}:approve-local-draft`);
      assert.ok([...producers.values()].every((count) => count === 1), "Saved producers must not execute again on NEXT.");
  });
}

test("feature proofs contain actual supplied prompts and validated agent responses", async () => {
    const { ctx, calls } = liveStub(validateArgs({ scenario: "mixed", mode: "live", walkthrough: true, pauseForApproval: true }), validAgent);
    const proofs = new Map();
    const stops = [];
    let result;
    for (let attempt = 0; attempt < 10 && !result; attempt++) {
      try { result = await runLaunchRescue(ctx, async (event) => { if (event.type === "feature") proofs.set(event.id, event); }); }
      catch (error) {
        assert.ok(error instanceof CheckpointPause);
        stops.push({ key: error.key, agentCalls: calls.length });
      }
    }
    assert.equal(calls.length, 3);
    assert.deepEqual(stops.filter((stop) => stop.key.endsWith(":route")).map((stop) => stop.agentCalls), [0]);
    assert.deepEqual(stops.filter((stop) => stop.key.endsWith(":adapt")).map((stop) => stop.agentCalls), [1]);
    const handoffs = [...proofs.values()].flatMap((proof) => proof.handoffs);
    for (const call of calls) {
      const proof = handoffs.find((handoff) => handoff.label === call.options.label);
      assert.ok(proof);
      assert.equal(proof.source, "model");
      assert.equal(proof.prompt, call.prompt);
      assert.equal(proof.model, call.options.model);
      assert.equal(proof.reasoningEffort, call.options.reasoningEffort);
      assert.ok(proof.result.rationale);
    }
    assert.ok(proofs.get("complete").output.reusedStepsThisAttempt > 0);
});

test("rehearsal feature proofs never claim that their JavaScript substitutes are agents", async () => {
    const ctx = new LocalContext(newJournal(validateArgs({ scenario: "mixed", pauseForApproval: false })));
    const proofs = [];
    await runLaunchRescue(ctx, async (event) => { if (event.type === "feature") proofs.push(event); });
    const handoffs = proofs.flatMap((proof) => proof.handoffs);
    assert.equal(handoffs.length, 3);
    assert.ok(handoffs.every((handoff) => handoff.source === "javascript" && handoff.model === null && handoff.reasoningEffort === null));
    assert.ok(proofs.some((proof) => proof.feature === "dynamic"));
    assert.ok(proofs.some((proof) => proof.feature === "checks"));
});
