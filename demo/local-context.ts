import type { JsonValue, WorkflowAgentOptions, WorkflowStepOptions } from "@github/copilot-sdk/extension";
import { WorkflowError, type RunContext, type WorkflowArgs } from "./core.js";

export type Journal = {
  version: 1;
  runId: string;
  args: WorkflowArgs;
  steps: Record<string, JsonValue>;
  checkpoints: Record<string, boolean>;
};

export class CheckpointPause extends Error {
  constructor() { super("Review checkpoint reached."); this.name = "CheckpointPause"; }
}
export class PresenterPause extends Error {
  constructor() { super("Paused by presenter. Saved steps can be resumed."); this.name = "PresenterPause"; }
}
export class UserCancel extends Error {
  constructor() { super("Cancelled. Start a new run to continue."); this.name = "UserCancel"; }
}

export function newJournal(args: WorkflowArgs, runId = crypto.randomUUID()): Journal {
  return { version: 1, runId, args, steps: {}, checkpoints: {} };
}

export class LocalContext implements RunContext {
  readonly runId: string;
  readonly args: WorkflowArgs;
  readonly signal: AbortSignal;
  readonly producerCounts = new Map<string, number>();
  private readonly controller = new AbortController();

  constructor(
    readonly journal: Journal,
    private readonly save: (journal: Journal) => void = () => {},
    private readonly delayMs = 0,
  ) {
    this.runId = journal.runId;
    this.args = journal.args;
    this.signal = this.controller.signal;
    if (this.args.mode !== "rehearsal") {
      throw new WorkflowError("The standalone runner never calls models. Run native live mode in Copilot.");
    }
  }

  phase(_title: string): void { this.throwIfAborted(); }
  log(_message: string): void { this.throwIfAborted(); }
  pauseNow(): void { this.controller.abort(new PresenterPause()); }
  cancel(): void { this.controller.abort(new UserCancel()); }

  private throwIfAborted(): void {
    if (this.signal.aborted) throw this.signal.reason;
  }

  private async wait(): Promise<void> {
    this.throwIfAborted();
    if (this.delayMs <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(this.signal.reason); };
      const timer = setTimeout(() => {
        this.signal.removeEventListener("abort", abort);
        resolve();
      }, this.delayMs);
      this.signal.addEventListener("abort", abort, { once: true });
    });
    this.throwIfAborted();
  }

  async step(key: string, producer: () => JsonValue | Promise<JsonValue>, options?: WorkflowStepOptions): Promise<JsonValue> {
    this.throwIfAborted();
    if (!options?.volatile && Object.hasOwn(this.journal.steps, key)) {
      const saved = this.journal.steps[key];
      if (saved === undefined) throw new WorkflowError("A saved step has no JSON value.");
      return structuredClone(saved);
    }
    await this.wait();
    const result = await producer();
    this.throwIfAborted();
    if (result === undefined) throw new WorkflowError("A step returned undefined instead of JSON.");
    const copy: JsonValue = JSON.parse(JSON.stringify(result));
    this.producerCounts.set(key, (this.producerCounts.get(key) ?? 0) + 1);
    if (!options?.volatile) {
      this.journal.steps[key] = copy;
      this.save(this.journal);
    }
    return copy;
  }

  async parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>> {
    if (thunks.length > 4096) throw new WorkflowError("Too many parallel tasks.");
    return Promise.all(thunks.map(async (thunk) => {
      try { return await thunk(); }
      catch (error) {
        if (this.signal.aborted) throw this.signal.reason;
        if (error instanceof CheckpointPause || error instanceof PresenterPause || error instanceof UserCancel) throw error;
        return null;
      }
    }));
  }

  async agent(_prompt: string, _options?: WorkflowAgentOptions): Promise<unknown> {
    throw new WorkflowError("Standalone rehearsal cannot spawn a Copilot agent.");
  }

  async pause(key: string): Promise<void> {
    this.throwIfAborted();
    if (this.journal.checkpoints[key] === true) return;
    this.journal.checkpoints[key] = true;
    this.save(this.journal);
    throw new CheckpointPause();
  }
}
