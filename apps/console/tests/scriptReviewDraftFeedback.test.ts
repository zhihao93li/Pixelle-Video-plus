import assert from "node:assert/strict"
import test from "node:test"

import { buildScriptReviewDraftFeedback } from "../src/lib/scriptReviewDraftFeedback.ts"

test("script review feedback treats failed empty draft sets as errors", () => {
  const feedback = buildScriptReviewDraftFeedback({
    status: "failed",
    drafts: [],
    errors: [
      {
        topic: "猫咪换季掉毛怎么处理",
        layer: "runtime",
        message: "Chinese script split failed: LLM response is empty",
      },
    ],
  })

  assert.equal(feedback.usable, false)
  assert.equal(feedback.notice, null)
  assert.equal(feedback.errorTitle, "草稿生成失败")
  assert.match(feedback.errorMessage ?? "", /没有生成可审核草稿/)
  assert.match(feedback.errorMessage ?? "", /LLM response is empty/)
})

test("script review feedback keeps partial draft sets usable but visible", () => {
  const feedback = buildScriptReviewDraftFeedback({
    status: "partial_failed",
    drafts: [{ topic: "猫咪喝水" }],
    errors: [{ topic: "猫咪掉毛", message: "split failed" }],
  })

  assert.equal(feedback.usable, true)
  assert.equal(feedback.notice, "已生成 1 组审核草稿，但有 1 条失败。")
  assert.equal(feedback.errorTitle, "部分草稿生成失败")
  assert.match(feedback.errorMessage ?? "", /split failed/)
})

test("script review feedback reports normal drafted sets as success", () => {
  const feedback = buildScriptReviewDraftFeedback({
    status: "drafted",
    drafts: [{ topic: "猫咪喝水" }, { topic: "猫咪掉毛" }],
    errors: [],
  })

  assert.equal(feedback.usable, true)
  assert.equal(feedback.notice, "已生成 2 组审核草稿。")
  assert.equal(feedback.errorTitle, null)
  assert.equal(feedback.errorMessage, null)
})
