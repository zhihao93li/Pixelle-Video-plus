/**
 * 批量提交的文案解析与预览（从旧批量页抽出，供生成页批量模式复用）。
 *
 * 约定：用 `---` 单独一行分隔多条；每条首行作标题，其余作正文（正文为空则整块作正文）。
 */

export type ParsedScriptItem = {
  input: { script: string; title: string }
}

/** 把多条粘贴文本解析成批量条目（每条一个生成任务的 input）。 */
export function parseFixedScriptItems(text: string): ParsedScriptItem[] {
  return text
    .split(/\n\s*---\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const [title, script] = fixedTitleAndBody(block, index + 1)
      return { input: { script, title } }
    })
}

/** 从粘贴文本里移除第 index 条，返回重新拼好的文本。 */
export function removeScriptItem(text: string, index: number): string {
  const blocks = text
    .split(/\n\s*---\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
  blocks.splice(index, 1)
  return blocks.join("\n\n---\n\n")
}

export function getBatchPreviewTitle(
  input: { title?: unknown; topic?: unknown },
  index: number
): string {
  return (
    previewText(input.title) || previewText(input.topic) || `第 ${index + 1} 条`
  )
}

export function getBatchPreviewBody(input: {
  script?: unknown
  topic?: unknown
}): string {
  return previewText(input.script) || previewText(input.topic)
}

/** 正文行数（图文线按行分页，预览用）。 */
export function getBatchPreviewLineCount(input: {
  script?: unknown
  topic?: unknown
}): number {
  const body = getBatchPreviewBody(input)
  if (!body) {
    return 0
  }
  return body.split(/\r?\n/).filter((line) => line.trim()).length
}

export function isTerminalBatchStatus(status: string): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "partial_failed"
  )
}

function previewText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function fixedTitleAndBody(block: string, index: number): [string, string] {
  const lines = block.split(/\r?\n/)
  const title = lines[0]?.trim() || `Task ${index}`
  const body = lines.slice(1).join("\n").trim() || block
  return [title, body]
}
