import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function readCheckpointDecision(question, warn = console.log, action = "APPROVE") {
  for (;;) {
    const answer = (await question()).trim().toUpperCase();
    if (answer === action) return action === "NEXT" ? "next" : "approve";
    if (answer === "HOLD") return "hold";
    warn(`Response not recognized. Type ${action} or HOLD; the checkpoint is still open.`);
  }
}

export async function promptCheckpoint(input = stdin, output = stdout, action = "APPROVE") {
  if (action !== "APPROVE" && action !== "NEXT") throw new Error("Unknown checkpoint action.");
  const terminal = createInterface({ input, output });
  const controller = new AbortController();
  const closed = () => controller.abort(new Error("Checkpoint input closed without an approval or HOLD decision."));
  terminal.once("close", closed);
  terminal.once("SIGINT", closed);
  try {
    return await readCheckpointDecision(
      () => terminal.question(action === "NEXT"
        ? "Type NEXT to continue the feature walkthrough (not approval), or HOLD to stop: "
        : "Type APPROVE to resume this synthetic local draft, or HOLD to stop without approval: ",
        { signal: controller.signal }),
      (message) => output.write(`${message}\n`),
      action,
    );
  } finally {
    terminal.removeListener("close", closed);
    terminal.removeListener("SIGINT", closed);
    terminal.close();
  }
}
