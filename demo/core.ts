import type {
  JsonValue,
  WorkflowAgentOptions,
  WorkflowContext,
  WorkflowJsonSchema,
} from "@github/copilot-sdk/extension";

export const VERSION = "launch-rescue-v2";
export const ATTENDEES = 2500;
export const ANALYST = { model: "gpt-6.1-sol", reasoningEffort: "max", agent: "launch-analyst" };
export const REVIEWER = { model: "claude-sonnet-5.5", reasoningEffort: "high", agent: "launch-reviewer" };
const OUTPUT_CONTRACT = "rationale must be plain text with 12 to 1200 characters (aim for at most 600). evidenceIds must contain at least one unique ID from the supplied evidence, with no repeated or unknown IDs.";

export type Scenario = "retries" | "capacity" | "parallel" | "mixed";
export type WorkflowArgs = {
  scenario: Scenario;
  mode: "rehearsal" | "live";
  seed: number;
  pauseForApproval: boolean;
};
export type Repair = "dedupe" | "capacity";
export type Policy = { dedupe: boolean; capacity: boolean };
export type Room = { id: string; label: string; declaredCapacity: number; capacity: number };
export type Request = { ticket: string };
export type Allocation = { ticket: string; room: string | null };
export type Fixture = { requests: Request[]; tickets: string[]; rooms: Room[] };
export type Check = { id: string; title: string; passed: boolean; detail: string };
export type Evaluation = {
  requestCount: number;
  confirmed: number;
  uniqueConfirmed: number;
  waitlisted: number;
  ignoredRetries: number;
  duplicateOutcomes: number;
  oversoldSeats: number;
  missingAttendees: number;
  occupancy: { room: string; used: number; capacity: number }[];
  checks: Check[];
};
export type Evidence = { id: string; summary: string; count: number };
export type Proposal = { repair: Repair; rationale: string; evidenceIds: string[] };
export type RepairRecord = Proposal & { round: 1 | 2; evidenceSnapshot: Evidence[] };
export type Verdict = { verdict: "accept" | "reject"; rationale: string; evidenceIds: string[] };
export type RunReport = {
  version: string;
  runId: string;
  synthetic: true;
  scenario: Scenario;
  mode: "rehearsal" | "live";
  seed: number;
  status: "draft" | "approved";
  policy: Policy;
  before: Evaluation;
  after: Evaluation;
  repairs: RepairRecord[];
  verificationRounds: number;
  reviewer: Verdict;
  note: string;
};
export type TaskKind = "code" | "agent" | "worker" | "gate";
export type WorkflowEvent =
  | { type: "phase"; id: string; title: string }
  | { type: "task"; id: string; title: string; kind: TaskKind; state: "running" | "done" | "error"; dependsOn: string[]; detail: string }
  | { type: "evidence"; id: string; title: string; evidence: Evidence[]; evaluation: Evaluation }
  | { type: "branch"; id: string; title: string; repair: Repair; reason: string }
  | { type: "verification"; id: string; title: string; evaluation: Evaluation; round: number }
  | { type: "twist"; id: string; title: string; detail: string }
  | { type: "ready"; id: string; report: RunReport }
  | { type: "complete"; id: string; report: RunReport };
export type EventSink = (event: WorkflowEvent) => Promise<void>;
export type RunContext = Pick<WorkflowContext, "runId" | "args" | "signal" | "phase" | "log" | "step" | "parallel" | "agent" | "pause">;

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 30) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item: unknown) => isJsonValue(item, depth + 1));
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item, depth + 1));
}

export function validateArgs(value: unknown): WorkflowArgs {
  if (!isRecord(value)) throw new WorkflowError("Workflow inputs must be a JSON object.");
  const allowed = new Set(["scenario", "mode", "seed", "pauseForApproval"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new WorkflowError("Unknown workflow input. Allowed: scenario, mode, seed, pauseForApproval.");
  }
  const scenario = value.scenario ?? "mixed";
  const mode = value.mode ?? "rehearsal";
  const seed = value.seed ?? 42;
  const pauseForApproval = value.pauseForApproval ?? true;
  if (scenario !== "retries" && scenario !== "capacity" && scenario !== "parallel" && scenario !== "mixed") {
    throw new WorkflowError("Choose retries, capacity, parallel, or mixed.");
  }
  if (mode !== "rehearsal" && mode !== "live") throw new WorkflowError("Mode must be rehearsal or live.");
  if (typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 1 || seed > 9999999) {
    throw new WorkflowError("Seed must be an integer from 1 to 9999999.");
  }
  if (typeof pauseForApproval !== "boolean") throw new WorkflowError("pauseForApproval must be boolean.");
  return { scenario, mode, seed, pauseForApproval };
}

export function makeFixture(args: WorkflowArgs, roomChanged = false): Fixture {
  let state = args.seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const tickets = Array.from({ length: ATTENDEES }, (_, index) => `ATT-${String(index + 1).padStart(4, "0")}`);
  for (let index = tickets.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const left = tickets[index];
    const right = tickets[other];
    if (left === undefined || right === undefined) throw new WorkflowError("Synthetic fixture construction failed.");
    tickets[index] = right;
    tickets[other] = left;
  }
  const requests: Request[] = [];
  tickets.forEach((ticket, index) => {
    requests.push({ ticket });
    if (args.scenario !== "capacity" && index % 5 === 0) requests.push({ ticket });
  });
  const reduced = args.scenario === "capacity" || args.scenario === "parallel" || roomChanged;
  return {
    tickets,
    requests,
    rooms: [
      { id: "hall", label: "Main hall", declaredCapacity: 1800, capacity: reduced ? 1600 : 1800 },
      { id: "studio", label: "Studio", declaredCapacity: 700, capacity: 700 },
    ],
  };
}

export function allocate(fixture: Fixture, policy: Policy): { outcomes: Allocation[]; ignoredRetries: number } {
  const seen = new Set<string>();
  const used = new Map(fixture.rooms.map((room) => [room.id, 0]));
  const outcomes: Allocation[] = [];
  let ignoredRetries = 0;
  const hall = fixture.rooms[0];
  const studio = fixture.rooms[1];
  if (!hall || !studio) throw new WorkflowError("The synthetic fixture needs both rooms.");

  for (const request of fixture.requests) {
    if (policy.dedupe && seen.has(request.ticket)) {
      ignoredRetries++;
      continue;
    }
    seen.add(request.ticket);
    let room: Room | undefined;
    if (policy.capacity) {
      room = fixture.rooms.find((candidate) => (used.get(candidate.id) ?? 0) < candidate.capacity);
    } else {
      room = (used.get(hall.id) ?? 0) < hall.declaredCapacity ? hall : studio;
    }
    if (room) used.set(room.id, (used.get(room.id) ?? 0) + 1);
    outcomes.push({ ticket: request.ticket, room: room?.id ?? null });
  }
  return { outcomes, ignoredRetries };
}

export function evaluate(fixture: Fixture, policy: Policy): Evaluation {
  const { outcomes, ignoredRetries } = allocate(fixture, policy);
  const counts = new Map<string, number>();
  const confirmedTickets = new Set<string>();
  const waitlistedTickets = new Set<string>();
  const occupancy = fixture.rooms.map((room) => ({ room: room.label, used: 0, capacity: room.capacity }));
  let confirmed = 0;
  for (const outcome of outcomes) {
    counts.set(outcome.ticket, (counts.get(outcome.ticket) ?? 0) + 1);
    if (outcome.room !== null) {
      confirmed++;
      confirmedTickets.add(outcome.ticket);
      const index = fixture.rooms.findIndex((room) => room.id === outcome.room);
      const occupied = occupancy[index];
      if (!occupied) throw new WorkflowError("Allocator returned an unknown room.");
      occupied.used++;
    } else {
      waitlistedTickets.add(outcome.ticket);
    }
  }
  const duplicateOutcomes = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  const oversoldSeats = occupancy.reduce((sum, room) => sum + Math.max(0, room.used - room.capacity), 0);
  const missingAttendees = fixture.tickets.filter((ticket) => !counts.has(ticket)).length;
  return {
    requestCount: fixture.requests.length,
    confirmed,
    uniqueConfirmed: confirmedTickets.size,
    waitlisted: waitlistedTickets.size,
    ignoredRetries,
    duplicateOutcomes,
    oversoldSeats,
    missingAttendees,
    occupancy,
    checks: [
      { id: "C-UNIQUE", title: "One outcome per attendee", passed: duplicateOutcomes === 0, detail: `${duplicateOutcomes} duplicate outcomes` },
      { id: "C-CAPACITY", title: "Never exceed room capacity", passed: oversoldSeats === 0, detail: `${oversoldSeats} seats over capacity` },
      { id: "C-COVERAGE", title: "No attendee disappears", passed: missingAttendees === 0, detail: `${missingAttendees} missing attendees` },
    ],
  };
}

export function inspectRequests(fixture: Fixture): Evidence {
  const distinct = new Set(fixture.requests.map((request) => request.ticket)).size;
  const count = fixture.requests.length - distinct;
  return { id: "E-RETRY", count, summary: `${fixture.requests.length} requests represent ${distinct} attendees; ${count} are retries.` };
}

export function inspectInventory(fixture: Fixture): Evidence {
  const count = fixture.rooms.reduce((sum, room) => sum + Math.max(0, room.declaredCapacity - room.capacity), 0);
  return { id: "E-INVENTORY", count, summary: `Published inventory exceeds current room capacity by ${count} seats.` };
}

function validateEvidence(value: unknown): Evidence {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.summary !== "string"
      || typeof value.count !== "number" || !Number.isSafeInteger(value.count) || value.count < 0) {
    throw new WorkflowError("Saved evidence is invalid. Start a fresh run.");
  }
  return { id: value.id, summary: value.summary, count: value.count };
}

export function validateEvaluation(value: unknown): Evaluation {
  if (!isRecord(value)) throw new WorkflowError("Saved verification is not an object.");
  const fields = ["requestCount", "confirmed", "uniqueConfirmed", "waitlisted", "ignoredRetries",
    "duplicateOutcomes", "oversoldSeats", "missingAttendees"] as const;
  for (const field of fields) {
    if (typeof value[field] !== "number" || !Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new WorkflowError(`Invalid saved verification field: ${field}.`);
    }
  }
  if (!Array.isArray(value.checks) || value.checks.length !== 3 || !Array.isArray(value.occupancy) || value.occupancy.length !== 2) {
    throw new WorkflowError("Saved verification has an invalid shape.");
  }
  const checks = value.checks.map((check: unknown): Check => {
    if (!isRecord(check) || typeof check.id !== "string" || typeof check.title !== "string"
      || typeof check.passed !== "boolean" || typeof check.detail !== "string") {
      throw new WorkflowError("Invalid saved contract check.");
    }
    return { id: check.id, title: check.title, passed: check.passed, detail: check.detail };
  });
  const occupancy = value.occupancy.map((room: unknown) => {
    if (!isRecord(room) || typeof room.room !== "string" || typeof room.used !== "number"
      || typeof room.capacity !== "number" || !Number.isSafeInteger(room.used) || !Number.isSafeInteger(room.capacity)
      || room.used < 0 || room.capacity < 0) throw new WorkflowError("Invalid saved occupancy.");
    return { room: room.room, used: room.used, capacity: room.capacity };
  });
  const expected = [
    ["C-UNIQUE", value.duplicateOutcomes === 0],
    ["C-CAPACITY", value.oversoldSeats === 0],
    ["C-COVERAGE", value.missingAttendees === 0],
  ];
  if (checks.some((check, index) => check.id !== expected[index]?.[0] || check.passed !== expected[index]?.[1])
      || occupancy.reduce((sum, room) => sum + room.used, 0) !== value.confirmed
      || occupancy.reduce((sum, room) => sum + Math.max(0, room.used - room.capacity), 0) !== value.oversoldSeats) {
    throw new WorkflowError("Saved check flags do not agree with measured outcomes.");
  }
  // The range checks above narrow values at runtime; construct each numeric field explicitly.
  return {
    requestCount: Number(value.requestCount), confirmed: Number(value.confirmed),
    uniqueConfirmed: Number(value.uniqueConfirmed), waitlisted: Number(value.waitlisted),
    ignoredRetries: Number(value.ignoredRetries), duplicateOutcomes: Number(value.duplicateOutcomes),
    oversoldSeats: Number(value.oversoldSeats), missingAttendees: Number(value.missingAttendees), occupancy, checks,
  };
}

function validateExplanation(value: unknown, evidenceIds: string[]): { rationale: string; evidenceIds: string[] } {
  if (!isRecord(value) || typeof value.rationale !== "string" || value.rationale.trim().length < 12
      || value.rationale.length > 1200 || !Array.isArray(value.evidenceIds)
      || value.evidenceIds.length < 1 || value.evidenceIds.length > evidenceIds.length) {
    throw new WorkflowError("Agent explanation is missing or outside the demo's semantic constraints.");
  }
  const ids: string[] = [];
  for (const id of value.evidenceIds) {
    if (typeof id !== "string" || !evidenceIds.includes(id) || ids.includes(id)) {
      throw new WorkflowError("Agent cited unknown or duplicate evidence. Candidate held.");
    }
    ids.push(id);
  }
  return { rationale: value.rationale.trim(), evidenceIds: ids };
}

export function validateProposal(value: unknown, repair: Repair, evidence: Evidence[]): Proposal {
  const explanation = validateExplanation(value, evidence.map((item) => item.id));
  if (!isRecord(value) || value.repair !== repair) {
    throw new WorkflowError(`Specialist must return the bounded ${repair} repair; candidate held.`);
  }
  const required = repair === "dedupe" ? "E-RETRY" : "E-INVENTORY";
  if (!explanation.evidenceIds.includes(required)) throw new WorkflowError("Specialist did not cite its required evidence.");
  return { repair, ...explanation };
}

function scopedEvidence(repair: Repair, evidence: Evidence[]): Evidence[] {
  const required = repair === "dedupe" ? "E-RETRY" : "E-INVENTORY";
  const snapshot = evidence.filter((item) => item.id === required).map((item) => ({ ...item }));
  if (snapshot.length !== 1 || snapshot[0]?.count === 0) {
    throw new WorkflowError("A specialist requires exactly one actionable evidence snapshot.");
  }
  return snapshot;
}

export function validateRepairRecord(value: unknown, repair: Repair, round: 1 | 2, expected: Evidence[]): RepairRecord {
  if (!isRecord(value) || value.round !== round || !Array.isArray(value.evidenceSnapshot)) {
    throw new WorkflowError("Saved repair is missing its observation round or evidence snapshot.");
  }
  const snapshot = value.evidenceSnapshot.map(validateEvidence);
  const required = scopedEvidence(repair, expected);
  if (snapshot.length !== 1 || snapshot[0]?.id !== required[0]?.id
      || snapshot[0]?.count !== required[0]?.count || snapshot[0]?.summary !== required[0]?.summary) {
    throw new WorkflowError("Saved repair evidence does not match its observation round.");
  }
  return { ...validateProposal(value, repair, snapshot), round, evidenceSnapshot: snapshot };
}

export function validateVerdict(value: unknown, evidence: Evidence[]): Verdict {
  const explanation = validateExplanation(value, evidence.map((item) => item.id));
  if (!isRecord(value) || (value.verdict !== "accept" && value.verdict !== "reject")) {
    throw new WorkflowError("Reviewer returned no valid accept/reject verdict. Candidate held.");
  }
  return { verdict: value.verdict, ...explanation };
}

function proposalSchema(repair: Repair): WorkflowJsonSchema {
  return {
    type: "object", required: ["repair", "rationale", "evidenceIds"],
    properties: {
      repair: { type: "string", const: repair },
      rationale: { type: "string" },
      evidenceIds: { type: "array", items: { type: "string" } },
    },
  };
}

export const VERDICT_SCHEMA: WorkflowJsonSchema = {
  type: "object", required: ["verdict", "rationale", "evidenceIds"],
  properties: {
    verdict: { type: "string", enum: ["accept", "reject"] },
    rationale: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
};

function localProposal(repair: Repair, evidence: Evidence[]): Proposal {
  const id = repair === "dedupe" ? "E-RETRY" : "E-INVENTORY";
  const finding = evidence.find((item) => item.id === id);
  if (!finding || finding.count <= 0) throw new WorkflowError("No evidence supports this specialist branch.");
  return {
    repair,
    rationale: repair === "dedupe"
      ? `Use ticket identity as the idempotency key: ${finding.count} retry requests must reuse the first decision.`
      : `Allocate against current inventory, not the published map: ${finding.count} unavailable seats must become a waitlist.`,
    evidenceIds: [id],
  };
}

function independentLedgerReview(fixture: Fixture, policy: Policy, evidence: Evidence[]): Verdict {
  const { outcomes } = allocate(fixture, policy);
  const remaining = new Map(fixture.rooms.map((room) => [room.id, room.capacity]));
  const ledger = new Set<string>();
  let valid = true;
  for (const outcome of outcomes) {
    if (ledger.has(outcome.ticket)) valid = false;
    ledger.add(outcome.ticket);
    if (outcome.room !== null) {
      const available = remaining.get(outcome.room);
      if (available === undefined || available < 1) valid = false;
      else remaining.set(outcome.room, available - 1);
    }
  }
  if (ledger.size !== ATTENDEES) valid = false;
  return {
    verdict: valid ? "accept" : "reject",
    rationale: valid
      ? "An independent ledger walk found one decision per attendee, respected each room's current capacity, and accounted for everyone."
      : "The independent ledger walk found a duplicate, an unavailable seat, or a missing attendee.",
    evidenceIds: evidence.map((item) => item.id),
  };
}

function abortIfNeeded(ctx: RunContext): void {
  if (ctx.signal.aborted) throw ctx.signal.reason ?? new WorkflowError("Run interrupted.");
}

export async function runLaunchRescue(ctx: RunContext, emit: EventSink): Promise<RunReport> {
  const args = validateArgs(ctx.args);
  const initialFixture = makeFixture(args);
  const policy: Policy = { dedupe: false, capacity: false };
  const proposals: RepairRecord[] = [];
  const kind: TaskKind = args.mode === "live" ? "agent" : "worker";
  const phase = async (title: string) => {
    abortIfNeeded(ctx);
    ctx.phase(title);
    await emit({ type: "phase", id: `phase:${title}`, title });
  };
  const task = async (
    id: string, title: string, taskKind: TaskKind, dependsOn: string[],
    producer: () => JsonValue | Promise<JsonValue>, detail = "",
  ): Promise<JsonValue> => {
    abortIfNeeded(ctx);
    await emit({ type: "task", id, title, kind: taskKind, state: "running", dependsOn, detail });
    let value: JsonValue;
    try {
      value = await ctx.step(`${VERSION}:${id}`, producer);
    } catch (error) {
      if (!ctx.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.log(`Failed ${title}: ${message}`);
        await emit({ type: "task", id, title, kind: taskKind, state: "error", dependsOn, detail: message });
      }
      throw error;
    }
    abortIfNeeded(ctx);
    await emit({ type: "task", id, title, kind: taskKind, state: "done", dependsOn, detail });
    return value;
  };
  const specialist = async (repair: Repair, evidence: Evidence[], round: 1 | 2, dependency: string): Promise<RepairRecord> => {
    const id = `${repair}-specialist-${round}`;
    const title = repair === "dedupe" ? "Retry specialist" : "Capacity specialist";
    const snapshot = scopedEvidence(repair, evidence);
    const detail = args.mode === "live" ? "GPT-6.1 Sol / max" : "Local JavaScript worker / no LLM";
    const value = await task(id, title, kind, [dependency], async () => {
      if (args.mode === "rehearsal") return {
        ...localProposal(repair, snapshot), round, evidenceSnapshot: snapshot,
      };
      const prompt = [
        "Analyze this synthetic conference-launch fixture. Use no tools and do not delegate.",
        `Observation round: ${round}. You see only your specialist's immutable evidence snapshot.`,
        `Your bounded repair is ${repair}. Return repair, rationale, and evidenceIds.`,
        repair === "dedupe" ? "Reuse the first decision by ticket ID."
          : "Use current room inventory and waitlist excess attendees.",
        "Discuss only your supplied evidence. Do not speculate about other components or claim tests pass.",
        "Deterministic code verifies the choice. Cite only supplied evidence IDs.",
        OUTPUT_CONTRACT,
        `Evidence: ${JSON.stringify(snapshot)}`,
      ].join("\n");
      const options: WorkflowAgentOptions = { ...ANALYST, label: id, schema: proposalSchema(repair) };
      const result = await ctx.agent(prompt, options);
      if (result === null) throw new WorkflowError(`${title} returned no usable result. Retry or use the labeled rehearsal.`);
      return { ...validateProposal(result, repair, snapshot), round, evidenceSnapshot: snapshot };
    }, detail);
    return validateRepairRecord(value, repair, round, snapshot);
  };

  await phase("Observe");
  await task("capture", "Capture synthetic launch", "code", [], () => ({
    scenario: args.scenario, seed: args.seed, attendees: ATTENDEES, requests: initialFixture.requests.length,
  }), "2,500 attendees / synthetic fixture");
  const before = validateEvaluation(await task("baseline", "Reproduce the failure", "code", ["capture"],
    () => evaluate(initialFixture, policy), "Execute the buggy allocator and three contract checks"));

  await phase("Diagnose");
  const scans = await ctx.parallel([
    () => task("scan-retries", "Inspect request identities", "code", ["baseline"], () => inspectRequests(initialFixture)),
    () => task("scan-inventory", "Audit room inventory", "code", ["baseline"], () => inspectInventory(initialFixture)),
  ]);
  if (scans.some((scan) => scan === null) || scans.length !== 2) {
    throw new WorkflowError("Evidence collection failed. No specialist or release may proceed.");
  }
  const evidence = scans.map(validateEvidence);
  await emit({ type: "evidence", id: "initial-evidence", title: "Evidence decides who joins",
    evidence: evidence.map((item) => ({ ...item })), evaluation: before });
  const needed: Repair[] = [];
  if ((evidence.find((item) => item.id === "E-RETRY")?.count ?? 0) > 0) needed.push("dedupe");
  if ((evidence.find((item) => item.id === "E-INVENTORY")?.count ?? 0) > 0) needed.push("capacity");
  if (needed.length === 0) throw new WorkflowError("The selected synthetic incident contains no actionable evidence.");

  await phase("Repair");
  for (const repair of needed) {
    await emit({ type: "branch", id: `branch:${repair}:1`, title: `Add ${repair === "dedupe" ? "retry" : "capacity"} specialist`,
      repair, reason: "Observed evidence, not a fixed list of agents." });
  }
  const initialProposals = await ctx.parallel(needed.map((repair) => () => specialist(repair, evidence, 1,
    repair === "dedupe" ? "scan-retries" : "scan-inventory")));
  if (initialProposals.some((proposal) => proposal === null)) {
    throw new WorkflowError("A required specialist failed. Candidate held; no silent substitute.");
  }
  initialProposals.forEach((proposal, index) => {
    const repair = needed[index];
    if (repair === undefined) throw new WorkflowError("Specialist result has no matching branch.");
    const valid = validateRepairRecord(proposal, repair, 1, evidence);
    proposals.push(valid);
    policy[valid.repair] = true;
  });
  await task("candidate-1", "Assemble bounded repair", "code",
    needed.map((repair) => `${repair}-specialist-1`), () => ({ ...policy }), "No generated code is executed");

  await phase("Verify");
  let fixture = initialFixture;
  if (args.scenario === "mixed") {
    await task("room-change", "Room inventory changes", "code", ["candidate-1"],
      () => ({ removedSeats: 200, room: "Main hall" }), "Synthetic surprise after the first plan");
    fixture = makeFixture(args, true);
    await emit({ type: "twist", id: "twist", title: "Plot twist: 200 seats disappear",
      detail: "A new room map arrives after planning. The old candidate must face the new evidence." });
  }
  let after = validateEvaluation(await task("verify-1", "Run acceptance checks", "code",
    [args.scenario === "mixed" ? "room-change" : "candidate-1"], () => evaluate(fixture, policy)));
  let verificationRounds = 1;
  await emit({ type: "verification", id: "verification-1", title: "Code, not confidence, decides", evaluation: after, round: 1 });

  if (!after.checks.every((check) => check.passed)) {
    if (args.scenario !== "mixed" || after.duplicateOutcomes !== 0 || after.oversoldSeats !== 200) {
      throw new WorkflowError("Candidate failed an unexpected acceptance check. Release held.");
    }
    const updatedInventory = validateEvidence(await task("rescan-inventory", "Read the new inventory", "code",
      ["verify-1"], () => inspectInventory(fixture)));
    const inventoryIndex = evidence.findIndex((item) => item.id === updatedInventory.id);
    if (inventoryIndex < 0) throw new WorkflowError("Updated inventory has no original evidence ID.");
    evidence[inventoryIndex] = updatedInventory;
    await emit({ type: "branch", id: "branch:capacity:2", title: "Failed check adds a new specialist",
      repair: "capacity", reason: "C-CAPACITY failed against the changed inventory. Replan only this branch." });
    await phase("Adapt");
    const repair = await specialist("capacity", evidence, 2, "rescan-inventory");
    proposals.push(repair);
    policy.capacity = true;
    await task("candidate-2", "Revise the candidate", "code", ["capacity-specialist-2"],
      () => ({ ...policy }), "Keep the verified retry repair; add current-inventory allocation");
    await phase("Verify");
    after = validateEvaluation(await task("verify-2", "Re-run acceptance checks", "code", ["candidate-2"],
      () => evaluate(fixture, policy)));
    verificationRounds = 2;
    await emit({ type: "verification", id: "verification-2", title: "The adapted candidate passes", evaluation: after, round: 2 });
  }
  if (!after.checks.every((check) => check.passed)) throw new WorkflowError("Revised candidate failed. Release held.");

  await phase("Challenge");
  const reviewerDependency = verificationRounds === 2 ? "verify-2" : "verify-1";
  const verdictValue = await task("reviewer", "Independent challenge", kind, [reviewerDependency], async () => {
    if (args.mode === "rehearsal") return independentLedgerReview(fixture, policy, evidence);
    const prompt = [
      "Independently challenge this synthetic local release candidate. Use no tools or delegation.",
      "Return verdict (accept/reject), rationale, evidenceIds. Cite only supplied evidence IDs.",
      OUTPUT_CONTRACT,
      "Reject if any contract check fails or the proposed policy is inconsistent with the evidence.",
      "Every repair includes its observation round and immutable evidenceSnapshot.",
      "Judge historical explanations against their own snapshots and the final policy against current evidence.",
      args.scenario === "mixed"
        ? "Inventory deliberately changed after round 1. Round 2 corrected that new fact; do not treat a correctly scoped round-1 observation as a contradiction."
        : "Both the policy and explanations must be consistent with the supplied observations.",
      "Do not claim production readiness, deployment, performance, or real ticket allocation.",
      `Current evidence: ${JSON.stringify(evidence)}`,
      `Repairs: ${JSON.stringify(proposals)}`,
      `Policy: ${JSON.stringify(policy)}`,
      `Acceptance checks and measured synthetic counts: ${JSON.stringify(after)}`,
    ].join("\n");
    const result = await ctx.agent(prompt, { ...REVIEWER, label: "independent-review", schema: VERDICT_SCHEMA });
    if (result === null) throw new WorkflowError("Independent reviewer returned no verdict. Candidate held.");
    return validateVerdict(result, evidence);
  }, args.mode === "live" ? "Sonnet 5.5 / high" : "Independent local ledger walk / no LLM");
  const reviewer = validateVerdict(verdictValue, evidence);
  if (reviewer.verdict !== "accept") throw new WorkflowError(`Independent reviewer held the candidate: ${reviewer.rationale}`);

  await phase("Approve");
  const report: RunReport = {
    version: VERSION, runId: ctx.runId, synthetic: true, scenario: args.scenario, mode: args.mode,
    seed: args.seed, status: "draft", policy: { ...policy }, before, after, repairs: proposals,
    verificationRounds, reviewer,
    note: "Synthetic local release candidate only. No deployment, real tickets, purchases, or remote writes.",
  };
  await task("approval", "Human review checkpoint", "gate", ["reviewer"],
    () => ({ decision: "review-ready", checksPassed: after.checks.length }),
    args.pauseForApproval ? "Pause, inspect, then resume the same run" : "Draft-only run; no approval claimed");
  await emit({ type: "ready", id: "ready", report: structuredClone(report) });
  ctx.log(`All ${after.checks.length} checks pass. ${after.uniqueConfirmed} confirmed, ${after.waitlisted} waitlisted. Synthetic only.`);
  if (args.pauseForApproval) {
    await ctx.pause(`${VERSION}:approve-local-draft`);
    abortIfNeeded(ctx);
    report.status = "approved";
  }
  await phase("Complete");
  await emit({ type: "complete", id: "complete", report: structuredClone(report) });
  return report;
}
