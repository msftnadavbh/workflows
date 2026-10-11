# Launch Rescue — presenter runbook

**Assumed slot: 25 minutes, including a 6–8-minute demonstration and questions. Audience: 2,500 developers and engineering leaders.**

## The promise

“Today this room will choose what breaks. We won't choose the agents first; the evidence will.”

The audience should leave with three distinctions: **autopilot is autonomy, fleet is model-chosen delegation, and a dynamic workflow is a process defined in code.** GitHub Agentic Workflows on Actions is a separate tool.

## Before the venue session

1. Keep `Launch-Rescue.pptx`, the PDF, and `Launch-Rescue-Demo.html` on the presentation machine. The five appendix slides are hidden during the main slide show.
2. Open the standalone HTML once. Use a **1920×1080** projector viewport, **Stage view**, **dark theme**, and **Normal** pacing. Test **Run rescue**, **Pause**, resume, and **Approve local draft**. Use **New run** to return to a clean state. Smaller viewports require scrolling.
3. If demonstrating real agents, run `npm ci` before the event. Check Copilot authentication, preview eligibility, and model availability. Do not depend on venue Wi-Fi for installation.
4. Start `node demo\server.mjs` in a dedicated terminal and open `http://127.0.0.1:4173/?scoutTheme=dark`. Keep a second terminal ready for the SDK runner.
5. Rehearse `node native\Run-Sdk.mjs --rehearsal --pause`. At the checkpoint, type `APPROVE` in that same terminal. This exercises the actual Copilot runtime without paying for model calls.
6. If credits and connectivity permit, preflight the live path once. Use the exact requested models: **GPT-6.1 Sol / max** and **Sonnet 5.5 / high**. No Auto substitution is configured.

Do not open account details, tokens, environment dumps, or unrelated sessions on the projector. The demo uses only synthetic evidence.

## Talk map

| Time | Slides | What to establish |
|---|---|---|
| 0:00–2:20 | 1–3 | One mission, a broken launch, and a feedback loop. |
| 2:20–4:30 | 4–5 | Autopilot vs fleet vs dynamic workflows; local runtime vs gh-aw on Actions. |
| 4:30–7:00 | 6–8 | Code owns repeatable steps; agents handle judgment; results need contracts. |
| 7:00–14:20 | 9–15 + demo | Audience choice, real evidence, surprise, new branch, checks, independent challenge, human checkpoint. |
| 14:20–19:00 | 16–20 | Honest modes, permission boundaries, reuse, adoption, and the separate Actions follow-on. |
| 19:00–20:00 | 21 | Close: “Give agents a goal. Give workflows a contract.” |
| 20:00–25:00 | Questions | Use hidden reference slides 22–26 as needed. |

The main notes contain exact source URLs and suggested wording. Spend less time on the diagrams if the live model run takes longer than the rehearsal.

## Audience interaction

Ask for a show of hands:

> “Retry storm? Room switch? Both at once? Or should I surprise you?”

This is a genuine presenter-operated vote. There is no fictional online poll or 2,500-client backend.

Use **Both at once** to show independent specialist branches. Use **Surprise me** for the strongest narrative: a new fact arrives after planning. In native SDK mode, choose with `--scenario parallel` or `--scenario mixed`; the browser is an observer, not a model-launch control.

## Live sequence

| Beat | Action | Say |
|---|---|---|
| Establish the mode | Point at the mode strip before starting. | “This is [offline rehearsal / native rehearsal / native live]. Here's exactly what executes.” |
| Reproduce | Start the chosen incident. Pause if you want to explain the first graph. | “These are measured synthetic outcomes, not an agent guessing the answer.” |
| Diagnose | Point at the two code probes. | “Independent evidence collection can run in parallel. The findings decide who joins.” |
| Route | Highlight the specialist node that appears. | “We did not launch every specialist just because we could.” |
| Surprise | For `mixed`, show the 200-seat inventory change. | “The first plan was built against old facts. The input changed—not the prompt.” |
| Adapt | Point at the failed check, re-audit node, new capacity specialist, and second verification. | “Keep the good retry repair. Add only the work the new evidence requires.” |
| Challenge | Inspect the independent-review node. | “A different model challenges the evidence. Code still determines whether the contracts pass.” |
| Gate | Stop at the human checkpoint. | “Passing tests is not permission to deploy. This approval is only a synthetic local draft.” |
| Resume | Offline: approve in the browser. Native SDK: type `APPROVE` in its running terminal. | “The same run continues using saved results. We don't repeat completed model work.” |
| Evidence | Download the JSON report if useful, then return to slide 15. | “Zero duplicates. Zero oversold seats. Nobody disappears.” |

Keyboard shortcuts for offline rehearsal: **S** run/resume, **P** pause, **V** stage view. They are inactive while editing a field. Presentation pacing deliberately adds delays; do not present it as a latency measurement.

The sentence above the graph states the current cause and next step. Select **Acceptance checks** to show the actual failed capacity count, not just its status. Select **Re-run acceptance checks** to contrast the passing result. In native mode, **Show run command** restores setup instructions if an earlier run is already on screen.

## Exact expected outcomes

| Incident | Baseline duplicate outcomes | Baseline seats over capacity | Final unique confirmations | Final waitlist | Specialist path |
|---|---:|---:|---:|---:|---|
| Retry storm | 500 | 500 | 2,500 | 0 | Retry specialist |
| Room switch | 0 | 200 | 2,300 | 200 | Capacity specialist |
| Both at once | 500 | 700 | 2,300 | 200 | Retry and capacity specialists in parallel |
| Surprise me | 500 | 500 | 2,300 | 200 | Retry specialist, changed inventory, failed check, then capacity specialist |

Every successful final candidate has **0 duplicate outcomes, 0 seats over capacity, and 0 missing attendees**. In the surprise run, the first repaired candidate fails the changed-inventory check by exactly **200 seats**.

Why the surprise baseline shows 500, not 200: retries initially produce 3,000 allocations against 2,500 seats. After deduplication, the later room change removes another 200 seats. Those are different observation rounds.

## The real native command

```powershell
node native\Run-Sdk.mjs --live --pause --scenario mixed
```

The runner uses SDK 1.0.19 and its runtime 1.0.95. Its extension launch provider is restricted to this project's exact entrypoint. The two agents have no tools, and the extension verifies their actual resolved models before accepting results.

At the checkpoint, review in the browser, then type **`APPROVE` in the same SDK terminal**. Commands are case-insensitive. A blank line or typo keeps the checkpoint open and asks again; only **`HOLD`** deliberately ends the host without approval. EOF or terminal interruption does not approve the draft. The browser detects a closed SDK host and directs you to start a new run, not to approve in a vanished terminal.

For an extension run created inside a local Copilot app/CLI session, use that owning session's **Workflows** panel instead. A separately launched CLI workflow belongs to its own session. Do not assume CLI and SDK sessions are interchangeable.

## A useful engineering lesson from the live rehearsal

Sonnet initially rejected an otherwise passing candidate because an earlier rationale was placed next to later inventory data without provenance.

The fix was **not** to tell the reviewer to approve. Each specialist now receives only its own evidence and each repair carries its observation round and immutable snapshot. The reviewer judges historical claims against those snapshots and the final candidate against current facts.

If asked “what makes this agentic rather than animated?” show the source and native evidence. The graph follows execution events. Actual live agents produce structured choices and explanations; real code applies bounded policies and runs the checks. The offline fallback is explicitly JavaScript, not AI.

## Recovery card

| Symptom | Recovery |
|---|---|
| Wi-Fi, sign-in, plan eligibility, or model failure | Switch to **Offline rehearsal**. Say: “Real checks, no LLM calls.” Start a new local run. |
| Reviewer holds the candidate | Respect the gate. Inspect its rationale; use the offline lesson if time is limited. Never force approval or silently replace the model. |
| Workflow not found | Check experimental access, the reviewed extension, and SDK dependencies. Use the version-matched SDK runner rather than improvising a client switch. |
| CLI says unknown `--args` | Check the active version. On this machine, `--no-auto-update` selected an older 1.0.80 runtime. The CLI launcher deliberately omits it. |
| Native checkpoint seems stuck | The SDK terminal is waiting for your review. Type `APPROVE` there, not in the browser. |
| Native view says held / host closed | The SDK terminal has ended. Start a new run; a completed draft-only run has no approval gate to resume. |
| Port 4173 is occupied | Use another port. Do not terminate other users' processes by name. |
| PowerShell policy blocks the launcher | Use `node demo\server.mjs`; do not weaken system settings. |
| Need to recover offline after reload | The browser restores the same local journal. Resume it or choose **New run**. |

## Claims to avoid

No “2,500 parallel agents,” guaranteed speedup, hard credit ceiling, production throughput, real ticket sales, or universal cross-client parity. `tools: []` is not a sandbox for arbitrary extension code. Dynamic workflows are public preview. A completed native result is not a currently running model performance.

## Closing line

> “The next level is not a longer prompt. It's a process that can explain its evidence, survive a failed check, and stop at the right boundary.”
