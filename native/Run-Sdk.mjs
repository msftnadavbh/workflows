import { stdin } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { ANALYST, REVIEWER, isWalkthroughCheckpoint, validateArgs } from "../dist/core.mjs";
import { reconcileNativeRun } from "../dist/reconcile.mjs";
import { promptCheckpoint } from "./checkpoint.mjs";
import { recordRunCost } from "./cost.mjs";

const root = fileURLToPath(new URL("..\\", import.meta.url));

export async function withNativeSession(run) {
  const runtimePackage = `@github/copilot-sdk-${process.platform}-${process.arch}`;
  const runtimeDirectory = dirname(fileURLToPath(import.meta.resolve(`${runtimePackage}/package.json`)));
  const sdkDirectory = dirname(fileURLToPath(import.meta.resolve("@github/copilot-sdk")));
  const entrypoint = join(root, ".github", "extensions", "launch-rescue", "extension.mjs");
  const customAgents = await Promise.all([ANALYST, REVIEWER].map(async (route) => {
    const source = await readFile(join(root, ".github", "agents", `${route.agent}.agent.md`), "utf8");
    const profile = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/);
    if (!profile || !/^tools:\s*\[\]\s*$/m.test(profile[1]) || !profile[2].trim()) {
      throw new Error(`Invalid ${route.agent} profile. The SDK demo requires tools: [] and a nonempty prompt.`);
    }
    return {
      name: route.agent, description: `Bounded synthetic launch ${route.agent}`,
      prompt: profile[2].trim(), tools: [], infer: false, model: route.model, reasoningEffort: route.reasoningEffort,
    };
  }));
  const client = new CopilotClient({
    connection: RuntimeConnection.forStdio(),
    workingDirectory: root,
    logLevel: "error",
    env: { ...process.env, GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS: "true", LAUNCH_RESCUE_HOST: "sdk",
      LAUNCH_RESCUE_HOST_PID: String(process.pid) },
    extensionLaunchProvider: {
      resolve: async (request) => {
        if (request.id !== "project:launch-rescue" || request.source !== "project"
            || resolve(request.modulePath).toLowerCase() !== resolve(entrypoint).toLowerCase()) return {};
        return {
          launch: {
            executable: process.execPath,
            args: [join(runtimeDirectory, "preloads", "extension_bootstrap.mjs")],
            env: { COPILOT_CLI_DIST_DIR: runtimeDirectory, EXTENSION_PATH: entrypoint },
          },
        };
      },
    },
  });
  try {
    await client.start();
    const runtime = await client.getStatus();
    const session = await client.createSession({
      model: "gpt-6.1-sol",
      reasoningEffort: "max",
      enableExperimentalMode: true,
      workingDirectory: root,
      configDirectory: root,
      enableConfigDiscovery: true,
      requestExtensions: true,
      extensionSdkPath: sdkDirectory,
      customAgents,
      availableTools: [],
      onPermissionRequest: async () => ({ kind: "denied-no-approval-rule-or-hook" }),
    });
    return await run({ client, session, runtime });
  } finally {
    const errors = await client.stop();
    if (errors.length) throw new AggregateError(errors, "Native SDK runner cleanup failed.");
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    live: { type: "boolean" }, rehearsal: { type: "boolean" }, pause: { type: "boolean" },
    walkthrough: { type: "boolean" },
    scenario: { type: "string", default: "mixed" },
  }, strict: true, allowPositionals: false });
  if (values.live && values.rehearsal) throw new Error("Choose --live or --rehearsal, not both.");
  const args = validateArgs({
    scenario: values.scenario, mode: values.live ? "live" : "rehearsal",
    seed: 42, pauseForApproval: values.pause ?? false, walkthrough: values.walkthrough ?? false,
  });
  if ((args.pauseForApproval || args.walkthrough) && !stdin.isTTY) {
    throw new Error("A review checkpoint needs an interactive terminal. Omit --pause for a draft-only run; no approval will be claimed.");
  }
  await withNativeSession(async ({ session, runtime }) => {
    console.log(`Native SDK runtime ${runtime.version}; owning session ${session.sessionId}.`);
    console.log(args.mode === "live" ? "Actual model calls: GPT-6.1 Sol / max, Sonnet 5.5 / high. AI credits are consumed."
      : "Actual Copilot workflow runtime. Rehearsal workers only; no model calls.");
    let final = await session.workflow.run("launch-rescue", { args, notifyOnComplete: false });
    const runId = final.runId;
    await reconcileNativeRun(root, final);
    while (final.status === "paused") {
      try {
        const key = final.pauseInfo?.type === "checkpoint" ? final.pauseInfo.key : null;
        const walkthrough = isWalkthroughCheckpoint(key);
        console.log(walkthrough
          ? "Feature walkthrough stopped. Read the highlighted feature, relevant code, input, and result in the browser."
          : "Review the synthetic draft and its evidence. This checkpoint does not authorize deployment.");
        if (!walkthrough) await recordRunCost({ root, session, runId, mode: args.mode });
        const answer = await promptCheckpoint(undefined, undefined, walkthrough ? "NEXT" : "APPROVE");
        if (answer === "hold") {
          await reconcileNativeRun(root, final, { hostClosed: true });
          console.log("Held at the checkpoint. No approval recorded. This SDK host will exit; start a new run to continue.");
          break;
        }
        final = await session.workflow.resume(runId, { notifyOnComplete: false });
        await reconcileNativeRun(root, final);
      } catch (error) {
        try {
          final = await session.workflow.getRun(runId);
          await reconcileNativeRun(root, final, { hostClosed: true });
        } catch (observationError) {
          throw new AggregateError([error, observationError], "Checkpoint failed and its final state could not be observed.");
        }
        throw error;
      }
    }
    await mkdir(join(root, "runs"), { recursive: true });
    const envelope = join(root, "runs", `sdk-envelope-${runId}.json`);
    await writeFile(envelope, JSON.stringify(final, null, 2), "utf8");
    console.log(`Native status: ${final.status}; envelope: ${envelope}`);
    await recordRunCost({ root, session, runId, mode: args.mode });
    if (final.status !== "completed" && final.status !== "paused") {
      throw new Error(`Native workflow did not complete: ${final.error ?? final.reason ?? final.failure?.type ?? final.status}`);
    }
    if (final.status === "paused") process.exitCode = 1;
    if (final.status === "completed") {
      if (!final.result) throw new Error("A completed native run returned no report.");
      console.log(`${final.result.after.uniqueConfirmed} confirmed, ${final.result.after.waitlisted} waitlisted. Synthetic only.`);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
