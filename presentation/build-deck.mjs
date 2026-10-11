import PptxGenJS from "pptxgenjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..\\", import.meta.url));
const research = JSON.parse(await readFile(join(root, "sources", "research.json"), "utf8"));
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "GitHub Copilot conference demo";
pptx.subject = "Agentic work, fleet, and code-defined dynamic workflows";
pptx.title = "Launch Rescue — Don't just prompt. Orchestrate.";
pptx.company = "Conference demonstration";
pptx.lang = "en-US";
pptx.theme = { headFontFace: "Aptos Display", bodyFontFace: "Aptos", lang: "en-US" };

const W = 13.333333;
const H = 7.5;
const C = {
  dark: "3D3B3A", deep: "292929", elevated: "343231", border: "5F5F5F",
  text: "DEDEDE", soft: "B0B0B0", accent: "FD8EA1", green: "4ADE80", danger: "F87171",
  paper: "F7F4EF", white: "FFFFFF", ink: "242424", muted: "5C5C5C", rose: "B11F4B",
};
const F = { heading: "Aptos Display", body: "Aptos", code: "Consolas" };
const manifest = [];
const sourceById = new Map(research.sources.map((source) => [source.id, source]));

function track(s, kind, x, y, w, h, label = "") {
  if ([x, y, w, h].some((number) => !Number.isFinite(number)) || x < -.001 || y < -.001 || x + w > W + .02 || y + h > H + .02) {
    throw new Error(`Out-of-bounds ${kind} on slide ${s.number}: ${label}`);
  }
  s.objects.push({ kind, x, y, w, h, label });
}
function txt(s, value, x, y, w, h, size = 24, options = {}) {
  track(s, "text", x, y, w, h, typeof value === "string" ? value : "rich text");
  s.slide.addText(value, { x, y, w, h, fontFace: F.body, fontSize: size, color: s.ink,
    margin: 0, breakLine: false, valign: "mid", paraSpaceAfter: 0, ...options });
}
function shape(s, kind, x, y, w, h, fill = s.surface, options = {}) {
  track(s, "shape", x, y, w, h);
  s.slide.addShape(pptx.ShapeType[kind], { x, y, w, h, fill: { color: fill },
    line: { color: fill, transparency: 100 }, ...options });
}
function line(s, x1, y1, x2, y2, color = s.accent, width = 2, dashed = false, arrow = true) {
  track(s, "connector", Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  s.slide.addShape(pptx.ShapeType.line, { x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), flipH: x2 < x1, flipV: y2 < y1,
    line: { color, width, ...(dashed ? { dashType: "dash" } : {}), endArrowType: arrow ? "triangle" : "none" } });
}
function pill(s, value, x, y, w, accent = false, size = 17) {
  shape(s, "roundRect", x, y, w, .42, accent ? s.accent : s.surface, { radius: .08 });
  txt(s, value, x + .13, y + .05, w - .26, .30, size,
    { color: accent ? s.bg : s.ink, bold: true, align: "center" });
}
function box(s, title, detail, x, y, w, h, accent = false, titleSize = 24, bodySize = 21) {
  shape(s, "roundRect", x, y, w, h, s.surface, { rectRadius: .12,
    line: { color: accent ? s.accent : s.edge, width: accent ? 2 : 1 } });
  txt(s, title, x + .22, y + .22, w - .44, .66, titleSize, { bold: true });
  if (detail) txt(s, detail, x + .22, y + 1.02, w - .44, h - 1.20, bodySize, { color: s.soft, valign: "top" });
}
function node(s, title, x, y, w = 2.05, h = .9, accent = false, size = 21) {
  shape(s, "roundRect", x, y, w, h, accent ? s.accent : s.surface,
    { rectRadius: .1, line: { color: accent ? s.accent : s.edge, width: 1.3 } });
  txt(s, title, x + .13, y + .10, w - .26, h - .20, size,
    { bold: true, align: "center", color: accent ? s.bg : s.ink });
}
function note(s, text, ids) {
  const citations = ids.map((id) => {
    const source = sourceById.get(id);
    if (!source) throw new Error(`Unknown source: ${id}`);
    return `${id}: ${source.title}\n${source.url}`;
  });
  s.slide.addNotes([
    text,
    "\nPRESENTER BOUNDARIES: All launch data is synthetic. Rehearsal uses JavaScript workers, not LLM agents. Native live mode requires eligible Copilot authentication, experimental features, and model availability. No deployment or remote writes.",
    "\nSOURCES (checked 2026-10-10):\n" + citations.join("\n\n"),
  ]);
}
function page(title, notes, ids = ["S1"], light = false, appendix = false) {
  const number = manifest.length + 1;
  const slide = pptx.addSlide();
  slide.hidden = appendix;
  const s = {
    slide, number, title, objects: [], appendix,
    bg: light ? C.paper : C.dark, surface: light ? C.white : C.deep,
    ink: light ? C.ink : C.text, soft: light ? C.muted : C.soft,
    accent: light ? C.rose : C.accent, edge: light ? "DEDEDE" : C.border,
  };
  slide.background = { color: s.bg };
  const multiline = title.includes("\n");
  txt(s, title, .62, .47, 12.04, number === 1 ? 2.02 : multiline ? 1.38 : .84,
    number === 1 ? 60 : multiline ? 42 : 44,
    { fontFace: F.heading, bold: true, valign: "top" });
  txt(s, appendix ? "LAUNCH RESCUE / REFERENCE" : "LAUNCH RESCUE / GITHUB COPILOT", .62, 7.05, 5.10, .22, 11, { color: s.soft, charSpacing: .8 });
  txt(s, `${ids.join(" · ")}  |  10 OCT 2026`, 7.04, 7.05, 5.03, .22, 11,
    { color: s.soft, align: "right", hyperlink: { url: sourceById.get(ids[0]).url } });
  txt(s, String(number).padStart(2, "0"), 12.18, 7.02, .50, .28, 13, { color: s.soft, align: "right" });
  note(s, notes, ids);
  manifest.push(s);
  return s;
}

{
  const s = page("Don't just prompt.\nOrchestrate.",
    "0:00–0:45. Open with: 'A great prompt can start the work. It cannot, by itself, define the process, the handoffs, or the release gate.' Pause. 'Today, this room will choose what breaks. We will let evidence choose who joins.' This talk assumes 25 minutes including an approximately eight-minute live segment. Dynamic workflows are public preview.",
    ["S1", "S2"]);
  txt(s, "Agentic work + dynamic workflows\nwith GitHub Copilot", .67, 2.77, 7.9, 1.02, 29, { color: s.soft });
  pill(s, "PUBLIC PREVIEW", .67, 4.01, 2.25, true, 16);
  node(s, "Goal", .75, 5.00, 1.55, .85);
  node(s, "Evidence", 2.92, 5.00, 2.00, .85);
  node(s, "Specialist", 5.57, 4.30, 2.00, .85, true);
  node(s, "Specialist", 5.57, 5.70, 2.00, .85);
  node(s, "Verify", 8.23, 5.00, 1.83, .85);
  node(s, "Human", 10.72, 5.00, 1.83, .85);
  line(s, 2.30, 5.42, 2.92, 5.42);
  line(s, 4.92, 5.42, 5.57, 4.72);
  line(s, 4.92, 5.42, 5.57, 6.12, s.soft, 1.8, true);
  line(s, 7.57, 4.72, 8.23, 5.42);
  line(s, 7.57, 6.12, 8.23, 5.42, s.soft, 1.8, true);
  line(s, 10.06, 5.42, 10.72, 5.42);
}
{
  const s = page("2,500 people.\nOne broken launch.",
    "0:45–1:30. 'Imagine the ticket launch for a room this size. The same attendee retries. Then room inventory changes. Which bug should we trigger first?' This is invented conference data, not a real event system. The 2,500 value is the fixture size, not a throughput benchmark. Do not reveal the late 200-seat surprise yet.",
    ["S1"], true);
  txt(s, "2,500", .65, 2.08, 6.7, 1.90, 112, { fontFace: F.heading, bold: true, color: s.accent });
  txt(s, "synthetic attendees", .75, 4.06, 5.8, .5, 30);
  for (let row = 0; row < 10; row++) for (let col = 0; col < 25; col++) {
    shape(s, "roundRect", 7.67 + col * .170, 2.1 + row * .205, .11, .13,
      col % 5 === 0 ? s.accent : "DEDEDE", { rectRadius: .025 });
  }
  txt(s, "Each dot = 10 attendees.\nEvery fifth attendee retries.", 7.55, 4.45, 4.86, 1.13, 22, { color: s.soft });
  txt(s, "What happens when the first plan becomes wrong?", .73, 5.83, 11.8, .80, 30, { bold: true });
}
{
  const s = page("An agent needs a feedback loop.",
    "1:30–2:20. Explain agentic work as goal-directed tool use with feedback. This figure is our engineering pattern, not a promise that every agent checks itself correctly. 'The loop can be agentic without being unattended. An autonomous loop can still be wrong.' A test failure is useful evidence, not embarrassment.",
    ["S1", "S6", "S7", "S18"]);
  const labels = ["Observe", "Reason", "Act", "Verify"];
  labels.forEach((label, index) => node(s, label, .82 + index * 3.12, 2.45, 2.30, 1.08, index === 3, 28));
  for (let index = 0; index < 3; index++) line(s, 3.12 + index * 3.12, 2.99, 3.94 + index * 3.12, 2.99);
  line(s, 11.34, 3.53, 11.34, 4.52, s.accent, 2, false, false);
  line(s, 11.34, 4.52, 1.97, 4.52, s.accent, 2, false, false);
  line(s, 1.97, 4.52, 1.97, 3.53);
  txt(s, "Autonomy controls when it stops.\nVerification determines whether it worked.", .87, 5.25, 11.6, 1.09, 31, { bold: true });
}
{
  const s = page("Three controls.\nThree different jobs.",
    "2:20–3:30. Ask: 'Which word answers who decides the process?' Autopilot is autonomy. Fleet encourages model-chosen decomposition and parallel subagents. A dynamic workflow is author-defined code with conditions and handoffs. They can be combined; they are not synonyms. Fleet adds overhead and is useful only when work is separable.",
    ["S1", "S6", "S7"], true);
  box(s, "Autopilot", "Keep working.\n\nThe agent continues toward the goal.", .68, 2.24, 3.82, 3.20, false, 31);
  box(s, "/fleet", "Delegate the work.\n\nCopilot chooses the decomposition.", 4.75, 2.24, 3.82, 3.20, false, 31);
  box(s, "Dynamic workflow", "Define the process.\n\nCode owns the stages, branches, and handoffs.", 8.82, 2.24, 3.82, 3.20, true, 28);
  txt(s, "Autonomy  ≠  parallelism  ≠  a reusable process", .86, 5.93, 11.75, .63, 30, { bold: true, color: s.accent });
}
{
  const s = page("Same word. Different runtimes.",
    "3:30–4:30. Prevent the naming trap. Copilot dynamic workflows are extension programs in CLI/app/SDK, with a preview API. GitHub Agentic Workflows (gh-aw) is a separate open-source tool that compiles Markdown plus YAML frontmatter into GitHub Actions .lock.yml workflows. This package demonstrates the former; it does not deploy the latter.",
    ["S1", "S2", "S13", "S14"]);
  txt(s, "Copilot dynamic workflows", .75, 1.86, 5.66, .72, 29, { bold: true });
  txt(s, "GitHub Agentic Workflows", 7.02, 1.86, 5.56, .72, 29, { bold: true });
  shape(s, "rect", 6.57, 1.90, .018, 4.35, s.edge);
  node(s, "Extension program", .88, 2.97, 5.15, 1.05, true, 28);
  node(s, "Markdown + frontmatter", 7.14, 2.97, 5.15, 1.05, false, 27);
  txt(s, "CLI · app · SDK\nSteps, agents, checkpoints, resume", .98, 4.47, 5.1, 1.57, 24, { valign: "top" });
  txt(s, "Compile → GitHub Actions\nTriggers, runner jobs, safe outputs", 7.23, 4.47, 5.1, 1.57, 24, { valign: "top" });
  pill(s, "THIS DEMO", .98, 6.30, 1.75, true, 16);
}
{
  const s = page("Two features.\nOne controlled process.",
    "4:30–5:30. Point at the two names used throughout the live demo. Dynamic Workflow means code-controlled orchestration: routes, parallel work, journals, and checkpoints. Agentic Workflow means model reasoning inside that process: a cited repair explanation and independent challenge. The model does not invent the workflow program. GitHub Agentic Workflows on Actions is a separate engine and is not run here.",
    ["S1", "S3"]);
  box(s, "Dynamic Workflow", "Code picks specialists.\nCode branches on failed checks.\nCode saves and pauses.", .76, 2.28, 5.80, 3.22, false, 30, 26);
  box(s, "Agentic Workflow", "Model interprets evidence.\nModel explains or rejects.\nModel never rewrites code.", 6.80, 2.28, 5.80, 3.22, true, 30, 26);
  txt(s, "Code owns the process. Models handle judgment.", .96, 6.03, 11.45, .66, 30, { bold: true, color: s.accent });
}
{
  const s = page("Specialists need contracts,\nnot just job titles.",
    "5:30–6:20. A profile controls tools and specialist behavior. The workflow call sets model, effort, and output shape explicitly. The actual profiles use tools: []. The SDK checks only a subset of JSON Schema; semantic validation still belongs in code. An ordinary agent failure returns null. Hold the candidate rather than manufacturing a successful empty answer.",
    ["S3", "S9", "S10"], true);
  shape(s, "roundRect", .70, 2.24, 5.82, 3.75, s.surface, { rectRadius: .12 });
  txt(s, "A constrained specialist", .97, 2.47, 5.15, .50, 26, { bold: true });
  txt(s, 'model: gpt-6.1-sol\ntools: []\n\nWorkflow call:\nreasoningEffort: "max"', .98, 3.19, 5.16, 2.21, 24, { fontFace: F.code });
  shape(s, "roundRect", 6.79, 2.24, 5.82, 3.75, s.surface, { rectRadius: .12 });
  txt(s, "A bounded result", 7.13, 2.46, 5.15, .5, 27, { bold: true });
  txt(s, '{\n  repair: "dedupe",\n  rationale: "...",\n  evidenceIds: ["E-RETRY"]\n}', 7.13, 3.16, 5.42, 2.18, 24, { fontFace: F.code });
  txt(s, "Validate meaning, not just shape.", .98, 6.34, 11.50, .55, 27, { bold: true, color: s.accent });
}
{
  const s = page("Reuse the rules.\nLet the path change.",
    "6:20–7:00. 'We are not saving an answer. We are saving a process.' Inputs and evidence choose the path; model answers can still vary. Version durable step keys and keep producers idempotent. Sharing the extension shares its definition, not someone else's run history.",
    ["S1", "S2", "S3"]);
  txt(s, "RUN A / retry evidence only", .78, 2.35, 5.7, .45, 23, { color: s.soft, bold: true });
  node(s, "Evidence", .79, 3.13, 2.7, .96);
  node(s, "Retry specialist", 4.06, 3.13, 3.8, .96, true, 25);
  node(s, "Verify", 8.64, 3.13, 3.8, .96);
  line(s, 3.49, 3.61, 4.06, 3.61);
  line(s, 7.86, 3.61, 8.64, 3.61);
  txt(s, "RUN B / both faults known up front", .78, 4.47, 9.0, .45, 23, { color: s.soft, bold: true });
  node(s, "Evidence", .79, 5.26, 2.7, .96);
  node(s, "Retry + capacity\nparallel specialists", 4.06, 5.26, 3.8, 1.15, true, 23);
  node(s, "Verify", 8.64, 5.26, 3.8, .96);
  line(s, 3.49, 5.74, 4.06, 5.74);
  line(s, 7.86, 5.74, 8.64, 5.74);
}
{
  const s = page("Identify the feature at every stop.",
    "7:00–7:40. Switch to the feature walkthrough, not an uninterrupted ticket-allocation animation. At every stop identify the feature name, why it helps, the relevant API, the input, and the output. Native agentic proofs show an exact prompt and actual model response. Offline proofs say JavaScript substitute and label the prompt as a preview not sent to a model.",
    ["S2", "S3"]);
  node(s, "Dynamic Workflow", .85, 2.00, 5.58, .94, false, 29);
  txt(s, "CODE chooses the steps.\nBranches when checks fail.\nKeeps completed work.", 1.01, 3.18, 5.32, 1.28, 24, { bold: true });
  node(s, "Agentic Workflow", .85, 4.75, 5.58, .94, true, 29);
  txt(s, "MODEL interprets evidence.\nExplains or rejects the repair.", 1.01, 5.89, 5.32, .85, 24, { bold: true });
  const image = join(root, "presentation", "assets", "native-live-call-repair.png");
  const png = await readFile(image);
  const scale = Math.min(5.28 / png.readUInt32BE(16), 2.30 / png.readUInt32BE(20));
  const imageW = png.readUInt32BE(16) * scale;
  const imageH = png.readUInt32BE(20) * scale;
  txt(s, "Actual model handoff", 7.02, 1.89, 5.28, .47, 26, { bold: true, color: s.accent });
  track(s, "image", 7.02, 2.64, imageW, imageH, "Actual native model and call excerpt");
  s.slide.addImage({ path: image, x: 7.02, y: 2.64, w: imageW, h: imageH,
    altText: "Cropped actual native model handoff showing gpt-6.1-sol max and its ctx.agent call." });
  txt(s, "Evidence in: 500 retry requests", 7.02, 5.13, 5.28, .76, 24, { bold: true });
  txt(s, "repair: dedupe\ncites: E-RETRY", 7.02, 6.00, 5.28, .73, 22, { fontFace: F.code });
}
{
  const s = page("The room picks the incident.",
    "7:40–8:20. Poll by show of hands, not by a nonexistent online voting backend. Choose Retry storm for the simplest path, Both at once for true parallel specialist calls, or Surprise me for the late new-evidence branch. Explain that scenario choice changes real computations. Start a new run before changing scenarios.",
    ["S1"], true);
  box(s, "Retry storm", "500 extra requests.\nIdentity must survive retries.", .75, 1.94, 5.79, 2.05, false, 30);
  box(s, "Room switch", "The published map is stale.\nCapacity must stay honest.", 6.79, 1.94, 5.79, 2.05, false, 30);
  box(s, "Both at once", "Two independent findings.\nTwo specialists in parallel.", .75, 4.31, 5.79, 2.05, false, 30);
  box(s, "Surprise me", "Plan first.\nThen change the evidence.", 6.79, 4.31, 5.79, 2.05, true, 30);
}
{
  const s = page("One command.\nA real Copilot workflow.",
    "8:20–9:20. Launch the version-matched SDK with --walkthrough. It pauses at feature boundaries using the actual Copilot runtime. Type NEXT at those teaching stops; NEXT is not draft approval. Type APPROVE only at the separate final human checkpoint. The browser shows exact handoffs and never resumes native work. Agent models and effort remain explicit.",
    ["S2", "S4", "S5", "S19", "S20"]);
  shape(s, "roundRect", .72, 2.24, 11.90, 1.65, s.surface, { rectRadius: .15 });
  txt(s, "node .\\native\\Run-Sdk.mjs --live --pause --walkthrough", 1.05, 2.76, 11.23, .57, 26, { fontFace: F.code, color: s.accent });
  txt(s, "Analysis", .89, 4.45, 5.37, .50, 24, { color: s.soft });
  txt(s, "GPT-6.1 Sol / max", .89, 5.10, 5.60, .65, 32, { bold: true });
  txt(s, "Independent challenge", 7.01, 4.45, 5.37, .50, 24, { color: s.soft });
  txt(s, "Sonnet 5.5 / high", 7.01, 5.10, 5.60, .65, 32, { bold: true });
  txt(s, "5 teaching stops: NEXT. Final draft review: APPROVE.", .92, 6.18, 11.5, .55, 25, { color: s.soft, bold: true });
}
{
  const s = page("The surprise is new evidence,\nnot a new prompt.",
    "Demo reveal around 10:30. Select Surprise me. The first candidate correctly handles the retry storm. After planning, the synthetic main hall inventory changes from 1,800 to 1,600. The first candidate then fails the capacity contract by 200 seats. We do not ask the main agent a new question: the existing workflow's condition handles the new evidence.",
    ["S1", "S3"]);
  txt(s, "1,800", .80, 2.36, 4.55, 1.52, 86, { fontFace: F.heading, bold: true });
  txt(s, "→", 5.95, 2.45, 1.35, 1.30, 72, { color: s.accent, align: "center" });
  txt(s, "1,600", 8.07, 2.36, 4.45, 1.52, 86, { fontFace: F.heading, bold: true, color: s.accent });
  txt(s, "planned main hall seats", .91, 4.02, 4.45, .55, 25, { color: s.soft });
  txt(s, "current main hall seats", 8.17, 4.02, 4.35, .55, 25, { color: s.soft });
  pill(s, "C-CAPACITY: FAIL", .94, 5.24, 3.64, true, 18);
  txt(s, "200 seats over capacity.\nThe candidate must adapt.", 5.03, 5.04, 7.41, 1.22, 28, { bold: true });
}
{
  const s = page("A failed check changes the graph.",
    "Demo explanation around 11:00. Point to the new capacity specialist and second verification. The code chooses the conditional branch. Models interpret and explain evidence inside the branch. It is not a claim that the model invented the orchestration program. Preserve the working dedupe policy; adapt only the missing work.",
    ["S1", "S3"], true);
  node(s, "Retry repair", .85, 2.24, 2.50, 1.00, false, 24);
  node(s, "Check fails", 4.76, 2.24, 2.50, 1.00, true, 24);
  node(s, "New inventory", 9.32, 2.24, 3.05, 1.00, false, 24);
  line(s, 3.35, 2.74, 4.76, 2.74);
  line(s, 7.26, 2.74, 9.32, 2.74);
  node(s, "Verified retry repair", .85, 4.49, 3.72, 1.02, false, 22);
  line(s, 2.10, 3.24, 2.10, 4.49, s.soft, 1.8, true);
  node(s, "Capacity specialist", 5.07, 4.49, 3.82, 1.02, true, 24);
  node(s, "Verify again", 9.56, 4.49, 2.81, 1.02, false, 25);
  line(s, 10.84, 3.24, 10.84, 3.91, s.accent, 2, false, false);
  line(s, 10.84, 3.91, 6.98, 3.91, s.accent, 2, false, false);
  line(s, 6.98, 3.91, 6.98, 4.49);
  line(s, 4.57, 5.0, 5.07, 5.0, s.soft, 1.8, true);
  line(s, 8.89, 5.0, 9.56, 5.0);
  txt(s, "Same process. A different path.", .97, 6.05, 11.5, .51, 31, { bold: true, color: s.accent });
}
{
  const s = page("Passing checks is not permission.",
    "Demo checkpoint around 12:30–13:30. Point to all three checks, then deliberately do not click approve for a beat. Explain that ctx.pause is a durable checkpoint. Native resume restarts the body and reuses saved JSON steps. Unsaved work may re-run. The checkpoint is not a security sandbox and passing tests does not authorize deployment. Approve only a synthetic local draft.",
    ["S1", "S2", "S3", "S5"]);
  node(s, "3 checks pass", .87, 2.27, 3.08, 1.06, false, 28);
  node(s, "Independent review", 5.11, 2.27, 3.08, 1.06, false, 25);
  node(s, "Human checkpoint", 9.35, 2.27, 3.08, 1.06, true, 26);
  line(s, 3.95, 2.8, 5.11, 2.8);
  line(s, 8.19, 2.8, 9.35, 2.8);
  txt(s, "await ctx.pause(\"approve-local-draft\");", .93, 4.09, 11.60, .67, 29, { fontFace: F.code, color: s.accent });
  txt(s, "A resumable pause is a feature.\nA cancelled run is not a resumable pause.", .96, 5.31, 11.40, 1.04, 29, { bold: true });
}
{
  const s = page("2,500 attendees accounted for.",
    "13:30–14:20. Finish the mixed scenario. These are exact measured synthetic fixture counts, not model-generated numbers and not a production benchmark. Confirmed plus waitlisted equals 2,500. The workflow ignores 500 retries, creates no duplicate outcomes, and respects the current inventory. Download the JSON evidence, then return to slides.",
    ["S1", "S3"], true);
  txt(s, "2,300", .83, 2.23, 5.1, 1.54, 88, { fontFace: F.heading, bold: true, color: s.accent });
  txt(s, "confirmed", .93, 3.83, 5.1, .57, 30);
  txt(s, "+", 6.25, 2.62, .8, .94, 52, { align: "center", color: s.soft });
  txt(s, "200", 7.74, 2.23, 4.87, 1.54, 88, { fontFace: F.heading, bold: true });
  txt(s, "waitlisted", 7.85, 3.83, 4.6, .57, 30);
  node(s, "0 duplicate outcomes", .91, 5.25, 3.65, .94, false, 22);
  node(s, "0 seats over capacity", 4.86, 5.25, 3.65, .94, false, 22);
  node(s, "0 missing attendees", 8.81, 5.25, 3.65, .94, false, 22);
  txt(s, "Measured local fixture. Not a capacity or latency benchmark.", .94, 6.39, 11.54, .33, 18, { color: s.soft });
}
{
  const s = page("Three demo modes.\nOne honest story.",
    "14:20–15:10. State the difference plainly. Offline rehearsal is a self-contained file with real workers and checks, zero LLM calls. Native rehearsal is the actual Copilot workflow runtime with zero LLM calls. Native live calls actual workflow-owned agents and consumes credits. Actual native model runs were verified with requested/resolved GPT-6.1 Sol and Sonnet 5.5; evidence is packaged. Never present offline workers or completed native results as a currently running model performance.",
    ["S2", "S3", "S5"]);
  const rows = [
    ["Offline rehearsal", "Local JavaScript", "No LLM / no sign-in"],
    ["Native rehearsal", "Copilot runtime", "No LLM / preview access"],
    ["Native live", "Copilot agents", "Model calls / AI credits"],
  ];
  rows.forEach((row, index) => {
    const y = 2.25 + index * 1.25;
    shape(s, "roundRect", .78, y, 11.78, 1.03, index === 2 ? s.elevated ?? C.elevated : s.surface, { rectRadius: .1 });
    txt(s, row[0], 1.01, y + .20, 3.65, .57, 26, { bold: true, color: index === 2 ? s.accent : s.ink });
    txt(s, row[1], 5.0, y + .20, 3.31, .57, 24);
    txt(s, row[2], 8.68, y + .20, 3.62, .57, 21, { color: s.soft });
  });
  txt(s, "The fallback preserves the lesson—not an illusion of AI.", .95, 6.35, 11.42, .44, 26, { bold: true });
}
{
  const s = page("Autonomy is not authorization.",
    "15:10–16:15. Explain the trust boundary discovered in the docs. tools: [] constrains the model, not the extension's own JavaScript. Review extension code before trusting it. Session grants propagate to workflow agents. Direct workflow CLI runs do not show permission prompts. The app's config scripts may receive credentials: do not log their environment. This demo has no production systems or remote writes.",
    ["S1", "S4", "S5", "S12"], true);
  shape(s, "roundRect", .79, 2.14, 11.73, 1.68, s.surface, { rectRadius: .1,
    line: { color: s.accent, width: 2 } });
  txt(s, "tools: [] constrains agents.\nIt does not sandbox extension code.", 1.09, 2.42, 11.16, 1.05, 31, { bold: true });
  node(s, "Review trusted code", .91, 4.65, 3.65, 1.04, false, 23);
  node(s, "Scope permissions", 4.86, 4.65, 3.65, 1.04, false, 23);
  node(s, "Gate consequences", 8.81, 4.65, 3.65, 1.04, true, 23);
  txt(s, "No generated code execution. No deployment. No remote writes.", .97, 6.13, 11.50, .48, 25, { color: s.soft });
}
{
  const s = page("Make the workflow a team asset.",
    "16:15–17:10. Show the actual supplied paths. The extension is the reusable process. Agent profiles provide constraints. App configuration provides a manual run script and server detection. None of these is an implicit schedule or deployment. Changes to repository app config need review. Sharing the extension does not copy run history.",
    ["S2", "S4", "S9", "S12"]);
  const paths = [
    [".github\\extensions\\launch-rescue\\extension.mjs", "Reusable process"],
    [".github\\agents\\launch-analyst.agent.md", "Scoped expertise"],
    [".github\\github-app.yml", "Project launch experience"],
  ];
  paths.forEach(([path, label], index) => {
    const y = 2.03 + index * 1.43;
    shape(s, "roundRect", .76, y, 11.84, 1.17, s.surface, { rectRadius: .1 });
    txt(s, path, 1.00, y + .19, 11.24, .44, 24, { fontFace: F.code, color: s.accent });
    txt(s, label, 1.00, y + .72, 10.9, .40, 20, { color: s.soft });
  });
  txt(s, "Share the definition. Review the trust. Rehearse the run.", .95, 6.44, 11.48, .48, 23, { bold: true });
}
{
  const s = page("On GitHub Actions,\nuse the other workflow engine.",
    "17:10–18:00. Optional follow-on if the audience works on repository automation. gh-aw combines Markdown instructions and YAML frontmatter and compiles to Actions. Deterministic CI remains deterministic. Agent jobs are read-only and sandboxed by default; configured safe outputs are validated in scoped jobs. These are configurable defenses, not proof that outputs are correct. No Actions workflow is installed or run by this demo.",
    ["S13", "S14", "S15", "S16"]);
  const parts = ["Markdown", "Compile", "Actions agent", "Safe output"];
  parts.forEach((part, index) => node(s, part, .89 + index * 3.13, 2.55, 2.20, 1.06, index === 3, 25));
  for (let index = 0; index < 3; index++) line(s, 3.09 + index * 3.13, 3.08, 4.02 + index * 3.13, 3.08);
  txt(s, ".md → .lock.yml", .98, 4.12, 11.23, .57, 29, { fontFace: F.code, color: s.accent });
  txt(s, "Keep builds and tests deterministic.\nUse agents for investigation and interpretation.", .98, 5.26, 11.36, 1.06, 29, { bold: true });
}
{
  const s = page("Start with one valuable process.",
    "18:00–19:00. Adoption advice: pick a bounded repeating task; make inputs and success criteria explicit; make failures visible; add one agent where judgment adds value; only parallelize truly independent work. Measure actual usage before choosing credit limits. Don't start by building a fleet for everything.",
    ["S1", "S3", "S6"], true);
  const steps = [
    ["A real input", "A failing test, changed files, or incident evidence."],
    ["A real contract", "What must be true before the work can progress?"],
    ["A judgment step", "Where does interpretation improve the outcome?"],
    ["A human boundary", "What requires review, pause, or approval?"],
  ];
  steps.forEach(([title, body], index) => {
    const y = 1.96 + index * 1.02;
    shape(s, "ellipse", .86, y + .07, .40, .40, s.accent);
    txt(s, title, 1.53, y, 3.83, .68, 26, { bold: true, valign: "top" });
    txt(s, body, 5.54, y, 6.91, .83, 24, { color: s.soft, valign: "top" });
  });
  txt(s, "One process, proven end to end, beats ten busy agents.", 1.04, 6.14, 11.23, .58, 26, { bold: true, color: s.accent });
}
{
  const s = page("Give agents a goal.\nGive workflows a contract.",
    "19:00–20:00. Closing statement, then leave approximately five minutes for questions. 'The next level is not a longer prompt. It is a process that can explain its evidence, survive a failed check, and stop at the right boundary.' Return to the working graph if asked. The resources and fallback are bundled with the presentation.",
    ["S1", "S3"]);
  node(s, "Evidence", .93, 2.58, 2.36, 1.08, false, 27);
  node(s, "Bounded action", 4.01, 2.58, 2.36, 1.08, true, 25);
  node(s, "Verification", 7.09, 2.58, 2.36, 1.08, false, 26);
  node(s, "Human", 10.17, 2.58, 2.22, 1.08, false, 27);
  for (let index = 0; index < 3; index++) line(s, 3.29 + index * 3.08, 3.12, 4.01 + index * 3.08, 3.12);
  txt(s, "Own the process.\nLet the path adapt.", .98, 4.66, 11.38, 1.38, 40, { fontFace: F.heading, bold: true, color: s.accent });
  txt(s, "PowerPoint + source + offline fallback + native extension included.", 1.02, 6.38, 11.4, .39, 21, { color: s.soft });
}
{
  const s = page("Reference: the API contract",
    "Appendix. Exact semantics matter more than the shape of a diagram. ctx.parallel is a barrier; ctx.pipeline can advance items without a stage-wide barrier. Agent ordinary failures return null; hard runtime failures reject. Journal keys alone identify saved steps. Producers are best-effort at-least-once, not exactly-once. A paused run is resumable; nested workflows are unsupported.",
    ["S3"], true, true);
  const rows = [
    ["ctx.agent", "Explicit model + effort + shape. Guard null and validate semantics."],
    ["ctx.parallel", "Independent calls overlap; the next barrier waits for all results."],
    ["ctx.step", "Versioned key + JSON result. Keep effects idempotent."],
    ["ctx.pause", "One-shot durable checkpoint. Resume reuses saved work."],
  ];
  rows.forEach(([method, description], index) => {
    const y = 1.87 + index * 1.10;
    txt(s, method, .86, y, 3.03, .68, 26, { fontFace: F.code, bold: true, color: s.accent, valign: "top" });
    txt(s, description, 4.03, y, 8.22, .87, 24, { valign: "top" });
  });
  txt(s, "Not full JSON Schema. Not exactly-once. Not nested workflows.", .97, 6.22, 11.42, .48, 20, { color: s.soft });
}
{
  const s = page("Reference: preflight the actual host",
    "Appendix. Run the launcher before the venue session. Our active CLI was 1.0.94-3; --no-auto-update unexpectedly selected bundled 1.0.80 and broke workflow arguments, so the launcher omits that flag. Preview availability and model catalogs change. Certain legacy annual Pro/Pro+ billing plans are excluded. App run monitoring is local-session only. Credits are an approximate post-paid ceiling.",
    ["S1", "S2", "S3", "S5"], false, true);
  box(s, "Client + plan", "Experimental features on.\nEligible plan + authentication.\nApp monitoring: local sessions.", .77, 1.91, 5.78, 3.42, false, 28, 24);
  box(s, "Models + limits", "GPT-6.1 Sol / max\nSonnet 5.5 / high\n2 concurrent; 6 admissions\n480 seconds active runtime", 6.79, 1.91, 5.78, 3.42, true, 28, 24);
  txt(s, "AI-credit limits are approximate. Measure usage before setting a budget.", .96, 5.83, 11.42, .85, 25, { bold: true });
}
{
  const s = page("Reference: on-stage recovery",
    "Appendix / presenter rescue card. The fallback is deliberate and honestly labeled. If a model is unavailable, no Auto substitution is performed. An unknown workflow usually means extension discovery or trust; unknown --args with the bundled old runtime was a real compatibility finding. The preferred SDK runner keeps its owning terminal alive at the checkpoint. Type APPROVE there; browser approval does not resume native work. If you choose HOLD, that SDK host exits and you should start a new run.",
    ["S2", "S3", "S5"], true, true);
  const rows = [
    ["Network / model unavailable", "Switch to Offline rehearsal. Say: 'Real checks, no LLM calls.'"],
    ["Workflow not found", "Check experimental mode, extension discovery, and reviewed trust."],
    ["Unknown --args", "Check active CLI; do not force the older bundled runtime."],
    ["Checkpoint reached", "Review the draft, then type APPROVE in the running SDK terminal."],
  ];
  rows.forEach(([problem, recovery], index) => {
    const y = 1.9 + index * 1.11;
    txt(s, problem, .86, y, 4.60, .68, 24, { bold: true, valign: "top" });
    txt(s, recovery, 5.67, y, 6.55, .86, 23, { color: s.soft, valign: "top" });
  });
  txt(s, "A held candidate is better than invented success.", .96, 6.19, 11.4, .58, 24, { bold: true, color: s.accent });
}
{
  const s = page("Reference: read the primary sources",
    "Appendix. Full source inventory is in sources/research.json and Feature-Research.md. Every source footer links to a primary source; speaker notes list the exact URLs supporting that slide. Twenty primary sources and actual runtime evidence are packaged. Documentation was checked 10 October 2026. Public-preview APIs and availability are subject to change.",
    ["S1", "S2", "S3", "S5", "S14", "S15"], false, true);
  const ids = ["S1", "S2", "S3", "S5", "S14", "S15"];
  ids.forEach((id, index) => {
    const source = sourceById.get(id);
    const y = 1.81 + index * .69;
    txt(s, id, .86, y, .60, .44, 21, { color: s.accent, bold: true });
    txt(s, source.title, 1.70, y, 10.60, .47, 24, { hyperlink: { url: source.url } });
  });
  txt(s, `${research.sources.length} primary sources. Full evidence inventory packaged with the demo.`, .97, 6.23, 11.42, .58, 24, { color: s.soft });
}
{
  const s = page("Reference: prompt it in the app",
    "Appendix. Use this prompt in a local Copilot app/CLI session after loading the reviewed extension. A prompt-created run belongs to that session and is visible in its Workflows panel. When running from the external launcher, use its printed owning session ID to resume instead. This prompt does not authorize deployment or remote writes. Agent model/effort is explicit in the workflow calls.",
    ["S1", "S2", "S3"], true, true);
  shape(s, "roundRect", .78, 1.96, 11.78, 3.01, s.surface, { rectRadius: .1 });
  txt(s, 'Run the launch-rescue dynamic workflow with:\nscenario "mixed", mode "live", seed 42,\npauseForApproval true.\n\nUse the configured Sol max / Sonnet high agents.\nReturn the synthetic evidence. Do not deploy.', 1.03, 2.24, 11.19, 2.58, 25, { fontFace: F.code });
  txt(s, "Then open Workflows.\nInspect the checkpoint before resuming.", 1.00, 5.48, 11.35, 1.13, 29, { bold: true, color: s.accent });
}

await mkdir(join(root, "presentation"), { recursive: true });
await pptx.writeFile({ fileName: join(root, "Launch-Rescue.pptx") });
const serializable = manifest.map(({ slide, ...metadata }) => metadata);
await writeFile(join(root, "presentation", "slide-manifest.json"), JSON.stringify(serializable, null, 2), "utf8");
console.log(`Created Launch-Rescue.pptx: ${manifest.length} slides, 21-slide main story, 5 reference slides, all with speaker notes and citations.`);
