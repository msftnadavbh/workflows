import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../dist/core.mjs";
import { writeAtomic } from "../dist/io.mjs";

// The SDK expresses AI usage in nano-AI units; the workflow runtime converts
// maxAiCredits with the same factor (NANO_AIU_PER_AIU in the SDK's workflow.js).
export const NANO_AIU_PER_CREDIT = 1e9;

const count = (value) => (Number.isFinite(value) && value >= 0 ? value : null);
const credits = (nanoAiu) => (Number.isFinite(nanoAiu) && nanoAiu >= 0 ? nanoAiu / NANO_AIU_PER_CREDIT : null);

/**
 * Builds a per-run cost summary from two experimental SDK surfaces:
 * - the run detail's `consumed` block (scoped to this workflow run), and
 * - session usage metrics (per-model tokens; not independently run-scoped).
 * Either input may be null when the runtime does not expose it.
 */
export function summarizeCost({ runId, mode, detail, metrics }) {
  const consumed = isRecord(detail?.consumed) ? detail.consumed : null;
  const modelMetrics = isRecord(metrics?.modelMetrics) ? metrics.modelMetrics : null;
  const models = Object.entries(modelMetrics ?? {})
    .filter(([, metric]) => isRecord(metric))
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
    .filter(([, metric]) => isRecord(metric) && typeof metric.agentName === "string")
    .map(([id, metric]) => ({
      id, agent: metric.agentName, label: metric.agentDisplayName ?? null,
      models: Object.keys(metric.modelMetrics ?? {}),
      aiCredits: credits(metric.totalNanoAiu),
    }));
  const total = (key) => modelMetrics === null || models.some((row) => row[key] === null)
    ? null : models.reduce((sum, row) => sum + row[key], 0);
  const activeMs = count(consumed?.activeMs);
  return {
    runId, mode,
    measuredAt: new Date().toISOString(),
    run: consumed ? {
      aiCredits: credits(consumed.nanoAiu),
      subagents: count(consumed.subagents),
      activeSeconds: activeMs === null ? null : Math.round(activeMs / 100) / 10,
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

const n = (value) => value === null ? "n/a" : value.toLocaleString("en-US");
const c = (value) => (value === null ? "n/a" : value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2));

export function formatCost(summary) {
  const lines = ["", "Cost of this run (measured by the Copilot runtime)"];
  if (summary.run) {
    lines.push(`  Run total: ${c(summary.run.aiCredits)} AI credits · ${n(summary.run.subagents)} subagents · ${n(summary.run.activeSeconds)}s active`);
  } else {
    lines.push("  Run total: not reported by this runtime");
  }
  if (summary.models.length === 0) {
    lines.push(summary.mode === "live" ? "  No per-model usage was reported." : "  JavaScript workers only; no model calls.");
    return lines.join("\n");
  }
  lines.push("  Per-model session usage (not independently run-scoped):");
  const rows = summary.models.map((row) => [
    row.model, n(row.requests), n(row.inputTokens), n(row.cachedInputTokens), n(row.outputTokens), c(row.aiCredits),
  ]);
  const header = ["Model", "Requests", "Input", "Cached in", "Output", "AI credits"];
  const widths = header.map((title, i) => Math.max(title.length, ...rows.map((row) => row[i].length)));
  const render = (row) => "  " + row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ");
  lines.push(render(header), "  " + widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(render));
  const cachedShare = summary.totals.inputTokens === null || summary.totals.cachedInputTokens === null ? null
    : summary.totals.inputTokens + summary.totals.cachedInputTokens > 0
    ? Math.round(100 * summary.totals.cachedInputTokens / (summary.totals.inputTokens + summary.totals.cachedInputTokens))
    : 0;
  lines.push(`  Cache reads: ${n(summary.totals.cachedInputTokens)} tokens (${cachedShare === null ? "share unavailable" : `${cachedShare}% of reported input + cache-read tokens`}).`);
  return lines.join("\n");
}

/** Best effort: metering must never change the run's outcome. */
export async function recordRunCost({ root, session, runId, mode, log = console.log, warn = console.warn }) {
  if (typeof runId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) {
    warn("Cost meter: Invalid workflow run ID. No cost artifact was written.");
    return null;
  }
  const readUsage = async (read, name) => {
    let timer;
    try {
      return await Promise.race([read(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out after 5 seconds.")), 5000);
      })]);
    } catch (error) {
      warn(`Cost meter: ${name} unavailable (${error instanceof Error ? error.message : String(error)}).`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const [detail, metrics] = await Promise.all([
    readUsage(() => session.workflow.getRunDetail(runId), "run detail"),
    readUsage(() => session.rpc.usage.getMetrics(), "usage metrics"),
  ]);
  if (!detail && !metrics) return null;
  const summary = summarizeCost({ runId, mode, detail, metrics });
  try {
    const directory = join(root, "runs", runId);
    await mkdir(directory, { recursive: true });
    await writeAtomic(join(directory, "cost.json"), summary);
  } catch (error) {
    warn(`Cost meter: could not write cost.json (${error instanceof Error ? error.message : String(error)}).`);
  }
  log(formatCost(summary));
  return summary;
}
