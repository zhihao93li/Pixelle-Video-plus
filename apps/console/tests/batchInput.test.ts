import assert from "node:assert/strict"
import test from "node:test"

import { isTerminalBatchStatus } from "../src/lib/batchInput.ts"

test("batch terminal states include cancellation and restart interruption", () => {
  assert.equal(isTerminalBatchStatus("completed"), true)
  assert.equal(isTerminalBatchStatus("partial_failed"), true)
  assert.equal(isTerminalBatchStatus("cancelled"), true)
  assert.equal(isTerminalBatchStatus("interrupted"), true)
  assert.equal(isTerminalBatchStatus("running"), false)
})
