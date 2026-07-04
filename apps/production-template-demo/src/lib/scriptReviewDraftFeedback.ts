import type { ScriptReviewDraftSet } from "./generationApi"

type DraftFeedbackInput = Pick<ScriptReviewDraftSet, "status" | "drafts" | "errors">

export type ScriptReviewDraftFeedback = {
  usable: boolean
  notice: string | null
  errorTitle: string | null
  errorMessage: string | null
}

export function buildScriptReviewDraftFeedback(
  draftSet: DraftFeedbackInput
): ScriptReviewDraftFeedback {
  const draftCount = draftSet.drafts.length
  const errors = draftSet.errors
  const errorMessage = formatScriptReviewDraftErrors(errors)

  if (draftSet.status === "failed" || draftCount === 0) {
    return {
      usable: false,
      notice: null,
      errorTitle: "草稿生成失败",
      errorMessage: [
        "没有生成可审核草稿。",
        errorMessage || "请检查 LLM 返回内容、Prompt 模板或模型配置后重试。",
      ].join("\n"),
    }
  }

  if (draftSet.status === "partial_failed" || errors.length > 0) {
    return {
      usable: true,
      notice: `已生成 ${draftCount} 组审核草稿，但有 ${errors.length} 条失败。`,
      errorTitle: "部分草稿生成失败",
      errorMessage:
        errorMessage || "部分选题没有生成草稿，请检查失败项后继续审核可用草稿。",
    }
  }

  return {
    usable: true,
    notice: `已生成 ${draftCount} 组审核草稿。`,
    errorTitle: null,
    errorMessage: null,
  }
}

export function formatScriptReviewDraftErrors(
  errors: Array<Record<string, unknown>>
) {
  if (errors.length === 0) {
    return ""
  }

  const visibleErrors = errors.slice(0, 3).map((error) => {
    const topic = stringField(error.topic)
    const layer = stringField(error.layer)
    const message =
      stringField(error.message) ||
      stringField(error.exception_type) ||
      "未知错误"

    return [
      topic ? `选题：${topic}` : "",
      layer ? `层级：${layer}` : "",
      message,
    ]
      .filter(Boolean)
      .join("；")
  })

  if (errors.length > visibleErrors.length) {
    visibleErrors.push(`还有 ${errors.length - visibleErrors.length} 条错误未显示。`)
  }

  return visibleErrors.join("\n")
}

function stringField(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}
