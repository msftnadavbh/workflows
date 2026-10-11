<div align="center">
  <h1>Launch Rescue</h1>
  <p><strong>Give agents a goal. Give workflows a contract.</strong></p>
  <p>An interactive GitHub Copilot demo where evidence changes the plan,<br>
  specialists challenge the result, and a human decides what happens next.</p>
  <p>
    <a href="#quickstart">Quickstart</a> &middot;
    <a href="#where-the-workflow-features-are-used">How it works</a> &middot;
    <a href="#presenter-kit">Presentation</a> &middot;
    <a href="./Feature-Research.md">Research</a>
  </p>
</div>

<p align="center">
  <img src="./presentation/assets/demo-desktop.png" alt="Customer-facing workflow execution showing changed inventory, a failed check, the added capacity path, verified outcomes, and separate human approval." width="100%">
</p>

<p align="center"><em>Customer-facing execution: evidence changes the path; checks and human review gate the result. Sample event data.</em></p>

> [!NOTE]
> This is a community demonstration, not an official GitHub product. Copilot **dynamic workflows are public preview**. The standalone experience needs no account; native execution requires eligible Copilot authentication and preview access.

## Quickstart

### Try the interactive demo

[Download the stage kit](https://github.com/msftnadavbh/workflows/raw/refs/heads/main/Launch-Rescue-Stage-Kit.zip), extract it, and open **`Launch-Rescue-Demo.html`** in a modern browser. Everything it needs is in that file: no installation, sign-in, or network connection.

Or clone the repository:

```powershell
git clone https://github.com/msftnadavbh/workflows.git
Set-Location workflows
```

On macOS, use `cd workflows` instead of `Set-Location`. The standalone HTML requires only a modern browser on either Apple Silicon or Intel; it does not require Node or a Copilot account.

Leave **Step by step** enabled, choose **Surprise me**, and click **Run rescue**. The workflow pauses at each decision boundary. Inspect the execution code, input, and output; click **Continue** to advance. Final draft approval is a separate action.

For an uninterrupted run, toggle **Step by step** to **Continuous run**. The same execution panel still shows the decisions.

The customer-facing interface contains no runtime picker, rehearsal banner, presenter cues, stage toggle, setup commands, or presentation controls. The layout adapts automatically. Each executed step identifies its source: **JavaScript** for local code, or the actual **Copilot model and reasoning effort**.

**Used here:** JavaScript workers and deterministic checks. **No Copilot dynamic-workflow runtime or LLM calls execute in the standalone version.**

### Run the native Copilot workflow

Requires **Node.js 22.12+**, a signed-in eligible Copilot account, dynamic-workflow preview access, and access to the configured models.

In the repository folder, these commands work in Windows PowerShell and macOS Terminal:

```powershell
npm ci
npm run launch -- --no-browser
```

Open **http://127.0.0.1:4173/?scoutTheme=dark&execution=copilot**. This is the customer-facing view of the Copilot run; setup and authorization remain outside the browser. In a second terminal, from the same folder:

```powershell
npm run native -- --live --pause --walkthrough --scenario mixed
```

**Used here:** the actual **Copilot dynamic-workflow runtime** plus **agentic model reasoning**. The browser observes execution; it does not start the agents or authorize native work.

> [!IMPORTANT]
> Native live runs consume **AI credits**. Type **`NEXT` in the running SDK terminal** at each feature stop. NEXT advances the explanation; it does **not** approve the draft. Only the separate final **`APPROVE`** checkpoint records local draft approval. Type **`HOLD`** to close the host without approval. Commands are case-insensitive; blank lines and typos ask again.

To exercise the actual workflow runtime **without model calls**, replace `--live` with `--rehearsal`. Omit `--pause` for a draft-only run; no human approval is then requested or claimed.

### Windows and macOS prerequisites

Use **Node.js 22.12+** built for your machine's architecture: **arm64** on Apple Silicon and **x64** on Intel. Avoid running an arm64 Mac's terminal or Node under Rosetta when checking the arm64 target. The unchanged SDK **1.0.19** selects its matching runtime package automatically; there is no separate Mac workflow, installer, or app bundle.

Development and stage packaging also require **Python 3**. The npm commands invoke `python` on Windows and `python3` on macOS, inherit terminal I/O, and preserve exit codes. A missing interpreter is an explicit error, not a fallback.

Browser automation uses **installed Microsoft Edge on Windows** and **Playwright Chromium on macOS**. Provision Chromium explicitly on a Mac:

```sh
npm ci
npx playwright install chromium
npm run check:platform -- --platform darwin --arch arm64
```

On Intel, replace `arm64` with `x64`. These checks identify the actual Node architecture and selected SDK package, and start its pinned runtime without creating a session or model call. They do not authenticate Copilot or claim a native checkpoint/resume run passed.

Native rehearsal/live runs still require an authenticated, preview-eligible Copilot account. Keep the owning SDK terminal open, use **NEXT** at teaching checkpoints, and **APPROVE** only at the separate final gate. HOLD, EOF, and interruption never approve. The browser is read-only.

**Verification status:** [Platform CI passed on Windows x64, macOS 15 arm64, and macOS 15 Intel x64](https://github.com/msftnadavbh/workflows/actions/runs/38124419179). Each actual runner passed build/typecheck, 73 Node tests, 4 packaging tests, 31 browser tests, deck verification, proof-gated packaging, and pinned native runtime startup without creating a session or model call. Authenticated Mac workflow checkpoint/resume and live runs remain unverified because Copilot credentials and preview access were not supplied to CI. Existing native workflow proofs are Windows observations, not Mac workflow certification.

### See what each run cost

Native runs report usage from the Copilot runtime in the terminal and save it to `runs/RUN_ID/cost.json`. In `--pause` runs the table also appears before the final approval checkpoint, not at every teaching stop. The customer-facing browser remains unchanged.

```text
Cost of this run (measured by the Copilot runtime)
  Run total: <credits> AI credits · <n> subagents · <s>s active
  Model              Requests  Input  Cached in  Output  AI credits
  Cache reads: <tokens> tokens (<share>% of reported input + cache-read tokens).
```

| Field | Source | Scope |
|---|---|---|
| Run total, subagents, active time | `session.workflow.getRunDetail(runId).consumed` | This workflow run |
| Per-model requests and input / cached / output tokens, AI credits | `session.rpc.usage.getMetrics()` | Session-wide; not independently scoped to the workflow run |

Both APIs are **experimental**. AI-credit accounting is post-paid and approximate; this is runtime-reported usage, not a price list or benchmark. Session metrics may omit workflow-owned agents, so missing per-model rows are reported as unavailable rather than zero. Missing or invalid values are shown as `n/a`. If either API fails or takes more than five seconds, the meter warns and the workflow continues.

## Watch the features in the demo

These are visible, paced stops in the demo itself—not just documentation:

| Stop | Feature shown on screen | What you can inspect |
|---|---|---|
| **Choose the work** | **Dynamic Workflow** | `ctx.parallel`, measured evidence, and the code-selected specialist list. No agent has run yet. |
| **Explain a repair** | **Agentic Workflow** | The exact model prompt, cited structured response, model/effort, and the handoff into a bounded policy. The standalone version labels the executed logic **CODE / REPAIR**, not an agent. |
| **Change the next step** | **Dynamic Workflow** | The failed capacity check, new inventory, the retained retry repair, and the added capacity branch. |
| **Verify the result** | **Deterministic checks** | The actual uniqueness, capacity, and coverage checks—not a model's claim of success. |
| **Challenge the answer** | **Agentic Workflow** | The independent review prompt, verdict, rationale, and evidence provenance. |
| **Require a decision** | **Dynamic Workflow + human** | The separate approval checkpoint. After resume, the proof panel shows saved steps reused by the same run. |

The graph marks **AGENTIC / LLM**, **JAVASCRIPT**, **PARALLEL SCAN / CODE**, and **WORKFLOW / HUMAN** explicitly. Its highlighted nodes match the selected execution detail. **Why it helps** names the benefit, and the review shows both verdict rules: accept continues, reject holds. Open **Execution history** to revisit a completed step; the current step returns when you close node inspection. Exact model prompts appear only for model handoffs, not as hypothetical previews for JavaScript steps. The Copilot browser view never resumes or approves a run.

**“Agentic Workflow” here means agent reasoning inside the local Copilot process. It is not the separate GitHub Agentic Workflows (`gh-aw`) engine on Actions.**

## The moment to watch

The ticket launch represents **2,500 synthetic attendees**. Every fifth attendee retries. The first repair removes duplicate outcomes.

Then the room changes.

The main hall loses **200 seats after the first plan is built**. An acceptance check fails. The workflow reads the new inventory, adds the missing capacity specialist, and checks the revised candidate. It does not restart every step or wait for a new prompt.

The final reduced-capacity result is **2,300 confirmations + 200 waitlisted**, with **zero duplicate outcomes, oversold seats, or missing attendees**.

These are executable fixture results, not production capacity, latency, or cost benchmarks.

| Choose in the browser | Native `--scenario` | What the run demonstrates |
|---|---|---|
| **Retry storm** | `retries` | Retry evidence adds the identity specialist; unrelated capacity work is skipped. |
| **Room switch** | `capacity` | Stale inventory adds the capacity specialist; excess attendees are waitlisted. |
| **Both at once** | `parallel` | Two known, independent findings launch two specialists in parallel. |
| **Surprise me** | `mixed` | New evidence arrives after planning; a failed check adds a branch and a second verification. |

## Where the workflow features are used

The process is deliberately split into **orchestration**, **judgment**, **verification**, and **human review**. Not every step needs a model.

| Part of the demo | Feature actually used | How it helps | Implementation |
|---|---|---|---|
| Register and run the process | **Dynamic workflow:** `defineWorkflow`, `joinSession` | A named, reusable process replaces a one-off sequence of chat instructions. | [Native extension](./native/extension.ts) |
| Collect request and inventory evidence | **Dynamic workflow + deterministic code:** `ctx.parallel` | Independent probes overlap, then hand measured evidence to the next stage. No model is needed to count requests. | [Evidence collection](./demo/core.ts) |
| Choose which specialist joins | **Dynamic workflow:** code-defined conditions | Retry and inventory findings select only the necessary branches instead of launching every agent. | [Branch selection](./demo/core.ts) |
| Explain a bounded repair | **Agentic work:** `ctx.agent` with scoped evidence and structured output | A specialist interprets the supplied evidence and explains a permitted repair. It cannot turn its answer into arbitrary executable code. | [Analyst profile](./.github/agents/launch-analyst.agent.md) |
| React to the room change | **Dynamic workflow:** failed-check branch | The process retains the working retry repair and adds only the capacity work required by the new facts. | [Adaptive flow](./demo/core.ts) |
| Decide whether the repair worked | **Deterministic code:** allocation and contract checks | Measured outcomes, not model confidence, establish uniqueness, capacity, and coverage. | [Allocator and checks](./demo/core.ts) |
| Independently challenge the explanation | **Agentic work:** a separate reviewer model | Another model checks the candidate against current evidence and each earlier repair's immutable observation snapshot. Rejection holds the candidate. | [Reviewer profile](./.github/agents/launch-reviewer.agent.md) |
| Reuse completed work on resume | **Dynamic workflow:** versioned `ctx.step` journals | Saved JSON results can be reused when the same run resumes, avoiding repeated completed agent work. Unsaved work may run again. | [Journaled steps](./demo/core.ts) |
| Stop at the decision boundary | **Dynamic workflow + human:** `ctx.pause` | The workflow can be correct without being authorized to continue. Review happens before the local draft is approved. | [Terminal checkpoint](./native/Run-Sdk.mjs) |
| Explain execution to the audience | **Observer UI**, not an agent | The graph shows actual events, why a branch appeared, and what must happen next. Check inspection exposes the numbers behind a failure. | [Browser UI](./demo/browser.ts) |

**What makes it dynamic?** The author defines the rules in code, but inputs and findings change the path through those rules. A model does **not** invent or rewrite the orchestration program during this demo.

**What makes it agentic?** In native live mode, actual Copilot agents interpret evidence and independently challenge the result. The offline fallback substitutes ordinary JavaScript workers and says so explicitly.

### Dynamic workflows are not GitHub Agentic Workflows

| Capability | Used in this repository? | Role |
|---|---|---|
| **Copilot dynamic workflows** | **Yes, in both native modes.** | Local code-defined orchestration in the Copilot CLI/app/SDK ecosystem. |
| **Agentic work / model reasoning** | **Yes, in native live mode.** | Workflow-owned specialists and an independent reviewer. |
| **GitHub Agentic Workflows (`gh-aw`)** | **Research and presentation only; not executed.** | A separate tool that compiles Markdown with YAML frontmatter into GitHub Actions workflows. |
| **`/fleet`** | **Not used by this demo.** | Copilot chooses how to decompose a goal into subagent tasks; this demo's process is defined in code. |
| **Autopilot** | **Not required to run the demo.** | Controls agent autonomy, not the workflow's stages, permissions, or correctness. |

For repository-level triage, CI investigation, or other recurring reasoning on Actions, see [GitHub Agentic Workflows](https://github.github.com/gh-aw/). Keep deterministic builds and tests deterministic. This repository does not install, run, or deploy an Actions-based agentic workflow.

## Choose the right execution mode

| Mode | Dynamic-workflow runtime? | Model calls? | Best for |
|---|---|---|---|
| **Offline rehearsal** | **No.** Local JavaScript runner. | **No.** | A dependable presentation without sign-in or Wi-Fi. |
| **Native rehearsal** | **Yes.** Actual Copilot runtime. | **No.** | Checking registration, journals, checkpoints, and resume before a live session. |
| **Native live** | **Yes.** Actual Copilot runtime. | **Yes.** | Showing real agent reasoning and independent review, subject to availability and AI-credit usage. |

The native observer labels completed runs as completed. A previous result is not presented as a currently running model performance.

### The native agent team

| Role | Model | Reasoning | Boundary |
|---|---|---|---|
| Evidence analysis and bounded repair | **GPT-6.1 Sol** | **max** | Supplied evidence only; `tools: []`. |
| Independent challenge | **Claude Sonnet 5.5** | **high** | Supplied candidate and checks only; `tools: []`. |

The extension checks the **actual requested and resolved model** before accepting a result. An unavailable model, missing result, malformed explanation, or reviewer rejection holds the run; no silent Auto fallback is allowed.

The pinned SDK is **1.0.19**, with runtime **1.0.95**. Use the version-matched SDK runner for the checkpoint demonstration. Do not assume that independently installed CLI and SDK versions share session-storage formats.

## Presenter kit

Designed for a **2,500-person audience**, with an approximately 25-minute talk and a 6-8-minute demo segment.

| Resource | What you get |
|---|---|
| [PowerPoint](./Launch-Rescue.pptx) | 21 main-story slides, 5 hidden reference slides, speaker notes, timings, and citations. |
| [PDF backup](./Launch-Rescue.pdf) | The 21-page main story for presenting without PowerPoint. |
| [Portable stage kit](https://github.com/msftnadavbh/workflows/raw/refs/heads/main/Launch-Rescue-Stage-Kit.zip) | Presentation, standalone HTML, native extension, sources, evidence, and runbook. |
| [Presenter runbook](./Presenter-Runbook.md) | Audience vote, exact expected counts, live cues, approval boundaries, and recovery paths. |
| [Feature investigation](./Feature-Research.md) | Verified feature distinctions, preview caveats, and lessons discovered during actual live runs. |
| [Primary-source inventory](./sources/research.json) | 20 official GitHub, SDK, and VS Code sources supporting the presentation. |

Use a **1920x1080** viewport. The customer layout keeps the feature definitions visible and places the graph beside its execution details without a stage toggle. During checkpoints, the decision is the focus; measured outcomes return for final review. Runtime setup is documented here and in the runbook, not displayed to customers. Smaller screens remain operable by scrolling.

The shared launcher is **`npm run launch`**. It starts a local observer on **4173**, checks that `/health` belongs to the child it started, and only then opens the default browser. It refuses a foreign server and stops only its own child on interruption.

```sh
npm run launch -- --port 4180 --no-browser
```

Use the printed URL for a custom port; append `&execution=copilot` to observe native runs. The Windows-only `.\Launch-Demo.ps1 -Port 4180 -NoBrowser` remains compatible and retains its existing readiness and cleanup behavior.

## Explore the implementation

| Path | Responsibility |
|---|---|
| [`demo/core.ts`](./demo/core.ts) | Shared scenario logic, evidence routing, bounded repairs, immutable snapshots, and checks. |
| [`native/extension.ts`](./native/extension.ts) | Registers the actual Copilot dynamic workflow and verifies model resolution. |
| [`native/Run-Sdk.mjs`](./native/Run-Sdk.mjs) | Hosts the pinned runtime, loads scoped agents, and owns the terminal checkpoint. |
| [`native/cost.mjs`](./native/cost.mjs) | Reads runtime usage after each run and writes the per-model cost table to `runs/RUN_ID/cost.json`. |
| [`demo/browser.ts`](./demo/browser.ts) | Runs offline rehearsal and observes native progress without authorizing it. |
| [`native/reconcile.ts`](./native/reconcile.ts) | Combines progress and lifecycle records without letting stale writes undo HOLD or resumed work. |
| [`scripts/launch.mjs`](./scripts/launch.mjs) | Shared Windows/macOS launcher with owned-child readiness, default-browser opening, and interruption cleanup. |
| [`scripts/browser-runtime.mjs`](./scripts/browser-runtime.mjs) | Shared explicit browser selection; no fallback after a browser launch failure. |
| [`tests`](./tests) | Regression coverage for calculations, branches, recovery, polling, packaging, and launchers. |
| [`.github/github-app.yml`](./.github/github-app.yml) | Copilot app project instructions and manual demo/test scripts; not a scheduled workflow. |
| [`.github/workflows/platform-tests.yml`](./.github/workflows/platform-tests.yml) | Deterministic Windows x64 and Mac arm64/x64 checks; no Copilot credentials or model calls. |

The compiled extension is included at [`.github/extensions/launch-rescue/extension.mjs`](./.github/extensions/launch-rescue/extension.mjs). The Windows CLI alternative is documented in the [runbook](./Presenter-Runbook.md); prefer the SDK path for the live checkpoint.

## Development and verification

Install dependencies with `npm ci`. Local regression tests require Python; provision the platform's browser as described above.

| Command | Coverage | Makes model calls? |
|---|---|---|
| `npm run build` | Rebuilds the standalone HTML and native extension. | No |
| `npm run typecheck` | Strict TypeScript checks against the actual SDK types. | No |
| `npm run check:platform -- --platform darwin --arch arm64` | Asserts actual runner architecture and matching SDK package; use `x64` on Intel and `win32` on Windows. | No |
| `npm test` | Calculations, routing, recovery, lifecycle races, terminal input, server, and package regressions. | No |
| `npm run test:browser` | Scenario completion, normal-speed narration, keyboard use, reload, native observer states, and stage fit. | No |
| `npm run verify:native` | Actual native-runtime checkpoint and same-run resume. Requires eligible authentication. | No |
| `npm run verify:live` | Actual configured models, independent review, and reuse of completed agent work. | **Yes** |
| `npm run test:native-e2e` | Real agents through an actual browser observer, evidence download, terminal approval, and resume. | **Yes** |
| `npm run verify:deck` | PowerPoint structure, references, notes, and bounds. | No |
| `npm run package:stage` | Packages the kit only when native proof hashes match the current build. | No |

For browser-observed native E2E without model calls:

```powershell
node scripts/rehearse-native.mjs --walkthrough
```

To rebuild the presentation, run `npm run deck`. **Optional PowerPoint COM rendering and PDF export are Windows-only**, requiring installed PowerPoint, `pythoncom`, `win32com`, and Pillow. They are not part of Mac tests or prerequisites:

```powershell
node scripts/run-python.mjs scripts/render-slides.py Launch-Rescue.pptx
```

Actual execution evidence is included in [`evidence/native-live-proof.json`](./evidence/native-live-proof.json), [`evidence/native-runtime-proof.json`](./evidence/native-runtime-proof.json), and [`evidence/browser-native-live-e2e.json`](./evidence/browser-native-live-e2e.json). Proofs identify the tested build with SHA-256 fingerprints; packaging rejects stale proofs and excludes private session caches.

Browser tests write screenshots into their test-output directory by default. Set `LAUNCH_RESCUE_CAPTURE_ARTIFACTS=1` only for the coordinated final screenshot capture. When multiple sessions are working, designate one owner for presentation generation, native proofs, screenshots, and the stage ZIP; do not run paid live verification without separate approval. The presentation-source command update and final artifact refresh remain with that coordinated owner.

## Safety and limitations

- **Synthetic, local-only task.** No real tickets, purchases, messages, deployments, or remote repository changes are performed by the demo.
- **Bounded agent output.** Agents propose permitted repair choices; the workflow never executes generated code. Separate semantic validation supplements the SDK's structural output checks.
- **Explicit approval.** Native checkpoints resume only in their owning host. The browser is a read-only observer; the standalone browser approval applies only to the offline draft.
- **Review extension code before trusting it.** `tools: []` restricts the agent, not arbitrary JavaScript in an extension. The local server exposes no execution or write endpoints.
- **Availability is not guaranteed.** Public-preview APIs, plan eligibility, organization policy, authentication, and model access can change. AI-credit limits are approximate, not a hard cost ceiling.

For a quick answer or a small change, a normal Copilot prompt may be enough. Use a dynamic workflow when the **process itself** needs repeatable stages, evidence-driven branches, durable results, or a clear human decision boundary.

## Documentation and feedback

[Dynamic workflow concepts](https://docs.github.com/en/copilot/concepts/agents/dynamic-workflows) &middot;
[Create, run, and resume workflows](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-dynamic-workflows) &middot;
[SDK workflow API](https://github.com/github/copilot-sdk/blob/v1.0.19/nodejs/docs/workflows.md)

Found a problem? [Open an issue](https://github.com/msftnadavbh/workflows/issues) with the scenario, execution mode, operating system, Node/runtime versions, expected result, and sanitized error. Do not attach tokens, credentials, or unrelated session logs.
