import type { JsonValue } from "@github/copilot-sdk/extension";
import {
  ATTENDEES, VERSION, WorkflowError, isJsonValue, isRecord, runLaunchRescue, validateArgs,
  validateEvaluation, validateRepairRecord, validateVerdict,
  type Evaluation, type Evidence, type RunReport, type Scenario, type WorkflowEvent,
} from "./core.js";
import {
  CheckpointPause, LocalContext, PresenterPause, UserCancel, newJournal, type Journal,
} from "./local-context.js";

declare const __WORKFLOW_SOURCE__: string;
type UiStatus = "idle" | "running" | "paused" | "awaiting-approval" | "completed" | "cancelled" | "held" | "error" | "observing";
type NativeSnapshot = {
  runId: string; sessionId: string; args: ReturnType<typeof validateArgs>; status: string; phase: string;
  controller: "sdk-terminal" | "copilot-session";
  updatedAt: string; events: WorkflowEvent[]; report: RunReport | null; error: string | null;
};
type SavedState = {
  journal: Journal; events: WorkflowEvent[]; status: UiStatus; phase: string; report: RunReport | null;
};
type TaskEvent = Extract<WorkflowEvent, { type: "task" }>;
type GraphNode = { id: string; x: number; y: number; lines: string[] };

const STORAGE_KEY = "launch-rescue.rehearsal.v2";
const SVG_NS = "http://www.w3.org/2000/svg";

function byId(id: string): HTMLElement {
  const value = document.getElementById(id);
  if (!(value instanceof HTMLElement)) throw new Error(`Missing interface element: ${id}`);
  return value;
}
function button(id: string): HTMLButtonElement {
  const value = byId(id);
  if (!(value instanceof HTMLButtonElement)) throw new Error(`Expected a button: ${id}`);
  return value;
}
function input(id: string): HTMLInputElement {
  const value = byId(id);
  if (!(value instanceof HTMLInputElement)) throw new Error(`Expected an input: ${id}`);
  return value;
}
function select(id: string): HTMLSelectElement {
  const value = byId(id);
  if (!(value instanceof HTMLSelectElement)) throw new Error(`Expected a select: ${id}`);
  return value;
}
function text(id: string, value: string): void { byId(id).textContent = value; }
function readString(record: Record<string, unknown>, key: string, maximum = 2000): string {
  const value = record[key];
  if (typeof value !== "string" || value.length > maximum) throw new WorkflowError(`Invalid saved/native field: ${key}.`);
  return value;
}
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 32) throw new WorkflowError("Invalid saved/native string array.");
  return value.map((item: unknown) => {
    if (typeof item !== "string" || item.length > 200) throw new WorkflowError("Invalid saved/native string.");
    return item;
  });
}
function readEvidence(value: unknown): Evidence[] {
  if (!Array.isArray(value) || value.length > 8) throw new WorkflowError("Invalid native evidence array.");
  return value.map((item: unknown) => {
    if (!isRecord(item) || typeof item.count !== "number" || !Number.isSafeInteger(item.count) || item.count < 0) {
      throw new WorkflowError("Invalid native evidence.");
    }
    return { id: readString(item, "id"), summary: readString(item, "summary"), count: item.count };
  });
}
function readReport(value: unknown): RunReport {
  if (!isRecord(value) || value.synthetic !== true || value.version !== VERSION
      || (value.status !== "draft" && value.status !== "approved") || !isRecord(value.policy)
      || typeof value.policy.dedupe !== "boolean" || typeof value.policy.capacity !== "boolean"
      || (value.verificationRounds !== 1 && value.verificationRounds !== 2)
      || !Array.isArray(value.repairs) || value.repairs.length > 2) {
    throw new WorkflowError("Invalid saved/native report.");
  }
  const args = validateArgs({ scenario: value.scenario, mode: value.mode, seed: value.seed, pauseForApproval: true });
  const evidence: Evidence[] = [
    { id: "E-RETRY", summary: "Allowed report citation", count: 0 },
    { id: "E-INVENTORY", summary: "Allowed report citation", count: 0 },
  ];
  const repairs = value.repairs.map((proposal: unknown) => {
    if (!isRecord(proposal) || (proposal.repair !== "dedupe" && proposal.repair !== "capacity")) {
      throw new WorkflowError("Invalid saved/native repair.");
    }
    if (proposal.round !== 1 && proposal.round !== 2) throw new WorkflowError("Repair observation round is invalid.");
    const snapshot = readEvidence(proposal.evidenceSnapshot);
    return validateRepairRecord(proposal, proposal.repair, proposal.round, snapshot);
  });
  const after = validateEvaluation(value.after);
  if (!after.checks.every((check) => check.passed)) throw new WorkflowError("Report claims readiness without passing checks.");
  return {
    version: VERSION, runId: readString(value, "runId", 100), synthetic: true,
    scenario: args.scenario, mode: args.mode, seed: args.seed, status: value.status,
    policy: { dedupe: value.policy.dedupe, capacity: value.policy.capacity },
    before: validateEvaluation(value.before), after, repairs,
    verificationRounds: value.verificationRounds, reviewer: validateVerdict(value.reviewer, evidence),
    note: readString(value, "note"),
  };
}
function readEvent(value: unknown): WorkflowEvent {
  if (!isRecord(value)) throw new WorkflowError("Invalid execution event.");
  const id = readString(value, "id", 200);
  switch (value.type) {
    case "phase": return { type: "phase", id, title: readString(value, "title") };
    case "task": {
      if ((value.kind !== "code" && value.kind !== "worker" && value.kind !== "agent" && value.kind !== "gate")
          || (value.state !== "running" && value.state !== "done" && value.state !== "error")) {
        throw new WorkflowError("Invalid native task state.");
      }
      return { type: "task", id, title: readString(value, "title"), kind: value.kind, state: value.state,
        dependsOn: stringArray(value.dependsOn), detail: readString(value, "detail") };
    }
    case "evidence": return { type: "evidence", id, title: readString(value, "title"),
      evidence: readEvidence(value.evidence), evaluation: validateEvaluation(value.evaluation) };
    case "branch": {
      if (value.repair !== "dedupe" && value.repair !== "capacity") throw new WorkflowError("Invalid branch repair.");
      return { type: "branch", id, title: readString(value, "title"), repair: value.repair, reason: readString(value, "reason") };
    }
    case "verification": {
      if (value.round !== 1 && value.round !== 2) throw new WorkflowError("Invalid verification round.");
      return { type: "verification", id, title: readString(value, "title"), evaluation: validateEvaluation(value.evaluation), round: value.round };
    }
    case "twist": return { type: "twist", id, title: readString(value, "title"), detail: readString(value, "detail") };
    case "ready": return { type: "ready", id, report: readReport(value.report) };
    case "complete": return { type: "complete", id, report: readReport(value.report) };
    default: throw new WorkflowError("Unknown execution event type.");
  }
}
function readNativeSnapshot(value: unknown): NativeSnapshot {
  if (!isRecord(value) || value.engine !== "copilot-runtime" || !Array.isArray(value.events) || value.events.length > 100
      || (value.controller !== "sdk-terminal" && value.controller !== "copilot-session")
      || !["running", "completed", "awaiting-approval", "paused", "cancelled", "held", "halted", "error", "settling"].includes(String(value.status))) {
    throw new WorkflowError("The observer received an invalid native snapshot.");
  }
  return {
    runId: readString(value, "runId", 100), sessionId: readString(value, "sessionId", 100), args: validateArgs(value.args),
    controller: value.controller,
    status: readString(value, "status", 100), phase: readString(value, "phase", 100),
    updatedAt: readString(value, "updatedAt", 100),
    events: value.events.map(readEvent), report: value.report === null ? null : readReport(value.report),
    error: value.error === null ? null : readString(value, "error", 6000),
  };
}
function readSaved(value: unknown): SavedState {
  if (!isRecord(value) || !isRecord(value.journal) || value.journal.version !== 1
      || !isRecord(value.journal.steps) || !isRecord(value.journal.checkpoints)
      || !Array.isArray(value.events) || value.events.length > 100
      || typeof value.status !== "string" || !isUiStatus(value.status)) {
    throw new WorkflowError("Saved rehearsal data is invalid. Use New run to replace only this demo's state.");
  }
  const args = validateArgs(value.journal.args);
  if (args.mode !== "rehearsal") throw new WorkflowError("A browser journal cannot contain live agent work.");
  const steps: Record<string, JsonValue> = {};
  const checkpoints: Record<string, boolean> = {};
  for (const [key, entry] of Object.entries(value.journal.steps)) {
    if (!key.startsWith(`${VERSION}:`) || !isJsonValue(entry)) throw new WorkflowError("Invalid saved step.");
    steps[key] = entry;
  }
  for (const [key, entry] of Object.entries(value.journal.checkpoints)) {
    if (!key.startsWith(`${VERSION}:`) || typeof entry !== "boolean") throw new WorkflowError("Invalid checkpoint.");
    checkpoints[key] = entry;
  }
  return {
    journal: { version: 1, runId: readString(value.journal, "runId", 100), args, steps, checkpoints },
    events: value.events.map(readEvent), status: value.status, phase: readString(value, "phase", 100),
    report: value.report === null ? null : readReport(value.report),
  };
}
function isUiStatus(value: string): value is UiStatus {
  return value === "idle" || value === "running" || value === "paused" || value === "awaiting-approval"
    || value === "completed" || value === "cancelled" || value === "held" || value === "error" || value === "observing";
}

const graphElement = document.getElementById("workflow-graph");
if (!(graphElement instanceof SVGSVGElement)) throw new Error("Workflow graph is missing.");
const graph = graphElement;
const events = new Map<string, WorkflowEvent>();
let mode: "offline" | "native" = "offline";
let scenario: Scenario = "mixed";
let status: UiStatus = "idle";
let phase = "Choose a failure";
let journal: Journal | null = null;
let current: LocalContext | null = null;
let report: RunReport | null = null;
let before: Evaluation | null = null;
let measured: Evaluation | null = null;
let nativeId: string | null = null;
let nativeMode: "rehearsal" | "live" = "rehearsal";
let nativeController: "sdk-terminal" | "copilot-session" = "copilot-session";
let nativeRevision: string | null = null;
let nativeObservedAt = 0;
let nativeRunError: string | null = null;
let nativeSetupOpen = false;
let pollGeneration = 0;
let nativeRequest: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let renderPending = false;
let selectedTask: string | null = null;

const cues: Record<string, string> = {
  Observe: "“We are reproducing a failure, not asking a model to guess. These are 2,500 synthetic attendees.”",
  Diagnose: "“Two independent code probes run in parallel. Their results decide whether a specialist is needed.”",
  Repair: "“Look at the graph: a specialist appeared because evidence justified it. No arbitrary generated code is executed.”",
  Verify: "“A confident answer is not a passing test. The candidate must satisfy all three contracts.”",
  Adapt: "“New evidence changed the next step. The workflow preserved the retry repair and added only the missing capacity work.”",
  Challenge: "“The live workflow asks a different model to challenge the evidence. Offline, this is a separate JavaScript ledger walk.”",
  Approve: "“The run stops here. Passing checks does not authorize a deployment. This approval is only a local synthetic draft.”",
  Complete: "“The pattern is evidence, bounded action, independent challenge, and a human checkpoint—not a bigger prompt.”",
};

function notice(message: string): void { text("notice", message); byId("notice").hidden = false; }
function clearNotice(): void { byId("notice").hidden = true; text("notice", ""); }
function save(): void {
  if (!journal || mode !== "offline") return;
  const value: SavedState = { journal, events: [...events.values()], status, phase, report };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
  catch (error) {
    throw new WorkflowError(`This browser could not save the rehearsal checkpoint. Run stopped; persistence is not guaranteed. ${error instanceof Error ? error.message : String(error)}`);
  }
}
function absorb(event: WorkflowEvent): void {
  events.set(`${event.type}:${event.id}`, event);
  if (event.type === "phase") phase = event.title;
  if (event.type === "evidence") { before = event.evaluation; measured = event.evaluation; }
  if (event.type === "verification") measured = event.evaluation;
  if (event.type === "ready" || event.type === "complete") {
    report = event.report; before = report.before; measured = report.after;
  }
}
function scheduleRender(): void {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; render(); });
}
async function emit(event: WorkflowEvent): Promise<void> {
  absorb(event);
  save();
  scheduleRender();
}
function resetMemory(): void {
  events.clear(); report = null; before = null; measured = null; current = null; selectedTask = null;
  phase = "Choose a failure"; status = "idle";
  byId("task-inspector").hidden = true;
}
function restore(): void {
  resetMemory();
  journal = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = readSaved(JSON.parse(raw));
    journal = saved.journal;
    scenario = journal.args.scenario;
    input("seed-input").value = String(journal.args.seed);
    for (const event of saved.events) absorb(event);
    phase = saved.phase;
    status = saved.status === "running" ? "paused" : saved.status;
    if (report?.status === "draft" && Object.values(journal.checkpoints).some(Boolean)
        && status !== "cancelled" && status !== "completed" && status !== "error") {
      status = "awaiting-approval";
    }
    if (saved.status === "running") notice("A saved run was interrupted. Resume reuses completed steps; unfinished work may run again.");
  } catch (error) { notice(error instanceof Error ? error.message : String(error)); }
}
async function execute(resume = false): Promise<void> {
  if (mode !== "offline" || status === "running") return;
  clearNotice();
  try {
    if (!resume) {
      const args = validateArgs({ scenario, mode: "rehearsal", seed: Number(input("seed-input").value), pauseForApproval: true });
      resetMemory();
      journal = newJournal(args);
    }
    if (!journal) throw new WorkflowError("There is no saved run to resume.");
    const context = new LocalContext(journal, () => save(), Number(select("pace-select").value));
    current = context;
    status = "running";
    save();
    render();
    const result = await runLaunchRescue(context, emit);
    report = result;
    status = "completed";
    save();
  } catch (error) {
    if (error instanceof CheckpointPause) status = "awaiting-approval";
    else if (error instanceof PresenterPause) status = "paused";
    else if (error instanceof UserCancel) status = "cancelled";
    else {
      status = "error";
      notice(error instanceof Error ? error.message : String(error));
    }
    try { save(); } catch (saveError) { notice(saveError instanceof Error ? saveError.message : String(saveError)); }
  } finally { current = null; render(); }
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}
function svgText(x: number, y: number, value: string, className: string): SVGTextElement {
  const element = svg("text", { x: String(x), y: String(y), class: className });
  element.textContent = value;
  return element;
}
function taskEvent(id: string): TaskEvent | undefined {
  const value = events.get(`task:${id}`);
  return value?.type === "task" ? value : undefined;
}
function evaluationFor(id: string): Evaluation | null {
  if (id === "baseline") return before;
  if (id !== "verify-1" && id !== "verify-2") return null;
  const value = events.get(`verification:${id === "verify-2" ? "verification-2" : "verification-1"}`);
  return value?.type === "verification" ? value.evaluation : null;
}

function approvalDisplay(): { title: string; detail: string; node: string } {
  if (status === "completed") {
    return report?.status === "approved"
      ? { title: "Local draft approved.", node: "Local draft approved",
        detail: "The local draft and evidence are ready. No production system or real ticket was changed." }
      : { title: "Draft-only run complete.", node: "Draft only / no approval",
        detail: "Draft-only run finished. No approval was requested or claimed. Start a new checkpoint-enabled run to request review." };
  }
  if (status === "held" || status === "cancelled" || status === "error") {
    return {
      title: status === "held" ? "Host closed. Draft held." : "Run stopped.",
      node: status === "held" ? "Held / host closed" : "Stopped / no active gate",
      detail: report?.status === "approved"
        ? "Local draft approval was recorded before the run stopped. No deployment occurred."
        : status === "held" ? "The SDK host closed without approval. Start a new run; the closed terminal cannot resume this draft."
          : "The run stopped without approval. No active review checkpoint remains.",
    };
  }
  if (status === "awaiting-approval" || status === "paused") {
    return {
      title: "A human still decides.", node: "Awaiting human review",
      detail: mode === "offline"
        ? "The checks and independent review pass. Approve only this synthetic local draft, or keep it on hold."
        : nativeController === "sdk-terminal"
          ? "Review evidence, then type APPROVE in the running SDK terminal. The browser is read-only."
          : "Inspect the native run in Copilot. Resume in the owning session's /workflows panel; this browser is read-only.",
    };
  }
  return { title: "Review is not open yet.", node: "Review pending",
    detail: "The workflow has not reached an active review checkpoint." };
}

function flowSummary(): string {
  if (status === "error" || status === "held" || status === "cancelled") {
    return "The run stopped. Inspect the explanation; no deployment or ticket purchase occurred.";
  }
  if (report) {
    const change = report.verificationRounds === 2
      ? "A failed capacity check added a specialist. The revised plan passes all 3 checks."
      : "Evidence chose the specialists. All 3 checks pass.";
    return status === "completed" ? `${change} Local draft complete.` : `${change} Human review is next.`;
  }
  const failed = evaluationFor("verify-1");
  if (failed && !failed.checks.every((check) => check.passed)) {
    return `${failed.oversoldSeats.toLocaleString()} seats over capacity. Re-check the inventory and add the missing specialist.`;
  }
  if (events.has("twist:twist")) return "The room changed after planning. Check the candidate against the new evidence.";
  const initial = events.get("evidence:initial-evidence");
  if (initial?.type === "evidence") {
    const retries = initial.evidence.find((item) => item.id === "E-RETRY")?.count ?? 0;
    const seats = initial.evidence.find((item) => item.id === "E-INVENTORY")?.count ?? 0;
    if (retries && seats) return `${retries.toLocaleString()} retries and ${seats.toLocaleString()} unavailable seats: two specialists work in parallel.`;
    return retries ? `${retries.toLocaleString()} retry requests found. Add the retry specialist, then test its repair.`
      : `${seats.toLocaleString()} seats are unavailable. Add the capacity specialist, then test its repair.`;
  }
  if (status === "running") return "Reproduce the failure for 2,500 synthetic attendees. Evidence comes before agents.";
  return mode === "native"
    ? "Open the run command in your terminal. This page observes Copilot; it does not start models."
    : "Choose a failure, run the rescue, and follow the evidence from left to right.";
}

function drawGraph(): void {
  const focusedTask = document.activeElement instanceof Element && graph.contains(document.activeElement)
    ? document.activeElement.closest("[data-task]")?.getAttribute("data-task") : null;
  const adapted = Boolean(taskEvent("rescan-inventory") || taskEvent("capacity-specialist-2"));
  const stage = document.documentElement.dataset.stage === "true" && innerWidth > 1100;
  const top = stage ? 38 : 42;
  const main = stage ? 90 : 128;
  const lower = stage ? 142 : 214;
  const added = stage ? 246 : 402;
  const height = stage ? 88 : 112;
  const center = height / 2;
  const nodes: GraphNode[] = [
    { id: "baseline", x: 24, y: main, lines: ["Reproduce", "the failure"] },
    { id: "scan-retries", x: 276, y: top, lines: ["Inspect", "request identities"] },
    { id: "scan-inventory", x: 276, y: lower, lines: ["Audit", "room inventory"] },
  ];
  if (taskEvent("dedupe-specialist-1")) nodes.push({ id: "dedupe-specialist-1", x: 528, y: top, lines: ["Retry", "specialist"] });
  if (taskEvent("capacity-specialist-1")) nodes.push({ id: "capacity-specialist-1", x: 528, y: lower, lines: ["Capacity", "specialist"] });
  nodes.push(
    { id: "verify-1", x: 780, y: main, lines: ["Acceptance", "checks"] },
    { id: "reviewer", x: 1032, y: main, lines: ["Independent", "challenge"] },
    { id: "approval", x: 1284, y: main, lines: ["Human", "checkpoint"] },
  );
  if (adapted) nodes.push(
    { id: "rescan-inventory", x: 276, y: added, lines: ["Re-audit", "current inventory"] },
    { id: "capacity-specialist-2", x: 528, y: added, lines: ["New capacity", "specialist"] },
    { id: "verify-2", x: 780, y: added, lines: ["Re-run", "acceptance checks"] },
  );
  graph.replaceChildren();
  const graphHeight = stage ? adapted ? 348 : 256 : adapted ? 552 : 365;
  graph.setAttribute("viewBox", `0 0 1540 ${graphHeight}`);
  const bands = ["Reproduce", "Collect evidence", "Route specialists", "Verify with code", "Challenge", "Approve"];
  bands.forEach((label, index) => {
    graph.append(svgText(24 + index * 252, 24, label, "graph-lane-label"));
    if (index > 0) graph.append(svg("line", { x1: String(index * 252 + 6), x2: String(index * 252 + 6), y1: "42", y2: String(graphHeight - 22), class: "graph-separator" }));
  });
  const connections: Array<[string, string]> = [
    ["baseline", "scan-retries"], ["baseline", "scan-inventory"],
    ["scan-retries", "dedupe-specialist-1"], ["scan-inventory", "capacity-specialist-1"],
    ["dedupe-specialist-1", "verify-1"], ["capacity-specialist-1", "verify-1"],
    [adapted ? "verify-2" : "verify-1", "reviewer"], ["reviewer", "approval"],
    ["rescan-inventory", "capacity-specialist-2"], ["capacity-specialist-2", "verify-2"],
  ];
  for (const [sourceId, targetId] of connections) {
    const source = nodes.find((node) => node.id === sourceId);
    const target = nodes.find((node) => node.id === targetId);
    if (!source || !target) continue;
    const startX = source.x + 220;
    const startY = source.y + center;
    const endX = target.x;
    const endY = target.y + center;
    const active = taskEvent(sourceId)?.state === "done";
    graph.append(svg("path", { d: `M${startX},${startY} C${startX + 24},${startY} ${endX - 24},${endY} ${endX},${endY}`, class: `graph-wire${active ? " active" : ""}` }));
  }
  if (adapted) {
    const bend = stage ? 236 : 365;
    graph.append(svg("path", { d: `M890,${main + height} V${bend} H386 V${added}`, class: "graph-wire active" }));
  }
  if (!taskEvent("dedupe-specialist-1") && !taskEvent("capacity-specialist-1")) {
    graph.append(svgText(548, 176, "Evidence chooses", "graph-placeholder"));
    graph.append(svgText(548, 205, "who joins.", "graph-placeholder"));
  }
  for (const node of nodes) {
    const task = taskEvent(node.id);
    let nodeState = task?.state ?? "waiting";
    let stateText = task?.state === "done" ? "Completed" : task?.state === "running" ? (status === "paused" ? "Paused" : "Working") : task?.state === "error" ? "Held / error" : "Waiting";
    const evaluation = task?.state === "done" ? evaluationFor(node.id) : null;
    if (evaluation) {
      const passed = evaluation.checks.every((check) => check.passed);
      nodeState = passed ? "passed" : "failed";
      stateText = node.id === "baseline" ? "Failure reproduced" : passed ? "3 / 3 pass" : "Check failed";
    }
    if (node.id === "approval" && task) {
      stateText = approvalDisplay().node;
    }
    const group = svg("g", { class: "graph-node", tabindex: "0", role: "button", "data-task": node.id,
      "data-state": nodeState, "aria-label": `${node.lines.join(" ")}: ${stateText}` });
    group.append(svg("rect", { x: String(node.x), y: String(node.y), width: "220", height: String(height), rx: "10" }));
    group.append(svgText(node.x + 16, node.y + (stage ? 16 : 22), (task?.kind ?? (node.id === "reviewer" ? (mode === "native" && nativeMode === "live" ? "agent" : "worker") : node.id === "approval" ? "gate" : "code")).toUpperCase(), "graph-kind"));
    node.lines.forEach((line, index) => group.append(svgText(node.x + 16, node.y + (stage ? 34 : 49) + index * (stage ? 22 : 24), line, "graph-title")));
    group.append(svgText(node.x + 16, node.y + height - (stage ? 9 : 12), stateText, "graph-status"));
    graph.append(group);
  }
  if (focusedTask) graph.querySelector<SVGGElement>(`[data-task="${focusedTask}"]`)?.focus({ preventScroll: true });
}

function renderChecks(): void {
  const container = byId("checks-list");
  container.replaceChildren();
  const checks = measured?.checks ?? [
    { id: "C-UNIQUE", title: "One outcome per attendee", passed: false, detail: "Not run" },
    { id: "C-CAPACITY", title: "Never exceed room capacity", passed: false, detail: "Not run" },
    { id: "C-COVERAGE", title: "No attendee disappears", passed: false, detail: "Not run" },
  ];
  for (const check of checks) {
    const row = document.createElement("div"); row.className = "check";
    const badge = document.createElement("span"); badge.className = "check-status";
    badge.textContent = measured ? (check.passed ? "PASS" : "FAIL") : "WAIT";
    badge.dataset.result = measured ? (check.passed ? "pass" : "fail") : "wait";
    const copy = document.createElement("div");
    const title = document.createElement("div"); title.className = "check-name"; title.textContent = check.title;
    const detail = document.createElement("div"); detail.className = "check-detail"; detail.textContent = check.detail;
    copy.append(title, detail); row.append(badge, copy); container.append(row);
  }
  text("checks-total", measured ? `${checks.filter((check) => check.passed).length} / 3 pass` : "0 / 3 run");
}
function renderEvidence(): void {
  const feed = byId("evidence-feed"); feed.replaceChildren();
  const messages: Array<{ id: string; message: string }> = [];
  const initial = events.get("evidence:initial-evidence");
  if (initial?.type === "evidence") {
    initial.evidence.forEach((item) => messages.push({ id: item.id, message: item.summary }));
  }
  if (events.has("twist:twist")) messages.push({ id: "NEW INPUT", message: "Main hall capacity changed from 1,800 to 1,600 after the first plan." });
  const branches = [...events.values()].filter((event): event is Extract<WorkflowEvent, { type: "branch" }> => event.type === "branch");
  branches.forEach((branch) => messages.push({ id: "ROUTING", message: branch.title + ". " + branch.reason }));
  if (report) messages.push({ id: "REVIEW", message: report.reviewer.rationale });
  if (messages.length === 0) messages.push({ id: "WAITING", message: "The graph is driven by execution events, not a prerecorded animation." });
  for (const message of messages.slice(-4)) {
    const li = document.createElement("li");
    const code = document.createElement("code"); code.textContent = message.id;
    const copy = document.createElement("span"); copy.textContent = message.message;
    li.append(code, copy); feed.append(li);
  }
}
function render(): void {
  const active = status === "running";
  const native = mode === "native";
  document.documentElement.dataset.nativeConnected = String(native && nativeId !== null);
  document.documentElement.dataset.nativeSetup = String(native && nativeSetupOpen);
  const canResume = status === "paused";
  document.querySelectorAll<HTMLButtonElement>(".scenario-choice").forEach((choice) => {
    choice.setAttribute("aria-pressed", String(choice.dataset.scenario === scenario));
    choice.disabled = active || native || status === "paused" || status === "awaiting-approval";
  });
  button("offline-mode").setAttribute("aria-pressed", String(!native));
  button("native-mode").setAttribute("aria-pressed", String(native));
  button("offline-mode").disabled = active && !native;
  button("native-mode").disabled = active && !native;
  byId("native-panel").hidden = !native;
  text("mode-label", native ? nativeId ? `NATIVE COPILOT / ${status === "completed" ? "COMPLETED " : status === "held" ? "HELD " : ""}${nativeMode === "live" ? "LIVE RUN" : "REHEARSAL"}`
    : "NATIVE COPILOT / WAITING" : "OFFLINE REHEARSAL");
  text("mode-description", native
    ? nativeId ? status === "held" ? "SDK host closed without approval. Start a new run to continue."
      : nativeMode === "live" ? status === "completed"
      ? "Results of an actual completed model run. No models are currently started by this page."
      : "Actual Copilot workflow-owned agents. Live model usage." : "Actual Copilot runtime. JavaScript workers; no LLM calls."
      : "Waiting for a local native run. No models started by this page."
    : "Real JavaScript workers and checks. No LLM calls.");
  text("specialist-legend", native && nativeMode === "live" ? "Copilot agents" : "Local workers");
  const run = button("run-button");
  run.textContent = native ? nativeSetupOpen ? "Hide run command" : "Show run command" : active ? "Running…" : canResume ? "Resume saved run"
    : status === "awaiting-approval" ? "Review required" : status === "completed" ? "Run again" : "Run rescue";
  run.disabled = !native && (active || status === "awaiting-approval");
  button("pause-button").disabled = !active || native;
  button("reset-button").disabled = active || native;
  select("pace-select").disabled = active || native;
  input("seed-input").disabled = active || native || status === "paused" || status === "awaiting-approval";
  const labels: Record<UiStatus, string> = {
    idle: "Ready", running: "Running", paused: "Paused", "awaiting-approval": "Review checkpoint",
    completed: report?.status === "approved" ? "Draft approved" : "Draft complete",
    cancelled: native ? "Cancelled" : "On hold", held: "Held / host closed", error: "Held / error", observing: "Watching",
  };
  text("status-label", labels[status]); byId("status-label").dataset.state = status;
  text("phase-label", phase);
  text("flow-summary", flowSummary());
  text("cue-text", cues[phase] ?? "“Which failure should we trigger? Show of hands. We won't choose the agents; the evidence will.”");
  byId("twist-banner").hidden = !events.has("twist:twist");
  drawGraph();
  renderChecks();
  renderEvidence();
  text("duplicate-count", measured ? measured.duplicateOutcomes.toLocaleString() : "—");
  text("oversold-count", measured ? measured.oversoldSeats.toLocaleString() : "—");
  text("confirmed-count", measured ? measured.uniqueConfirmed.toLocaleString() : "—");
  text("duplicate-before", before ? `Baseline: ${before.duplicateOutcomes.toLocaleString()}` : "No fixture evaluated yet");
  text("oversold-before", before ? `Baseline: ${before.oversoldSeats.toLocaleString()}` : "No fixture evaluated yet");
  text("waitlist-count", measured ? `${measured.waitlisted.toLocaleString()} waitlisted / ${ATTENDEES.toLocaleString()} accounted for` : "No fixture evaluated yet");
  text("measurement-label", report ? "Verified candidate" : measured && events.has("verification:verification-1") ? "Candidate check" : measured ? "Buggy baseline" : "Waiting for execution");
  byId("approval-panel").hidden = report === null;
  button("approve-button").hidden = native || status !== "awaiting-approval";
  button("hold-button").hidden = native || status !== "awaiting-approval";
  button("download-button").disabled = report === null;
  const approval = approvalDisplay();
  text("approval-title", approval.title);
  text("approval-detail", approval.detail);
  if (selectedTask && !byId("task-inspector").hidden) inspectTask(selectedTask);
}
function inspectTask(id: string): void {
  selectedTask = id;
  const task = taskEvent(id);
  text("inspector-title", task?.title ?? "Not executed yet");
  const evaluation = task?.state === "done" ? evaluationFor(id) : null;
  const parts = [task ? `${task.state.toUpperCase()} · ${task.kind.toUpperCase()}${task.detail ? ` · ${task.detail}` : ""}`
    : "This stage is defined by the workflow, but has not executed in this run."];
  if (evaluation) {
    parts.push(`${evaluation.checks.every((check) => check.passed) ? "PASS" : "FAIL"}: ${evaluation.checks.filter((check) => check.passed).length} / 3 checks pass.`);
    evaluation.checks.forEach((check) => parts.push(`${check.passed ? "PASS" : "FAIL"} — ${check.title}: ${check.detail}.`));
    parts.push(`${evaluation.uniqueConfirmed.toLocaleString()} unique confirmations; ${evaluation.waitlisted.toLocaleString()} waitlisted.`);
  }
  const initial = events.get("evidence:initial-evidence");
  if (initial?.type === "evidence" && (id === "scan-retries" || id === "scan-inventory")) {
    const evidence = initial.evidence.find((item) => item.id === (id === "scan-retries" ? "E-RETRY" : "E-INVENTORY"));
    if (evidence) parts.push(`${evidence.id}: ${evidence.summary}`);
  }
  if (id === "rescan-inventory") {
    const inventory = evaluationFor("verify-1");
    inventory?.occupancy.forEach((room) => parts.push(`Current ${room.room.toLowerCase()}: ${room.capacity.toLocaleString()} seats; candidate used ${room.used.toLocaleString()}.`));
  }
  const proposal = report?.repairs.find((item) => id.startsWith(item.repair));
  if (proposal) parts.push(`Observation round ${proposal.round}. ${proposal.rationale} Evidence snapshot: ${proposal.evidenceSnapshot.map((item) => item.summary).join(" ")}`);
  if (id === "reviewer" && report) parts.push(`${report.reviewer.verdict.toUpperCase()}: ${report.reviewer.rationale}`);
  if (id === "approval" && report) parts.push(approvalDisplay().detail);
  text("inspector-detail", parts.join("\n"));
  byId("task-inspector").hidden = false;
}
async function pollNative(generation: number): Promise<void> {
  if (mode !== "native" || generation !== pollGeneration) return;
  if (location.protocol === "file:") {
    text("observer-status", "Observer unavailable for file://. Start Launch-Demo.ps1 for native monitoring.");
    return;
  }
  const controller = new AbortController();
  nativeRequest = controller;
  const timeout = setTimeout(() => controller.abort(new Error("Native observer request timed out.")), 5000);
  try {
    const response = await fetch("/api/native/latest", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new WorkflowError(`Native observer returned HTTP ${response.status}. Start the bundled local server.`);
    const payload: unknown = await response.json();
    if (mode !== "native" || generation !== pollGeneration) return;
    if (!isRecord(payload) || !Object.hasOwn(payload, "run")) throw new WorkflowError("Native observer response has no run field.");
    if (payload.run === null) {
      resetMemory();
      nativeId = null; nativeRevision = null; nativeObservedAt = 0; nativeRunError = null;
      clearNotice();
      text("native-command", "node .\\native\\Run-Sdk.mjs --live --pause");
      button("copy-command").hidden = false;
      button("copy-command").textContent = "Copy command";
      text("observer-status", "Connected. Waiting for your native workflow run.");
      status = "observing";
      render();
      return;
    }
    const snapshot = readNativeSnapshot(payload.run);
    const observedAt = Date.parse(snapshot.updatedAt);
    if (!Number.isFinite(observedAt)) throw new WorkflowError("Native snapshot has an invalid update time.");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(snapshot.sessionId)) throw new WorkflowError("Native snapshot has an invalid owning session ID.");
    if (snapshot.runId === nativeId && observedAt < nativeObservedAt) {
      if (nativeRunError) notice(nativeRunError); else clearNotice();
      return;
    }
    const revision = JSON.stringify([snapshot.runId, snapshot.updatedAt, snapshot.status, snapshot.error]);
    nativeRunError = snapshot.error;
    if (nativeRunError) notice(nativeRunError); else clearNotice();
    text("observer-status", `Native run ${snapshot.runId.slice(0, 8)}: ${snapshot.status}, updated ${new Date(snapshot.updatedAt).toLocaleString()}. Usage is shown in Copilot.`);
    if (revision === nativeRevision) return;
    nativeRevision = revision;
    nativeObservedAt = observedAt;
    if (snapshot.runId !== nativeId) { resetMemory(); nativeId = snapshot.runId; }
    nativeMode = snapshot.args.mode;
    nativeController = snapshot.controller;
    scenario = snapshot.args.scenario;
    for (const event of snapshot.events) absorb(event);
    phase = snapshot.phase;
    report = snapshot.report;
    status = snapshot.status === "completed" ? "completed" : snapshot.status === "awaiting-approval" ? "awaiting-approval"
      : snapshot.status === "running" ? "running" : snapshot.status === "cancelled" ? "cancelled"
      : snapshot.status === "held" ? "held"
      : snapshot.status === "error" || snapshot.status === "halted" ? "error"
      : snapshot.status === "settling" ? "observing" : "paused";
    const awaitingReview = status === "awaiting-approval" || status === "paused";
    text("native-command", awaitingReview
      ? nativeController === "sdk-terminal" ? "Return to the running SDK terminal; type APPROVE after reviewing the synthetic draft."
        : `copilot --experimental --model gpt-6.1-sol --reasoning-effort max --resume ${snapshot.sessionId}`
      : "node .\\native\\Run-Sdk.mjs --live --pause");
    button("copy-command").hidden = awaitingReview && nativeController === "sdk-terminal";
    button("copy-command").textContent = awaitingReview ? "Copy resume command" : "Copy command";
    render();
  } catch (error) {
    if (mode === "native" && generation === pollGeneration) {
      text("observer-status", "Observer disconnected. No native result has been substituted.");
      notice(error instanceof Error ? error.message : String(error));
    }
  } finally {
    clearTimeout(timeout);
    if (nativeRequest === controller) nativeRequest = null;
    if (mode === "native" && generation === pollGeneration) {
      pollTimer = setTimeout(() => void pollNative(generation), 1500);
    }
  }
}
function switchMode(next: "offline" | "native"): void {
  if (status === "running" && mode === "offline") return;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  pollGeneration++;
  nativeRequest?.abort();
  nativeRequest = null;
  mode = next; clearNotice(); resetMemory(); nativeId = null; nativeRevision = null;
  nativeObservedAt = 0; nativeRunError = null;
  nativeSetupOpen = false;
  if (next === "offline") restore();
  else { status = "observing"; void pollNative(pollGeneration); }
  render();
}
async function copyCommand(): Promise<void> {
  try {
    if (!navigator.clipboard) throw new WorkflowError("Clipboard access is unavailable. Select and copy the visible command manually.");
    await navigator.clipboard.writeText(byId("native-command").textContent ?? "");
    button("copy-command").textContent = "Copied";
    setTimeout(() => { button("copy-command").textContent = "Copy command"; }, 1800);
  } catch (error) { notice(error instanceof Error ? error.message : String(error)); }
}
function downloadEvidence(): void {
  if (!report) { notice("There is no verified report to download yet."); return; }
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(), engine: mode === "native" ? "copilot-runtime" : "standalone-rehearsal",
    report, executionEvents: [...events.values()],
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `launch-rescue-${report.runId}.json`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toggleStage(): void {
  const enabled = document.documentElement.dataset.stage !== "true";
  document.documentElement.dataset.stage = String(enabled);
  button("stage-toggle").setAttribute("aria-pressed", String(enabled));
  render();
}

document.querySelectorAll<HTMLButtonElement>(".scenario-choice").forEach((choice) => choice.addEventListener("click", () => {
  if (status === "running" || status === "awaiting-approval" || mode === "native") return;
  const value = validateArgs({ scenario: choice.dataset.scenario });
  scenario = value.scenario;
  render();
}));
button("run-button").addEventListener("click", () => {
  if (mode === "native") {
    nativeSetupOpen = !nativeSetupOpen;
    render();
    if (nativeSetupOpen) byId("native-panel").scrollIntoView({ block: "start" });
  } else void execute(status === "paused");
});
button("pause-button").addEventListener("click", () => current?.pauseNow());
button("reset-button").addEventListener("click", () => {
  if (status === "running" || mode === "native") return;
  try { localStorage.removeItem(STORAGE_KEY); journal = null; resetMemory(); clearNotice(); render(); }
  catch (error) { notice(`Unable to reset this demo's saved state: ${error instanceof Error ? error.message : String(error)}`); }
});
button("approve-button").addEventListener("click", () => {
  if (status === "awaiting-approval" && mode === "offline") void execute(true);
});
button("hold-button").addEventListener("click", () => {
  status = "cancelled";
  try { save(); } catch (error) { notice(error instanceof Error ? error.message : String(error)); }
  render();
});
button("download-button").addEventListener("click", downloadEvidence);
button("offline-mode").addEventListener("click", () => switchMode("offline"));
button("native-mode").addEventListener("click", () => switchMode("native"));
button("copy-command").addEventListener("click", () => void copyCommand());
button("stage-toggle").addEventListener("click", toggleStage);
button("cue-toggle").addEventListener("click", () => {
  const panel = byId("presenter-cue"); panel.hidden = !panel.hidden;
  button("cue-toggle").setAttribute("aria-pressed", String(!panel.hidden));
});
button("theme-toggle").addEventListener("click", () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
});
button("close-inspector").addEventListener("click", () => {
  byId("task-inspector").hidden = true;
  if (selectedTask) graph.querySelector<SVGGElement>(`[data-task="${selectedTask}"]`)?.focus();
  selectedTask = null;
});
graph.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest("[data-task]");
  const id = target?.getAttribute("data-task");
  if (id) inspectTask(id);
});
graph.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!(event.target instanceof Element)) return;
  const id = event.target.closest("[data-task]")?.getAttribute("data-task");
  if (id) { event.preventDefault(); inspectTask(id); }
});
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey || event.target instanceof HTMLInputElement
      || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key.toLowerCase() === "s" && mode === "offline" && status !== "awaiting-approval") {
    event.preventDefault(); void execute(status === "paused");
  } else if (event.key.toLowerCase() === "p") current?.pauseNow();
  else if (event.key.toLowerCase() === "v") toggleStage();
});
text("workflow-source", __WORKFLOW_SOURCE__);
window.addEventListener("resize", scheduleRender);
restore();
render();
