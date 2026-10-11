# Feature investigation: agentic is not one feature

**Checked 10 October 2026 against 20 primary sources, the official SDK, and the installed Copilot CLI.** Source IDs below resolve to clickable URLs in `sources\research.json` and the presentation's speaker notes. Local observations are not claims about every Copilot installation.

## The distinction the talk must teach

| Capability | Who controls the process? | Where it runs | What it is not |
|---|---|---|---|
| Agentic work / agent mode | An agent selects tools and iterates against a goal | Applicable Copilot client | A guarantee of correct output |
| Autopilot | The agent keeps progressing without a prompt at every step | CLI / app | Permission to do anything |
| `/fleet` | Copilot decomposes the goal and coordinates subagents | CLI, including app-backed sessions where supported | A predefined durable process |
| Custom agent | A profile specifies expertise, tools, and optionally a model | Client-dependent | A workflow engine |
| Dynamic workflow | Author-written code specifies stages, conditions, handoffs, and agent calls | Copilot CLI, app, SDK | An Actions YAML workflow |
| GitHub Agentic Workflows (`gh-aw`) | Markdown instructions plus compiled configuration | GitHub Actions | The local Copilot dynamic-workflow runtime |
| Automation | A saved trigger starts a recurring or on-demand task | Local or cloud, subject to policy | An assurance that the task uses a dynamic workflow |

Evidence: S1, S6-S11, S13-S14, S18.

## Verified dynamic-workflow behavior

Dynamic workflows are **public preview**. Availability depends on the client, experimental feature flag, authentication, billing model, organization policy, and available models. The official concepts page excludes Pro / Pro+ customers who remain on certain legacy annual premium-request plans. Do not promise universal access. S1-S2.

The definition is an extension with `defineWorkflow(...)` and `joinSession({ workflows: [...] })`. Repository extensions live beneath `.github\extensions\<name>\extension.mjs`; the CLI supplies its SDK to the extension process. The delivered native extension uses this actual API, not an imitation. S3-S4.

The API supports agent calls, parallel barriers, streaming pipelines, named phases, progress logs, JSON-journaled steps, cooperative cancellation, durable pause checkpoints, and resume. **Nested workflows are not supported.** Workflow-owned agents are observed through workflow APIs, not the normal `read_agent` / `write_agent` tools. S3.

Important engineering details discovered in the SDK documentation:

- `ctx.agent` ordinary failures return `null`. Cancellation, credit/time limits, and hard runtime failures reject. A missing answer must stop the release gate, not become an empty successful review.
- Structured output checks a **subset** of JSON Schema. Numeric ranges, string patterns, and `additionalProperties` are not enforced. This demo performs separate semantic checks.
- Identical prompt/options calls are memoized. Distinct specialist labels are needed for independent work.
- `ctx.phase` is run-global. Do not call it from competing parallel branches.
- `ctx.step` uses its key as the sole journal identity. Version keys and keep side effects idempotent: recovery is best-effort at-least-once, not exactly-once.
- Resume restarts the workflow body and reuses saved steps. Unsaved work can execute again.
- A concurrent-agent cap queues work; it does not fail the run. Other limits can stop a run. AI-credit limits are approximate and can overshoot because usage is recorded after work.
- Pausing at a checkpoint and cancelling are different. Cancelled runs cannot resume.

Evidence: S1-S3.

## What permissions do, and do not, protect

Subagents inherit the session's tool grants. Direct `copilot workflow run` does not show approval prompts: pre-authorize only necessary tools. Trusting extension code is a separate boundary. An extension can execute JavaScript outside the subagent permission prompts. Neither a prompt nor an agent profile is a security sandbox. S1-S5.

The delivered extension requests no sensitive environment variables. Its analysts have `tools: []`, receive only synthetic evidence in their prompts, and return a choice from a bounded repair vocabulary. The workflow never evaluates generated code. Its own code writes only demonstration artifacts under `runs\`.

The approval checkpoint approves **a local synthetic draft**. It does not deploy an application, reserve real tickets, charge a card, send a message, or change a remote repository.

## The native CLI contract

Local CLI observed: **1.0.94-3**. Read-only `copilot workflow --help` and `copilot workflow run --help` confirm the direct command, JSON input, result-file output, and JSONL output mode.

Local compatibility finding: adding `--no-auto-update` selected the older bundled CLI **1.0.80**, which did not recognize workflow arguments. The delivered launcher deliberately does not use that flag. Record and preflight the active CLI version; do not assume a wrapper's bundled runtime supports the active runtime's preview APIs.

The version-matched SDK host is the preferred stage route:

```powershell
node native\Run-Sdk.mjs --live --pause
```

SDK **1.0.19** supplies runtime **1.0.95**. Standalone extension hosting requires an explicit launch provider and SDK injection path. The delivered provider launches only the exact `project:launch-rescue` entrypoint, using the official bootstrap, and defines its two custom agents explicitly with no tools. It does not enable other discovered extensions. S19-S20.

Keep that SDK terminal open at the checkpoint. Type `APPROVE` there after reviewing the synthetic draft. Browser-native observation is read-only and never resumes the workflow. The app/CLI and SDK can use different persisted-session representations; an owning session ID is not evidence of cross-runtime interoperability. The external CLI launcher remains available, but its post-exit resume suggestion must be preflighted in the same client/runtime. The reliable demonstrated path pauses and resumes within the version-matched SDK host.

Run:

```powershell
copilot --experimental workflow run launch-rescue --args @native\inputs\mixed-live.json
```

Repository extension code must be trusted. For a reviewed script invocation, `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true` opts in for that process only; it is not a tool grant. Do not set this globally for arbitrary repositories. S5.

Check the command's exit status and run envelope. `--result-file` is written only for a successfully completed run that returns a result. Failed or paused runs can leave an older result file intact. The launcher uses a fresh output path rather than treating a stale file as success. S5.

Observe local runs with `/workflows` or the app's **Workflows** panel. App monitoring is documented only for local sessions. Copying an extension to another repository shares the definition, not the run history. S2.

## Model configuration: no silent substitution

User-directed routing:

| Work | Requested replacement | Actual native call options |
|---|---|---|
| Evidence analysis / bounded repair | GPT-6.1 Sol, max | `model: "gpt-6.1-sol"`, `reasoningEffort: "max"` |
| Independent challenge | Claude Sonnet 5.5, high | `model: "claude-sonnet-5.5"`, `reasoningEffort: "high"` |

The native workflow supplies model and effort explicitly on `ctx.agent` calls. A blocked or unavailable model is an error, not permission to substitute Auto. SDK option syntax is verified in S3. Profiles also record the requested routing.

**Preflight caveat:** CLI personal custom agents take precedence over same-ID repository profiles (S9). Use the supplied uniquely named `launch-analyst` and `launch-reviewer` profiles and inspect `/env` before going on stage. Model selection and tool restrictions must be checked in the actual client, not assumed from a cloud-agent article (S9-S10).

The native extension checks the **actual requested and resolved model** in workflow observability before it accepts a model result. It examines the latest completed attempt for that label, so an earlier failed admission cannot incorrectly invalidate a successful retry. S3.

## GitHub Agentic Workflows: the separate follow-on

`gh-aw` compiles Markdown with YAML frontmatter into a `.lock.yml` workflow executed by GitHub Actions. Triggers, permissions, tools, and engine selection are configuration; the body describes the reasoning task. Keep deterministic tests and builds in conventional Actions. S13-S14.

The supported agent-job path defaults to read-only access and sandboxing. Configured `safe-outputs` are processed by scoped jobs. These controls are configurable, so review generated permissions and network settings; **safe output does not mean correct output**. S15-S16.

Release observed during research: `gh-aw` **0.89.21**; SDK **1.0.19**. Public repository releases and documentation can change. The talk labels Copilot dynamic workflows as preview, but does not infer the current maturity of every `gh-aw` feature from an older launch announcement.

## Honest demonstration modes

**Standalone execution:** ordinary JavaScript workers execute real allocation logic and contract checks over synthetic data. No model calls, no AI credits, no claimed Copilot subagents. Customer-facing steps use concise **JAVASCRIPT**, **CODE / REPAIR**, and **CODE / REVIEW** labels rather than rehearsal banners.

**Native rehearsal:** the same logic executes inside the actual Copilot dynamic-workflow runtime without calling a model. This verifies registration, argument passing, phases, durable steps, and result handling without paying for reasoning.

**Native live:** actual workflow-owned Copilot agents propose bounded repairs and a different model independently challenges the evidence. Deterministic checks still decide correctness. Live model execution requires eligible authentication and consumes AI credits.

All modes use a visible graph driven by emitted execution events. Scenario selection and observed evidence change which specialist nodes exist. The mixed scenario introduces a synthetic room-capacity change **after** the first plan; the failed check causes a new specialist and a second verification pass.

## A live-rehearsal finding: preserve evidence provenance

An actual Sonnet review caught a stale-context problem: the first analyst saw an inventory surplus of zero, the inventory then changed by 200 seats, and an unversioned reviewer prompt put the earlier rationale beside the later facts. A correct historical observation looked like a contradiction.

The fix did not weaken review. Each specialist now receives only its own evidence, and every repair records its observation round and an immutable evidence snapshot. The reviewer checks historical statements against those snapshots and the final policy against current facts. Execution events also retain their original snapshots. The journal namespace was versioned to avoid replaying incompatible saved results.

The completed native evidence is in `evidence\native-live-proof.json` and `evidence\native-runtime-proof.json`: actual model resolution, the changed-input branch, measured checks, the durable checkpoint, and same-run resume without new model agents. These are local rehearsal observations, not production benchmarks or guarantees of future model output.

The stage kit now binds these proofs to the tested native source and bundle hashes. Native progress and lifecycle outcomes have separate writers: per-attempt outcome records and a host-close marker prevent a stale reconcile from undoing HOLD or replacing resumed progress. The browser observes actual host liveness, serializes polling, rejects older snapshots, and never presents a finished draft-only run as an open approval gate.

## Making the two features visible

The default **Step by step** flow pauses at routing, specialist explanation, adaptation, verification, and independent review. Each proof is emitted by the executing workflow and contains its relevant code excerpt, input, output, and benefit. Actual model handoffs include the exact supplied prompt, validated response, requested model/effort, and whether a saved result was reused. The customer view contains no presenter cues, runtime picker, stage toggle, command panel, or rehearsal wording.

In native mode, `--walkthrough` uses durable `ctx.pause` checkpoints. **NEXT** resumes the same run to the next decision; it is not accepted as final approval. Only the separate final **APPROVE** checkpoint approves the synthetic local draft. These operator instructions stay in the terminal and documentation. The standalone view uses JavaScript checkpoints, labels code execution accurately, and does not display hypothetical model prompts.

The visible phrase **Agentic Workflow** describes model reasoning inside this local Copilot process, not an executed `gh-aw` workflow. The model explains and challenges bounded actions; code still defines orchestration and verifies outcomes. No claim is made that agents rewrite the workflow at runtime. S1-S3.

## Claims deliberately excluded

No "2,500 parallel agents." No guaranteed speedup, token savings, cost ceiling, or production capacity benchmark. No fabricated customer results. No claim that models are deterministic. No universal cross-client feature parity. No claim that a UI checkpoint or `tools: []` contains arbitrary extension code. No implicit deployment, remote writes, or ticket purchases.
