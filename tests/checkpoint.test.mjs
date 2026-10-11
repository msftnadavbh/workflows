import assert from "node:assert/strict";
import test from "node:test";
import { PassThrough } from "node:stream";
import { promptCheckpoint, readCheckpointDecision } from "../native/checkpoint.mjs";
import { inlineApplication } from "../scripts/build.mjs";

test("checkpoint typos and blank lines keep the review gate open", async () => {
  const answers = ["", "aprove", " approve "];
  const warnings = [];
  let calls = 0;
  const decision = await readCheckpointDecision(async () => answers[calls++], (message) => warnings.push(message));
  assert.equal(decision, "approve");
  assert.equal(calls, 3);
  assert.equal(warnings.length, 2);
});

test("only an explicit HOLD decision closes the checkpoint without approval", async () => {
  const answers = ["APPROVE.", "not yet", " hOlD "];
  let calls = 0;
  assert.equal(await readCheckpointDecision(async () => answers[calls++], () => {}), "hold");
  assert.equal(calls, 3);
});

test("NEXT advances a teaching checkpoint but cannot approve the final draft", async () => {
  const teaching = ["APPROVE", "next"];
  let index = 0;
  assert.equal(await readCheckpointDecision(async () => teaching[index++], () => {}, "NEXT"), "next");
  assert.equal(index, 2);
  const review = ["NEXT", "approve"];
  index = 0;
  assert.equal(await readCheckpointDecision(async () => review[index++], () => {}), "approve");
  assert.equal(index, 2);
});

test("EOF aborts a pending checkpoint instead of leaving its question hung", { timeout: 2000 }, async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const question = promptCheckpoint(input, output);
  const rejection = assert.rejects(question, { name: "AbortError" });
  input.end();
  await rejection;
  output.destroy();
});

test("terminal interruption aborts review without turning it into approval", { timeout: 2000 }, async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  output.isTTY = true;
  const question = promptCheckpoint(input, output);
  const rejection = assert.rejects(question, { name: "AbortError" });
  input.write("\u0003");
  await rejection;
  input.destroy();
  output.destroy();
});

test("inline bundles preserve JavaScript dollar tokens and escape closing script tags", () => {
  const source = 'const tokens = "$$ $& $` $\' </script>";';
  const result = inlineApplication("<main><!-- BUNDLED_APPLICATION --></main>", source);
  assert.equal(result, `<main><script>${source.replaceAll("</script", "<\\/script")}</script></main>`);
  assert.throws(() => inlineApplication("<main></main>", source), /marker is missing/);
});
