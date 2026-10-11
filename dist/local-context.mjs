// demo/core.ts
var WorkflowError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkflowError";
  }
};

// demo/local-context.ts
var CheckpointPause = class extends Error {
  constructor(key = "") {
    super("Review checkpoint reached.");
    this.key = key;
    this.name = "CheckpointPause";
  }
  key;
};
var PresenterPause = class extends Error {
  constructor() {
    super("Paused by presenter. Saved steps can be resumed.");
    this.name = "PresenterPause";
  }
};
var UserCancel = class extends Error {
  constructor() {
    super("Cancelled. Start a new run to continue.");
    this.name = "UserCancel";
  }
};
function newJournal(args, runId = crypto.randomUUID()) {
  return { version: 1, runId, args, steps: {}, checkpoints: {} };
}
var LocalContext = class {
  constructor(journal, save = () => {
  }, delayMs = 0) {
    this.journal = journal;
    this.save = save;
    this.delayMs = delayMs;
    this.runId = journal.runId;
    this.args = journal.args;
    this.signal = this.controller.signal;
    if (this.args.mode !== "rehearsal") {
      throw new WorkflowError("The standalone runner never calls models. Run native live mode in Copilot.");
    }
  }
  journal;
  save;
  delayMs;
  runId;
  args;
  signal;
  producerCounts = /* @__PURE__ */ new Map();
  controller = new AbortController();
  phase(_title) {
    this.throwIfAborted();
  }
  log(_message) {
    this.throwIfAborted();
  }
  pauseNow() {
    this.controller.abort(new PresenterPause());
  }
  cancel() {
    this.controller.abort(new UserCancel());
  }
  throwIfAborted() {
    if (this.signal.aborted) throw this.signal.reason;
  }
  async wait() {
    this.throwIfAborted();
    if (this.delayMs <= 0) return;
    await new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(this.signal.reason);
      };
      const timer = setTimeout(() => {
        this.signal.removeEventListener("abort", abort);
        resolve();
      }, this.delayMs);
      this.signal.addEventListener("abort", abort, { once: true });
    });
    this.throwIfAborted();
  }
  async step(key, producer, options) {
    this.throwIfAborted();
    if (!options?.volatile && Object.hasOwn(this.journal.steps, key)) {
      const saved = this.journal.steps[key];
      if (saved === void 0) throw new WorkflowError("A saved step has no JSON value.");
      return structuredClone(saved);
    }
    await this.wait();
    const result = await producer();
    this.throwIfAborted();
    if (result === void 0) throw new WorkflowError("A step returned undefined instead of JSON.");
    const copy = JSON.parse(JSON.stringify(result));
    this.producerCounts.set(key, (this.producerCounts.get(key) ?? 0) + 1);
    if (!options?.volatile) {
      this.journal.steps[key] = copy;
      this.save(this.journal);
    }
    return copy;
  }
  async parallel(thunks) {
    if (thunks.length > 4096) throw new WorkflowError("Too many parallel tasks.");
    return Promise.all(thunks.map(async (thunk) => {
      try {
        return await thunk();
      } catch (error) {
        if (this.signal.aborted) throw this.signal.reason;
        if (error instanceof CheckpointPause || error instanceof PresenterPause || error instanceof UserCancel) throw error;
        return null;
      }
    }));
  }
  async agent(_prompt, _options) {
    throw new WorkflowError("Standalone rehearsal cannot spawn a Copilot agent.");
  }
  async pause(key) {
    this.throwIfAborted();
    if (this.journal.checkpoints[key] === true) return;
    this.journal.checkpoints[key] = true;
    this.save(this.journal);
    throw new CheckpointPause(key);
  }
};
export {
  CheckpointPause,
  LocalContext,
  PresenterPause,
  UserCancel,
  newJournal
};
