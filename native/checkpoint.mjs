import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function readCheckpointDecision(question, warn = console.log) {
  for (;;) {
    const answer = (await question()).trim().toUpperCase();
    if (answer === "APPROVE") return "approve";
    if (answer === "HOLD") return "hold";
    warn("Response not recognized. Type APPROVE or HOLD; the checkpoint is still open.");
  }
}

export async function promptCheckpoint(input = stdin, output = stdout) {
  const terminal = createInterface({ input, output });
  const controller = new AbortController();
  const closed = () => controller.abort(new Error("Checkpoint input closed without an approval or HOLD decision."));
  terminal.once("close", closed);
  terminal.once("SIGINT", closed);
  try {
    return await readCheckpointDecision(
      () => terminal.question("Type APPROVE to resume this synthetic local draft, or HOLD to stop without approval: ",
        { signal: controller.signal }),
      (message) => output.write(`${message}\n`),
    );
  } finally {
    terminal.removeListener("close", closed);
    terminal.removeListener("SIGINT", closed);
    terminal.close();
  }
}
