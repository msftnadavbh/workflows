import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The SDK expresses AI usage in nano-AI units; the workflow runtime converts
// maxAiCredits with the same factor (NANO_AIU_PER_AIU in the SDK's workflow.js).
export const NANO_AIU_PER_CREDIT = 1e9;

const count = (value) => (Number.isFinite(value) && value >= 0 ? value : 0);
const credits = (nanoAiu) => (Number.isFinite(nanoAiu) && nanoAiu >= 0 ? nanoAiu / NANO_AIU_PER_CREDIT : null);

/**
 * Builds a per-run cost summary from two experimental SDK surfaces:
 * - the run detail's `consumed` block (scoped to this workflow run), and
 * - session usage metrics (per-model tokens; session-wide, which in this
 *   host is the workflow's agents because the main session sends no prompt).
 * Either input may be null when the runtime does not expose it.
 */
export function summarizeCost({ runId, mode, detail, metrics }) {
  const consumed = detail?.consumed ?? null;
  const models = Object.entries(metrics?.modelMetrics ?? {})
    .filter(([, metric]) => metric)
    .map(([model, metric]) => ({
      model,
      requests: count(metric.requests?.count),
      inputTokens: count(metric.usage?.inputTokens),
      cachedInputTokens: count(metric.usage?.cacheReadTokens),
      cacheWriteTokens: count(metric.usage?.cacheWriteTokens),
      outputTokens: count(metric.usage?.outputTokens),
      reasoningTokens: count(metric.usage?.reasoningTokens),
      aiCredits: credits(metric.totalNanoAiu),
    }))
    .sort((a, b) => (b.aiCredits ?? 0) - (a.aiCredits ?? 0));
  const agents = Object.entries(metrics?.agentMetrics ?? {})
    .filter(([, metric]) => metric && metric.agentName)
    .map(([id, metric]) => ({
      id, agent: metric.agentName, label: metric.agentDisplayName ?? null,
      models: Object.keys(metric.modelMetrics ?? {}),
      aiCredits: credits(metric.totalNanoAiu),
    }));
  const total = (key) => models.reduce((sum, row) => sum + row[key], 0);
  return {
    runId, mode,
    measuredAt: new Date().toISOString(),
    run: consumed ? {
      aiCredits: credits(consumed.nanoAiu),
      subagents: count(consumed.subagents),
      activeSeconds: Math.round(count(consumed.activeMs) / 100) / 10,
    } : null,
    totals: {
      requests: total("requests"),
      inputTokens: total("inputTokens"),
      cachedInputTokens: total("cachedInputTokens"),
      cacheWriteTokens: total("cacheWriteTokens"),
      outputTokens: total("outputTokens"),
      reasoningTokens: total("reasoningTokens"),
    },
    models,
    agents,
    notes: [
      "Measured by the Copilot runtime (experimental usage APIs). AI-credit accounting is post-paid and approximate.",
      "Token rows are session-wide; run.aiCredits is scoped to this workflow run.",
      "Synthetic demo workload: not a benchmark of production cost.",
    ],
  };
}

const n = (value) => value.toLocaleString("en-US");
const c = (value) => (value === null ? "n/a" : value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2));

export function formatCost(summary) {
  const lines = ["", "Cost of this run (measured by the Copilot runtime)"];
  if (summary.run) {
    lines.push(`  Run total: ${c(summary.run.aiCredits)} AI credits · ${summary.run.subagents} subagents · ${summary.run.activeSeconds}s active`);
  } else {
    lines.push("  Run total: not reported by this runtime");
  }
  if (summary.models.length === 0) {
    lines.push(summary.mode === "live" ? "  No per-model usage was reported." : "  Rehearsal mode: no model calls, no tokens.");
    return lines.join("\n");
  }
  const rows = summary.models.map((row) => [
    row.model, n(row.requests), n(row.inputTokens), n(row.cachedInputTokens), n(row.outputTokens), c(row.aiCredits),
  ]);
  const header = ["Model", "Requests", "Input", "Cached in", "Output", "AI credits"];
  const widths = header.map((title, i) => Math.max(title.length, ...rows.map((row) => row[i].length)));
  const render = (row) => "  " + row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
  lines.push(render(header), "  " + widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(render));
  const cachedShare = summary.totals.inputTokens + summary.totals.cachedInputTokens > 0
    ? Math.round(100 * summary.totals.cachedInputTokens / (summary.totals.inputTokens + summary.totals.cachedInputTokens))
    : 0;
  lines.push(`  Cache hits: ${cachedShare}% of input tokens.`);
  return lines.join("\n");
}

/** Best effort: metering must never change the run's outcome. */
export async function recordRunCost({ root, session, runId, mode, log = console.log, warn = console.warn }) {
  let detail = null;
  let metrics = null;
  try { detail = await session.workflow.getRunDetail(runId); }
  catch (error) { warn(`Cost meter: run detail unavailable (${error instanceof Error ? error.message : String(error)}).`); }
  try { metrics = await session.rpc.usage.getMetrics(); }
  catch (error) { warn(`Cost meter: usage metrics unavailable (${error instanceof Error ? error.message : String(error)}).`); }
  if (!detail && !metrics) return null;
  const summary = summarizeCost({ runId, mode, detail, metrics });
  try {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error("Invalid workflow run ID.");
    const directory = join(root, "runs", runId);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "cost.json"), JSON.stringify(summary, null, 2), "utf8");
  } catch (error) {
    warn(`Cost meter: could not write cost.json (${error instanceof Error ? error.message : String(error)}).`);
  }
  log(formatCost(summary));
  return summary;
}
