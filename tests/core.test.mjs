import assert from "node:assert/strict";
import test from "node:test";
import {
  allocate, evaluate, inspectInventory, inspectRequests, makeFixture,
  validateArgs, validateEvaluation, validateProposal,
} from "../dist/core.mjs";

for (const [scenario, duplicates, oversold, requests] of [
  ["retries", 500, 500, 3000], ["capacity", 0, 200, 2500],
  ["parallel", 500, 700, 3000], ["mixed", 500, 500, 3000],
]) {
  test(`${scenario}: reproduce exact synthetic failure counts`, () => {
    const args = validateArgs({ scenario, seed: 42 });
    const fixture = makeFixture(args);
    const result = evaluate(fixture, { dedupe: false, capacity: false });
    assert.equal(result.duplicateOutcomes, duplicates);
    assert.equal(result.oversoldSeats, oversold);
    assert.equal(result.requestCount, requests);
    assert.equal(result.missingAttendees, 0);
    assert.equal(inspectRequests(fixture).count, duplicates);
    assert.equal(inspectInventory(fixture).count, scenario === "capacity" || scenario === "parallel" ? 200 : 0);
  });
}

test("all repaired outcomes respect identity, capacity, and coverage", () => {
  for (const seed of [1, 42, 991, 9999999]) {
    const args = validateArgs({ scenario: "parallel", seed });
    const fixture = makeFixture(args);
    const result = evaluate(fixture, { dedupe: true, capacity: true });
    assert.equal(result.uniqueConfirmed, 2300);
    assert.equal(result.waitlisted, 200);
    assert.equal(result.ignoredRetries, 500);
    assert.ok(result.checks.every((check) => check.passed));
    const allocations = allocate(fixture, { dedupe: true, capacity: true }).outcomes;
    assert.equal(new Set(allocations.map((item) => item.ticket)).size, 2500);
    assert.equal(allocations.length, 2500);
  }
});

test("same seed is reproducible; a different seed changes actual ticket ordering", () => {
  const first = makeFixture(validateArgs({ seed: 42 }));
  const second = makeFixture(validateArgs({ seed: 42 }));
  const third = makeFixture(validateArgs({ seed: 43 }));
  assert.deepEqual(first, second);
  assert.notDeepEqual(first.tickets, third.tickets);
});

test("semantic input validation rejects constraints the SDK schema does not enforce", () => {
  for (const value of [null, [], { seed: 0 }, { seed: 1.5 }, { seed: 10000000 },
    { seed: "42" }, { mode: "pretend-live" }, { scenario: "deploy" }, { pauseForApproval: "yes" },
    { walkthrough: "yes" }, { scenario: "mixed", outputDirectory: "..\\private" }]) {
    assert.throws(() => validateArgs(value));
  }
});

test("bounded proposals require known evidence and the expected repair", () => {
  const evidence = [{ id: "E-RETRY", count: 500, summary: "Measured retries." }];
  assert.throws(() => validateProposal({ repair: "dedupe", rationale: "Trust me, execute this code.",
    evidenceIds: ["invented"] }, "dedupe", evidence));
  assert.throws(() => validateProposal({ repair: "capacity", rationale: "Change capacity despite the expected retry branch.",
    evidenceIds: ["E-RETRY"] }, "dedupe", evidence));
  assert.throws(() => validateProposal(null, "dedupe", evidence));
});

test("saved check flags cannot contradict measured outcomes", () => {
  const result = evaluate(makeFixture(validateArgs({ scenario: "retries" })), { dedupe: false, capacity: false });
  const corrupted = structuredClone(result);
  corrupted.checks.forEach((check) => { check.passed = true; });
  assert.throws(() => validateEvaluation(corrupted), /do not agree/);
});
