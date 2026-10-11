import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import type { JsonValue, WorkflowAgentSummary } from "@github/copilot-sdk/extension";

type AtomicOperations = {
  write: (path: string, contents: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  cleanup?: (path: string) => Promise<void>;
};
const operations: AtomicOperations = {
  write: async (path, contents) => { await writeFile(path, contents, "utf8"); },
  rename,
  wait: async (milliseconds) => { await new Promise<void>((done) => setTimeout(done, milliseconds)); },
  cleanup: async (path) => { await rm(path, { force: true }); },
};

export async function writeAtomic(path: string, value: JsonValue, io: AtomicOperations = operations): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const contents = JSON.stringify(value, null, 2);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await io.write(temporary, contents);
        await io.rename(temporary, path);
        return;
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if ((code !== "EPERM" && code !== "EBUSY") || attempt >= 2) throw error;
        await io.wait(20 * 2 ** attempt);
      }
    }
  } catch (error) {
    try { await io.cleanup?.(temporary); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Atomic observation write and cleanup failed."); }
    throw error;
  }
}

export function assertResolvedModel(agents: readonly WorkflowAgentSummary[], label: string | undefined, model: string | undefined): void {
  const completed = agents.filter((agent) => agent.label === label && agent.status === "completed")
    .sort((left, right) => (right.completedAt ?? right.startedAt ?? 0) - (left.completedAt ?? left.startedAt ?? 0));
  const latest = completed[0];
  if (!label || !model || !latest || latest.requestedModel !== model || latest.resolvedModel !== model) {
    throw new Error(`Could not verify the requested model for ${label ?? "unlabeled agent"}. No fallback is allowed.`);
  }
}
