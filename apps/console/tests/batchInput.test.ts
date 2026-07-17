import assert from "node:assert/strict"
import test from "node:test"

import {
  isTerminalBatchStatus,
  parseFixedScriptItems,
} from "../src/lib/batchInput.ts"

test("batch script blocks use a standalone separator and first line as title", () => {
  assert.deepEqual(
    parseFixedScriptItems(
      "第一条标题\n第一条正文\n第二段\n\n---\n\n第二条标题\n第二条正文"
    ),
    [
      {
        input: {
          title: "第一条标题",
          script: "第一条正文\n第二段",
        },
      },
      {
        input: { title: "第二条标题", script: "第二条正文" },
      },
    ]
  )
})

test("batch script parser ignores empty blocks and reuses a one-line block as body", () => {
  assert.deepEqual(
    parseFixedScriptItems("单行内容\n\n---\n\n   \n---\n\n第二条\n正文"),
    [
      { input: { title: "单行内容", script: "单行内容" } },
      { input: { title: "第二条", script: "正文" } },
    ]
  )
})

test("batch terminal states include cancellation and restart interruption", () => {
  assert.equal(isTerminalBatchStatus("completed"), true)
  assert.equal(isTerminalBatchStatus("partial_failed"), true)
  assert.equal(isTerminalBatchStatus("cancelled"), true)
  assert.equal(isTerminalBatchStatus("interrupted"), true)
  assert.equal(isTerminalBatchStatus("running"), false)
})
