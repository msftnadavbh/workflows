# Launch Rescue

**A stage-ready GitHub Copilot demo and 26-slide presentation for a 2,500-person audience.**

The audience chooses a synthetic ticket-launch failure. Real checks decide which specialists join. In the surprise scenario, room inventory changes after the first plan; a failed check adds a new specialist. An independent review and a human checkpoint gate the local draft.

## Get the demo

```powershell
git clone https://github.com/msftnadavbh/workflows.git
Set-Location workflows
```

The presentation, standalone demo, and portable stage kit are included in the repository. Open `Launch-Rescue-Demo.html` directly for the offline experience. Native execution, rebuilding, and tests require the dependencies described below.

## Open the demo

Open **`Launch-Rescue-Demo.html`** in Edge, Chrome, or another modern browser. Everything needed for **offline rehearsal** is inside that file. No installation, sign-in, server, or model calls are required.

For the local native-run observer:

```powershell
node demo\server.mjs
```

Open **http://127.0.0.1:4173/?scoutTheme=dark**. The server is read-only and bound to the loopback interface.

On Windows, `.\Launch-Demo.ps1` starts the server, verifies that the health response belongs to its own child process, then opens the browser. It preserves your working directory and prior `DEMO_PORT` value. `-NoBrowser` skips opening a tab. If the port is occupied, use `.\Launch-Demo.ps1 -Port 4180`. Do not change system script policies just for this demo; the direct Node command works without the PowerShell launcher.

## Run real Copilot agents

Requires Node.js **22.12+**, eligible Copilot authentication, dynamic-workflow preview access, and the requested models. Live runs consume AI credits.

```powershell
npm ci
node native\Run-Sdk.mjs --live --pause
```

Select **Native Copilot** in the browser. The SDK runner uses its version-matched runtime, explicit no-tool agent profiles, and the actual Copilot dynamic-workflow API.

At the checkpoint, review the evidence and type **`APPROVE` in the running SDK terminal**. Commands are case-insensitive; blank lines and typos re-prompt without losing the run. Only **`HOLD`** deliberately closes the host without approval. EOF or interruption also ends the checkpoint without approving it. Start a new run after the host closes. The browser cannot resume native work, and nothing is deployed.

To choose another incident:

```powershell
node native\Run-Sdk.mjs --live --pause --scenario parallel
```

Scenarios: `retries`, `capacity`, `parallel`, and `mixed`. The default is `mixed`.

For a native runtime run **without** model calls:

```powershell
node native\Run-Sdk.mjs --rehearsal --pause
```

Omit `--pause` for a draft-only programmatic run. That does not claim human approval.

## Three modes, clearly labeled

| Mode | What actually executes |
|---|---|
| Offline rehearsal | Local JavaScript workers, real allocation logic, real contract checks. No LLM. |
| Native rehearsal | Actual Copilot workflow runtime, journaled steps and checkpoints, JavaScript workers. No LLM. |
| Native live | Actual workflow-owned agents: GPT-6.1 Sol / max, then Sonnet 5.5 / high for independent challenge. |

The native observer explicitly labels completed and stopped runs. A completed draft-only run never invites approval, and an SDK host that has exited is no longer shown as actionable. Polls do not overlap or apply older snapshots. A completed result is not presented as a currently running model performance.

Use **Stage view at 1920×1080** for the large-room demo. The sentence above the graph explains what changed; selecting a check shows its measured pass/fail results. **Show run command** opens the native instructions even when an earlier completed run is displayed. Smaller displays remain operable by scrolling.

## Included

| File | Purpose |
|---|---|
| `Launch-Rescue.pptx` | 21-slide main story plus 5 hidden reference slides; speaker notes, timings, and citations. |
| `Launch-Rescue.pdf` | 21-page main-story backup; reference slides remain in the PowerPoint. |
| `Presenter-Runbook.md` | Audience interaction, live cues, exact counts, launch sequence, and recovery plan. |
| `Feature-Research.md` | Heavily investigated feature boundaries and engineering caveats. |
| `sources\research.json` | 20 primary-source citations. |
| `evidence\native-live-proof.json` | Actual model resolution, changed-input checks, checkpoint, and same-run resume with no extra agents. |
| `.github\extensions\launch-rescue\extension.mjs` | Compiled native Copilot extension. |

The Windows CLI launcher is also available:

```powershell
.\native\Run-Native.ps1 -Mode Rehearsal
```

Prefer the SDK runner for the stage checkpoint demonstration. The installed CLI wrapper, active CLI, and SDK can select different runtimes and session-storage representations. Do not mix them when resuming. A run created directly in a local app/CLI session belongs to that session's **Workflows** view.

## Rebuild

```powershell
npm run build
npm run typecheck
npm test
npm run test:browser
npm run deck
```

Browser checks use installed Microsoft Edge. Rendering slides uses installed PowerPoint plus Python's `pythoncom`, `win32com`, and Pillow; it is optional for using the delivered files:

```powershell
python scripts\render-slides.py Launch-Rescue.pptx
npm run verify:deck
```

`npm run verify:native` checks the actual runtime without model calls. **`npm run verify:live` makes actual model calls** and consumes credits. Both proofs record SHA-256 fingerprints of the tested native sources and compiled outputs. `npm run package:stage` refuses stale proofs and excludes private session caches.

**`npm run test:native-e2e`** rehearses real model execution through an actual Edge browser observer: failed-check inspection, evidence download, terminal approval, and same-run resume. It consumes AI credits. For the same end-to-end browser rehearsal without model calls, run `node scripts\rehearse-native.mjs`.

Lifecycle observations are kept separately from `runs\RUN_ID\state.json`, which is written only by the extension. Per-attempt outcome records and an irreversible host-close marker are merged by the read-only observer, so concurrent reconciliation cannot overwrite progress or undo HOLD.

## Boundaries

All people, ticket requests, rooms, and operational data are synthetic. Models return bounded choices, not executable code. The local server exposes no execution or write endpoints. No deployment, purchases, messages, real tickets, or remote repository changes occur.

`tools: []` constrains agents; it does not sandbox arbitrary extension code. Review the extension before trusting it. Dynamic workflows are public preview and client, plan, policy, API, and model availability may change.
