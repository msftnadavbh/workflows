import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatCost, recordRunCost, summarizeCost } from "../native/cost.mjs";

const metrics = {
  modelMetrics: {
    "claude-sonnet-5.5": {
      requests: { count: 1, cost: 0 },
      usage: { inputTokens: 4000, cacheReadTokens: 0, cacheWriteTokens: 1200, outputTokens: 900 },
      totalNanoAiu: 2_500_000_000,
    },
    "gpt-6.1-sol": {
      requests: { count: 3, cost: 0 },
      usage: { inputTokens: 9000, cacheReadTokens: 27000, cacheWriteTokens: 0, outputTokens: 3000, reasoningTokens: 2000 },
      totalNanoAiu: 6_000_000_000,
    },
  },
  agentMetrics: {
    main: { modelMetrics: {}, totalApiDurationMs: 0, totalNanoAiu: 0 },
    a1: { agentName: "launch-analyst", agentDisplayName: "retry-repair", modelMetrics: { "gpt-6.1-sol": {} }, totalApiDurationMs: 10, totalNanoAiu: 6_000_000_000 },
  },
};
const detail = { consumed: { nanoAiu: 8_500_000_000, subagents: 4, activeMs: 61_234 } };

test("cost summary converts nano-AIU to AI credits and sorts models by spend", () => {
  const summary = summarizeCost({ runId: "run_1", mode: "live", detail, metrics });
  assert.equal(summary.run.aiCredits, 8.5);
  assert.equal(summary.run.subagents, 4);
  assert.equal(summary.run.activeSeconds, 61.2);
  assert.deepEqual(summary.models.map((row) => row.model), ["gpt-6.1-sol", "claude-sonnet-5.5"]);
  assert.equal(summary.models[0].aiCredits, 6);
  assert.equal(summary.totals.inputTokens, 13000);
  assert.equal(summary.totals.cachedInputTokens, 27000);
  assert.equal(summary.totals.reasoningTokens, 2000);
  assert.deepEqual(summary.agents.map((row) => row.agent), ["launch-analyst"], "the main session is not reported as an agent");
});

test("cost table shows each model and the cache-hit share", () => {
  const text = formatCost(summarizeCost({ runId: "run_1", mode: "live", detail, metrics }));
  assert.match(text, /Run total: 8\.50 AI credits · 4 subagents/);
  assert.match(text, /gpt-6\.1-sol\s+3\s+9,000\s+27,000\s+3,000\s+6\.00/);
  assert.match(text, /Cache hits: 68% of input tokens/);
});

test("rehearsal runs report zero model usage without inventing a cost", () => {
  const summary = summarizeCost({ runId: "run_2", mode: "rehearsal", detail: { consumed: { nanoAiu: 0, subagents: 0, activeMs: 900 } }, metrics: { modelMetrics: {} } });
  assert.equal(summary.run.aiCredits, 0);
  assert.match(formatCost(summary), /Rehearsal mode: no model calls, no tokens\./);
});

test("missing or malformed metrics never become a fabricated number", () => {
  const summary = summarizeCost({ runId: "run_3", mode: "live", detail: null, metrics: { modelMetrics: { x: { usage: { inputTokens: -5 } } } } });
  assert.equal(summary.run, null);
  assert.equal(summary.models[0].inputTokens, 0);
  assert.equal(summary.models[0].aiCredits, null);
  assert.match(formatCost(summary), /not reported by this runtime/);
});

test("metering failures are reported but never fail the run", async () => {
  const warnings = [];
  const session = {
    workflow: { getRunDetail: async () => { throw new Error("detail offline"); } },
    rpc: { usage: { getMetrics: async () => { throw new Error("metrics offline"); } } },
  };
  const result = await recordRunCost({ root: tmpdir(), session, runId: "run_4", mode: "live", log: () => {}, warn: (m) => warnings.push(m) });
  assert.equal(result, null);
  assert.equal(warnings.length, 2);
});

test("cost.json is written beside the run's other artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "launch-cost-"));
  try {
    const session = { workflow: { getRunDetail: async () => detail }, rpc: { usage: { getMetrics: async () => metrics } } };
    const lines = [];
    await recordRunCost({ root, session, runId: "run_5", mode: "live", log: (m) => lines.push(m), warn: () => {} });
    const saved = JSON.parse(await readFile(join(root, "runs", "run_5", "cost.json"), "utf8"));
    assert.equal(saved.run.aiCredits, 8.5);
    assert.equal(lines.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unsafe run ID is never used as a path", async () => {
  const warnings = [];
  const session = { workflow: { getRunDetail: async () => detail }, rpc: { usage: { getMetrics: async () => metrics } } };
  await recordRunCost({ root: tmpdir(), session, runId: "../escape", mode: "live", log: () => {}, warn: (m) => warnings.push(m) });
  assert.match(warnings[0], /Invalid workflow run ID/);
});
