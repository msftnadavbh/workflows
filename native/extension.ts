import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  defineWorkflow, joinSession, type JsonValue, type WorkflowMeta,
} from "@github/copilot-sdk/extension";
import { runLaunchRescue, validateArgs, type RunContext, type RunReport, type WorkflowEvent } from "../demo/core.js";
import { assertResolvedModel, writeAtomic } from "./io.js";
import { reconcileNativeRun } from "./reconcile.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const ownedRuns = new Set<string>();
const meta: WorkflowMeta = {
  name: "launch-rescue",
  description: "Rescue a synthetic 2,500-attendee ticket launch. Evidence routes bounded specialists, real checks gate the draft, and a checkpoint enables review/resume. args: scenario (retries/capacity/parallel/mixed), mode (rehearsal/live), seed, pauseForApproval.",
  phases: ["Observe", "Diagnose", "Repair", "Verify", "Adapt", "Challenge", "Approve", "Complete"].map((title) => ({ title })),
  argsSchema: {
    type: "object",
    properties: {
      scenario: { type: "string", enum: ["retries", "capacity", "parallel", "mixed"] },
      mode: { type: "string", enum: ["rehearsal", "live"] },
      seed: { type: "integer" },
      pauseForApproval: { type: "boolean" },
    },
  },
  limits: { maxConcurrentSubagents: 2, maxTotalSubagents: 6, timeoutSeconds: 480 },
};

const rescue = defineWorkflow({
  meta,
  run: async (ctx) => {
    const args = validateArgs(ctx.args);
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(ctx.runId)) throw new Error("Invalid workflow run ID.");
    ownedRuns.add(ctx.runId);
    const directory = join(root, "runs", ctx.runId);
    await mkdir(directory, { recursive: true });
    const startingEnvelope = await ctx.session.workflow.getRun(ctx.runId);
    const events = new Map<string, WorkflowEvent>();
    let report: RunReport | null = null;
    let currentPhase = "Observe";
    let writes = Promise.resolve();
    const persist = async (status: string, error: string | null = null) => {
      const hostPid = process.env.LAUNCH_RESCUE_HOST_PID ? Number(process.env.LAUNCH_RESCUE_HOST_PID) : null;
      if (hostPid !== null && (!Number.isSafeInteger(hostPid) || hostPid <= 0)) {
        throw new Error("Invalid SDK host identity.");
      }
      const snapshot: JsonValue = {
        engine: "copilot-runtime", runId: ctx.runId, sessionId: ctx.session.sessionId,
        attempt: startingEnvelope.attempt ?? null,
        controller: process.env.LAUNCH_RESCUE_HOST === "sdk" ? "sdk-terminal" : "copilot-session",
        hostPid,
        args, status, error,
        updatedAt: new Date().toISOString(), phase: currentPhase, events: [...events.values()], report,
      };
      const write = writes.then(() => writeAtomic(join(directory, "state.json"), snapshot));
      writes = write.then(() => undefined, (error: unknown) => {
        console.error(`Native observation write failed: ${error instanceof Error ? error.message : String(error)}`);
      });
      await write;
    };
    await persist("running");
    const guarded: RunContext = {
      runId: ctx.runId, args: ctx.args, signal: ctx.signal,
      phase: (title) => ctx.phase(title),
      log: (message) => ctx.log(message),
      step: (key, producer, options) => ctx.step(key, producer, options),
      parallel: (thunks) => ctx.parallel(thunks),
      pause: (key) => ctx.pause(key),
      agent: async (prompt, options) => {
        const value = await ctx.agent(prompt, options);
        if (value !== null) {
          const detail = await ctx.session.workflow.getRunDetail(ctx.runId);
          assertResolvedModel(detail.agents, options?.label, options?.model);
        }
        return value;
      },
    };
    try {
      const result = await runLaunchRescue(guarded, async (event) => {
        events.set(`${event.type}:${event.id}`, event);
        if (event.type === "phase") currentPhase = event.title;
        if (event.type === "ready" || event.type === "complete") {
          report = event.report;
          await writeAtomic(join(directory, "report.json"), report);
        }
        ctx.log(event.type === "phase" ? `Phase: ${event.title}`
          : event.type === "branch" ? event.title
          : event.type === "task" ? `${event.state}: ${event.title}` : event.type);
        await persist(event.type === "ready" && args.pauseForApproval ? "awaiting-approval"
          : event.type === "complete" ? "completed" : "running");
      });
      await persist("completed");
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cleanupErrors: unknown[] = [];
      let status = "error";
      let paused = false;
      try {
        const envelope = await ctx.session.workflow.getRun(ctx.runId);
        paused = envelope.status === "paused";
        status = ctx.signal.aborted && (envelope.status === "running" || envelope.status === "pending") ? "settling"
          : paused ? report !== null ? "awaiting-approval" : "paused"
          : envelope.status === "cancelled" ? "cancelled" : envelope.status === "halted" ? "halted" : "error";
      } catch (observationError) {
        cleanupErrors.push(observationError);
        console.error(`Native lifecycle observation failed: ${String(observationError)}`);
      }
      try { await persist(status, paused || status === "settling" ? null : message); }
      catch (writeError) { cleanupErrors.push(writeError); }
      if (cleanupErrors.length) {
        throw new AggregateError([error, ...cleanupErrors], `Workflow failed: ${message}. Observation cleanup also failed.`);
      }
      throw error;
    }
  },
});

const session = await joinSession({ workflows: [rescue] });
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
session.on("workflow.run_updated", (event) => {
  const runId = event.data.runId;
  if (!ownedRuns.has(runId)) return;
  const previous = refreshTimers.get(runId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    refreshTimers.delete(runId);
    void session.workflow.getRun(runId).then((run) => reconcileNativeRun(root, run)).catch((error: unknown) => {
      console.error(`Native lifecycle reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, 50);
  timer.unref();
  refreshTimers.set(runId, timer);
});
