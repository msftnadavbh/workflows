import type { JsonValue } from "@github/copilot-sdk/extension";
import {
  ATTENDEES, VERSION, WorkflowError, isJsonValue, isRecord, runLaunchRescue, validateArgs,
  isWalkthroughCheckpoint, validateEvaluation, validateRepairRecord, validateVerdict,
  type Evaluation, type Evidence, type FeatureHandoff, type FeatureProof, type RunReport, type Scenario, type WorkflowEvent,
} from "./core.js";
import {
  CheckpointPause, LocalContext, PresenterPause, UserCancel, newJournal, type Journal,
} from "./local-context.js";

type UiStatus = "idle" | "running" | "paused" | "walkthrough" | "awaiting-approval" | "completed" | "cancelled" | "held" | "error" | "observing";
type NativeSnapshot = {
  runId: string; sessionId: string; args: ReturnType<typeof validateArgs>; status: string; phase: string;
  controller: "sdk-terminal" | "copilot-session";
  updatedAt: string; events: WorkflowEvent[]; report: RunReport | null; error: string | null;
  pauseKey: string | null;
};
type SavedState = {
  journal: Journal; events: WorkflowEvent[]; status: UiStatus; phase: string; report: RunReport | null;
};
type TaskEvent = Extract<WorkflowEvent, { type: "task" }>;
type GraphNode = { id: string; x: number; y: number; lines: string[] };

const STORAGE_KEY = "launch-rescue.rehearsal.v3";
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
      if (value.reused !== undefined && typeof value.reused !== "boolean") throw new WorkflowError("Invalid saved-step reuse marker.");
      return { type: "task", id, title: readString(value, "title"), kind: value.kind, state: value.state,
        dependsOn: stringArray(value.dependsOn), detail: readString(value, "detail"),
        ...(typeof value.reused === "boolean" ? { reused: value.reused } : {}) };
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
    case "feature": {
      if (!["dynamic", "agentic", "checks", "human"].includes(String(value.feature))
          || typeof value.pause !== "boolean" || !isJsonValue(value.input) || !isJsonValue(value.output)
          || !Array.isArray(value.handoffs) || value.handoffs.length > 2) throw new WorkflowError("Invalid feature proof.");
      const feature = value.feature;
      if (feature !== "dynamic" && feature !== "agentic" && feature !== "checks" && feature !== "human") throw new WorkflowError("Unknown workflow feature.");
      const handoffs = value.handoffs.map((item: unknown): FeatureHandoff => {
        if (!isRecord(item) || (item.source !== "model" && item.source !== "javascript")
            || typeof item.reused !== "boolean" || !isJsonValue(item.result)
            || (item.source === "model" && (typeof item.model !== "string" || typeof item.reasoningEffort !== "string"))
            || (item.source === "javascript" && (item.model !== null || item.reasoningEffort !== null))) {
          throw new WorkflowError("Invalid agent handoff proof.");
        }
        return { label: readString(item, "label"), prompt: readString(item, "prompt", 20000),
          source: item.source, model: item.model === null ? null : readString(item, "model"),
          reasoningEffort: item.reasoningEffort === null ? null : readString(item, "reasoningEffort"),
          reused: item.reused, result: item.result };
      });
      return { type: "feature", id, feature, title: readString(value, "title"), benefit: readString(value, "benefit"),
        code: readString(value, "code", 4000), input: value.input, output: value.output,
        focus: stringArray(value.focus), handoffs, pause: value.pause };
    }
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
    pauseKey: typeof value.pauseKey === "string" ? value.pauseKey : null,
  };
}
function readSaved(value: unknown): SavedState {
  if (!isRecord(value) || !isRecord(value.journal) || value.journal.version !== 1
      || !isRecord(value.journal.steps) || !isRecord(value.journal.checkpoints)
      || !Array.isArray(value.events) || value.events.length > 100
      || typeof value.status !== "string" || !isUiStatus(value.status)) {
    throw new WorkflowError("Saved workflow data is invalid. Use New run to replace this workflow's state.");
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
    || value === "walkthrough" || value === "completed" || value === "cancelled" || value === "held" || value === "error" || value === "observing";
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
let nativeRevision: string | null = null;
let nativeObservedAt = 0;
let nativeRunError: string | null = null;
let renderPending = false;
let selectedTask: string | null = null;
let walkthroughEnabled = true;
let selectedProof: string | null = null;
let activeProof: string | null = null;

function notice(message: string): void {
  text("notice", message.replace("Retry or use the labeled rehearsal.", "Retry the workflow."));
  byId("notice").hidden = false;
}
function clearNotice(): void { byId("notice").hidden = true; text("notice", ""); }
function save(): void {
  if (!journal || mode !== "offline") return;
  const value: SavedState = { journal, events: [...events.values()], status, phase, report };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); }
  catch (error) {
    throw new WorkflowError(`This browser could not save the workflow checkpoint. The run stopped because its progress could not be saved. ${error instanceof Error ? error.message : String(error)}`);
  }
}
function absorb(event: WorkflowEvent): void {
  const fresh = !events.has(`${event.type}:${event.id}`);
  events.set(`${event.type}:${event.id}`, event);
  if (event.type === "feature" && (fresh || activeProof === null)) {
    activeProof = event.id;
    selectedProof = event.id;
  }
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
  selectedProof = null;
  activeProof = null;
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
    walkthroughEnabled = journal.args.walkthrough;
    scenario = journal.args.scenario;
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
      const args = validateArgs({ scenario, mode: "rehearsal", seed: 42,
        pauseForApproval: true, walkthrough: walkthroughEnabled });
      resetMemory();
      journal = newJournal(args);
    }
    if (!journal) throw new WorkflowError("There is no saved run to resume.");
    const context = new LocalContext(journal, () => save(), 350);
    current = context;
    status = "running";
    save();
    render();
    const result = await runLaunchRescue(context, emit);
    report = result;
    status = "completed";
    save();
  } catch (error) {
    if (error instanceof CheckpointPause) status = isWalkthroughCheckpoint(error.key) ? "walkthrough" : "awaiting-approval";
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
        detail: "The local draft and its verified evidence are ready." }
      : { title: "Draft-only run complete.", node: "Draft only / no approval",
        detail: "The draft is complete. Approval was not requested for this run." };
  }
  if (status === "held" || status === "cancelled" || status === "error") {
    return {
      title: status === "held" ? "Workflow stopped. Draft held." : "Run stopped.",
      node: status === "held" ? "Draft held" : "Stopped / no active gate",
      detail: report?.status === "approved"
        ? "Local draft approval was recorded before the run stopped. No deployment occurred."
        : status === "held" ? "The workflow closed without approval. This draft remains on hold."
          : "The run stopped without approval. No active review checkpoint remains.",
    };
  }
  if (status === "awaiting-approval" || status === "paused") {
    return {
      title: "A human still decides.", node: "Awaiting human review",
      detail: mode === "offline"
        ? "All checks and independent review passed. Approve the local draft or keep it on hold."
        : "Waiting for approval from the workflow owner. The local draft is not yet approved.",
    };
  }
  return { title: "Review is not open yet.", node: "Review pending",
    detail: "The workflow has not reached an active review checkpoint." };
}

function flowSummary(): string {
  if (status === "walkthrough") return "Checkpoint reached. The next step is ready.";
  if (status === "error" || status === "held" || status === "cancelled") {
    return "The run stopped. The draft has not been released.";
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
  if (status === "running") return "Inspecting the launch for 2,500 attendees. Evidence comes before action.";
  return mode === "native"
    ? "Waiting for a Copilot workflow run."
    : "Choose a failure, run the rescue, and follow the evidence from left to right.";
}

function featureProof(): FeatureProof | null {
  const value = selectedProof ? events.get(`feature:${selectedProof}`) : null;
  return value?.type === "feature" ? value : null;
}

function featureTitle(proof: FeatureProof | null): string {
  if (!proof) return "Every decision, explained";
  if (proof.feature !== "agentic" || proof.handoffs.some((handoff) => handoff.source === "model")) return proof.title;
  return proof.id === "review" ? "Independent review checks the answer"
    : proof.id === "repair-2" ? "Capacity logic handles the new evidence" : "Repair logic explains the decision";
}

function renderFeatureProof(): void {
  const proof = featureProof();
  const body = byId("proof-body");
  if (body.dataset.proof !== (proof?.id ?? "")) {
    body.scrollTop = 0;
    body.dataset.proof = proof?.id ?? "";
    const prompt = byId("proof-prompt-details");
    if (prompt instanceof HTMLDetailsElement) prompt.open = false;
  }
  const native = mode === "native";
  const models = proof?.handoffs.filter((handoff) => handoff.source === "model") ?? [];
  const codeDecision = proof?.feature === "agentic" && models.length === 0;
  const codeReview = codeDecision && proof?.id === "review";
  document.documentElement.dataset.runStatus = status;
  const names = { dynamic: "DYNAMIC WORKFLOW", agentic: "AGENTIC WORKFLOW", checks: "DETERMINISTIC CHECKS", human: "DYNAMIC WORKFLOW / HUMAN" };
  text("proof-feature", codeDecision ? codeReview ? "CODE / REVIEW" : "CODE / REPAIR" : proof ? names[proof.feature] : "WORKFLOW");
  text("proof-title", featureTitle(proof));
  text("proof-benefit", proof?.benefit ?? "Dynamic Workflow code selects and saves the steps. Agentic Workflow reasoning interprets and challenges evidence. Checks verify the result; a human approves the local draft.");
  const earlier = proof && activeProof !== proof.id;
  text("proof-pause", earlier ? status === "completed" ? "PREVIOUS STEP / COMPLETED RUN" : "PREVIOUS STEP"
    : status === "walkthrough" ? "CHECKPOINT"
      : status === "awaiting-approval" ? "APPROVAL REQUIRED"
        : status === "completed" ? "COMPLETED" : "READY");
  text("proof-verdict-rule", proof?.id === "review" ? "Verdict rules: ACCEPT → human checkpoint. REJECT → run held; no approvable draft." : "");
  byId("proof-verdict-rule").hidden = proof?.id !== "review";
  const savedModels = status === "completed" || models.every((handoff) => handoff.reused);
  text("proof-execution", models.length
    ? `${savedModels ? "Saved Copilot result" : "Copilot model"} · ${[...new Set(models.map((handoff) => `${handoff.model} / ${handoff.reasoningEffort}`))].join(", ")}`
    : native ? nativeId ? codeDecision ? "JavaScript · Copilot workflow runtime" : "Copilot workflow runtime"
      : "Waiting for Copilot execution" : "JavaScript · local execution");
  if (codeReview) text("proof-benefit", "An independent ledger check walks every outcome against current capacity and accounts for every attendee. A rejection holds the candidate.");
  text("proof-code", codeDecision ? codeReview ? "return independentLedgerReview(fixture, policy, evidence);"
    : "return {\n  ...localProposal(repair, snapshot),\n  round, evidenceSnapshot: snapshot\n};"
    : proof?.code ?? 'const scans = await ctx.parallel([...]);\nif (retryCount > 0) needed.push("dedupe");');
  text("proof-input", proof ? JSON.stringify(proof.input, null, 2) : "Choose a launch challenge and run the workflow.");
  text("proof-output", proof ? JSON.stringify(proof.output, null, 2) : "The actual input and output appear here at every stop.");
  const prompt = models.map((handoff) => `${handoff.label}\n${handoff.prompt}`).join("\n\n");
  text("proof-prompt", prompt);
  byId("proof-prompt-details").hidden = !prompt;
  text("proof-prompt-label", "Exact model prompt");
  button("continue-walkthrough").hidden = native || status !== "walkthrough";
  const chooser = select("proof-step");
  const proofs = [...events.values()].filter((event): event is FeatureProof => event.type === "feature");
  const signature = JSON.stringify(proofs.map((item) => [item.id, featureTitle(item)]));
  if (chooser.dataset.proofs !== signature) {
    chooser.replaceChildren();
    const empty = document.createElement("option");
    empty.value = ""; empty.textContent = "Feature proofs appear as work executes"; chooser.append(empty);
    proofs.forEach((item, index) => {
      const option = document.createElement("option");
      option.value = item.id; option.textContent = `${index + 1}. ${featureTitle(item)}`; chooser.append(option);
    });
    chooser.dataset.proofs = signature;
  }
  chooser.value = selectedProof ?? "";
  chooser.disabled = proofs.length === 0;
  const proofFeature = proof?.feature ?? "dynamic";
  byId("feature-proof").dataset.feature = proofFeature;
}

function drawGraph(): void {
  const focusedTask = document.activeElement instanceof Element && graph.contains(document.activeElement)
    ? document.activeElement.closest("[data-task]")?.getAttribute("data-task") : null;
  const adapted = Boolean(taskEvent("rescan-inventory") || taskEvent("capacity-specialist-2"));
  const stage = innerWidth > 1100;
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
      "data-state": nodeState, "data-focus": String(featureProof()?.focus.includes(node.id) ?? false),
      "aria-label": `${node.lines.join(" ")}: ${stateText}` });
    group.append(svg("rect", { x: String(node.x), y: String(node.y), width: "220", height: String(height), rx: "10" }));
    const kind = task?.kind ?? (node.id === "reviewer" || node.id.includes("specialist") ? mode === "native" && nativeMode === "live" ? "agent" : "worker"
      : node.id === "approval" ? "gate" : "code");
    const parallel = scenario === "parallel" && node.id.endsWith("specialist-1");
    const label = node.id.startsWith("scan-") ? "PARALLEL SCAN / CODE"
      : kind === "agent" ? parallel ? "AGENTIC / PARALLEL" : "AGENTIC / LLM"
      : kind === "worker" ? parallel ? "PARALLEL / JAVASCRIPT" : "JAVASCRIPT"
      : kind === "gate" ? "WORKFLOW / HUMAN" : "CODE / CHECKS";
    group.append(svgText(node.x + 16, node.y + (stage ? 16 : 22), label, "graph-kind"));
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
  document.documentElement.dataset.execution = native ? "copilot" : "javascript";
  byId("mission-controls").hidden = native;
  byId("observed-scenario").hidden = !native || nativeId === null;
  const scenarioNames: Record<Scenario, string> = {
    retries: "Retry storm", capacity: "Room switch", parallel: "Both at once", mixed: "Surprise me",
  };
  text("observed-scenario", `Launch challenge: ${scenarioNames[scenario]}`);
  const scenarioLocked = active || status === "paused" || status === "walkthrough" || status === "awaiting-approval";
  byId("scenario-controls").hidden = scenarioLocked;
  byId("selected-challenge").hidden = !scenarioLocked;
  text("selected-challenge", `Launch challenge: ${scenarioNames[scenario]}`);
  const canResume = status === "paused";
  document.querySelectorAll<HTMLButtonElement>(".scenario-choice").forEach((choice) => {
    choice.setAttribute("aria-pressed", String(choice.dataset.scenario === scenario));
    choice.disabled = native || scenarioLocked;
  });
  text("specialist-legend", native && nativeMode === "live" ? "Copilot agents" : "JavaScript");
  const run = button("run-button");
  run.textContent = active ? "Running…" : canResume ? "Resume saved run"
    : status === "walkthrough" ? "Checkpoint reached"
      : status === "awaiting-approval" ? "Review required" : status === "completed" ? "Run again" : "Run rescue";
  run.disabled = !native && (active || status === "walkthrough" || status === "awaiting-approval");
  button("walkthrough-toggle").textContent = walkthroughEnabled ? "Step by step" : "Continuous run";
  button("walkthrough-toggle").setAttribute("aria-pressed", String(walkthroughEnabled));
  button("walkthrough-toggle").disabled = active || native || status === "paused" || status === "walkthrough" || status === "awaiting-approval";
  button("pause-button").disabled = !active || native;
  button("reset-button").disabled = active || native;
  const labels: Record<UiStatus, string> = {
    idle: "Ready", running: "Running", paused: "Paused", "awaiting-approval": "Review checkpoint",
    completed: report?.status === "approved" ? "Draft approved" : "Draft complete",
    cancelled: native ? "Cancelled" : "On hold", held: "On hold", error: "Held / error", observing: "Waiting for run",
    walkthrough: "Checkpoint",
  };
  text("status-label", labels[status]); byId("status-label").dataset.state = status;
  text("phase-label", phase);
  text("flow-summary", flowSummary());
  byId("twist-banner").hidden = !events.has("twist:twist");
  drawGraph();
  renderFeatureProof();
  renderChecks();
  renderEvidence();
  text("duplicate-count", measured ? measured.duplicateOutcomes.toLocaleString() : "—");
  text("oversold-count", measured ? measured.oversoldSeats.toLocaleString() : "—");
  text("confirmed-count", measured ? measured.uniqueConfirmed.toLocaleString() : "—");
  text("duplicate-before", before ? `Baseline: ${before.duplicateOutcomes.toLocaleString()}` : "Not evaluated yet");
  text("oversold-before", before ? `Baseline: ${before.oversoldSeats.toLocaleString()}` : "Not evaluated yet");
  text("waitlist-count", measured ? `${measured.waitlisted.toLocaleString()} waitlisted / ${ATTENDEES.toLocaleString()} accounted for` : "Not evaluated yet");
  text("measurement-label", report ? "Verified candidate · sample data" : measured && events.has("verification:verification-1") ? "Candidate check · sample data" : measured ? "Baseline · sample data" : "2,500 attendees · sample data");
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
  const proofs = [...events.values()].filter((event): event is FeatureProof => event.type === "feature" && event.focus.includes(id));
  const relevant = proofs.at(-1);
  if (relevant) { selectedProof = relevant.id; renderFeatureProof(); }
  const task = taskEvent(id);
  text("inspector-title", task?.title ?? "Not executed yet");
  const evaluation = task?.state === "done" ? evaluationFor(id) : null;
  const taskDetail = task?.kind === "worker"
    ? id === "reviewer" ? "Independent ledger check" : "Evidence-driven repair logic"
    : task?.detail;
  const parts = [task ? `${task.state.toUpperCase()} · ${task.kind === "worker" ? "JAVASCRIPT" : task.kind.toUpperCase()}${taskDetail ? ` · ${taskDetail}` : ""}`
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
async function pollNative(): Promise<void> {
  if (mode !== "native") return;
  if (location.protocol === "file:") {
    notice("Copilot workflow monitoring requires the local server. Run npm run launch -- --no-browser, then open the printed URL with &execution=copilot.");
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Native observer request timed out.")), 5000);
  try {
    const response = await fetch("/api/native/latest", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new WorkflowError(`Native observer returned HTTP ${response.status}. Start the bundled local server.`);
    const payload: unknown = await response.json();
    if (mode !== "native") return;
    if (!isRecord(payload) || !Object.hasOwn(payload, "run")) throw new WorkflowError("Native observer response has no run field.");
    if (payload.run === null) {
      resetMemory();
      nativeId = null; nativeRevision = null; nativeObservedAt = 0; nativeRunError = null;
      clearNotice();
      status = "observing";
      phase = "Waiting for workflow";
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
    if (revision === nativeRevision) return;
    nativeRevision = revision;
    nativeObservedAt = observedAt;
    if (snapshot.runId !== nativeId) { resetMemory(); nativeId = snapshot.runId; }
    nativeMode = snapshot.args.mode;
    walkthroughEnabled = snapshot.args.walkthrough;
    scenario = snapshot.args.scenario;
    for (const event of snapshot.events) absorb(event);
    phase = snapshot.phase;
    report = snapshot.report;
    status = (snapshot.status === "paused" || snapshot.status === "awaiting-approval") && isWalkthroughCheckpoint(snapshot.pauseKey) ? "walkthrough"
      : snapshot.status === "completed" ? "completed" : snapshot.status === "awaiting-approval" ? "awaiting-approval"
      : snapshot.status === "running" ? "running" : snapshot.status === "cancelled" ? "cancelled"
      : snapshot.status === "held" ? "held"
      : snapshot.status === "error" || snapshot.status === "halted" ? "error"
      : snapshot.status === "settling" ? "observing" : "paused";
    render();
  } catch (error) {
    if (mode === "native") {
      notice(error instanceof Error ? error.message : String(error));
    }
  } finally {
    clearTimeout(timeout);
    if (mode === "native") {
      setTimeout(() => void pollNative(), 1500);
    }
  }
}
function downloadEvidence(): void {
  if (!report) { notice("There is no verified report to download yet."); return; }
  const blob = new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(), engine: mode === "native" ? "copilot-runtime" : "standalone-javascript",
    report, executionEvents: [...events.values()],
  }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = `launch-rescue-${report.runId}.json`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.querySelectorAll<HTMLButtonElement>(".scenario-choice").forEach((choice) => choice.addEventListener("click", () => {
  if (status === "running" || status === "awaiting-approval" || mode === "native") return;
  const value = validateArgs({ scenario: choice.dataset.scenario });
  scenario = value.scenario;
  render();
}));
button("run-button").addEventListener("click", () => {
  if (mode === "offline") void execute(status === "paused");
});
button("pause-button").addEventListener("click", () => current?.pauseNow());
button("walkthrough-toggle").addEventListener("click", () => {
  if (mode !== "offline" || status === "running" || status === "walkthrough" || status === "awaiting-approval" || status === "paused") return;
  walkthroughEnabled = !walkthroughEnabled;
  render();
});
button("continue-walkthrough").addEventListener("click", () => {
  if (mode === "offline" && status === "walkthrough") void execute(true);
});
select("proof-step").addEventListener("change", () => {
  selectedProof = select("proof-step").value || null;
  renderFeatureProof();
  drawGraph();
});
button("reset-button").addEventListener("click", () => {
  if (status === "running" || mode === "native") return;
  try { localStorage.removeItem(STORAGE_KEY); journal = null; resetMemory(); clearNotice(); render(); }
  catch (error) { notice(`Unable to reset this workflow's saved state: ${error instanceof Error ? error.message : String(error)}`); }
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
button("theme-toggle").addEventListener("click", () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
});
button("close-inspector").addEventListener("click", () => {
  byId("task-inspector").hidden = true;
  if (selectedTask) graph.querySelector<SVGGElement>(`[data-task="${selectedTask}"]`)?.focus();
  selectedTask = null;
  selectedProof = activeProof;
  renderFeatureProof();
  drawGraph();
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
  if (event.key.toLowerCase() === "s" && mode === "offline" && status !== "awaiting-approval" && status !== "walkthrough") {
    event.preventDefault(); void execute(status === "paused");
  } else if (event.key.toLowerCase() === "p") current?.pauseNow();
});
window.addEventListener("resize", scheduleRender);
const execution = new URLSearchParams(location.search).get("execution");
if (execution === "copilot") {
  mode = "native";
  status = "observing";
  phase = "Waiting for workflow";
  void pollNative();
} else if (execution === null) restore();
else {
  status = "error";
  notice("Unknown workflow view. Open the standard workflow page or use execution=copilot.");
}
render();
