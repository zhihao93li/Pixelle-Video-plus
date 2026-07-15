import {
  getContentOperation,
  startContentDraft,
  type ContentFlowOperation,
  type ContentItem,
} from "@/lib/generationApi"

type ToastFn = (toast: {
  title: string
  description?: string
  variant?: "success" | "error" | "default"
}) => void

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

async function waitForOperation(
  operation: ContentFlowOperation,
  timeoutMs = 10 * 60 * 1000
) {
  const startedAt = Date.now()
  let current = operation
  while (current.status === "running" && Date.now() - startedAt < timeoutMs) {
    await wait(1500)
    current = await getContentOperation(current.operation_id)
  }
  return current
}

/**
 * Start server-owned drafting. React only submits and observes the durable
 * operation; status transitions, LLM work, variants and failure compensation
 * all live in the backend use case.
 */
export async function generateDraftsForItems(
  items: ContentItem[],
  toast: ToastFn,
  onChanged: () => void,
  options: { recipeId: string }
) {
  const draftable = items.filter(
    (item) => item.kind === "text" && item.status === "idea"
  )
  if (draftable.length === 0) return

  const operations = await Promise.all(
    draftable.map((item) =>
      startContentDraft(item.item_id, { recipeId: options.recipeId })
    )
  )
  toast({
    title: `开始为 ${operations.length} 个选题起草…`,
    description: "起草完成后会自动进入待确认，可先做别的。",
  })
  onChanged()

  void Promise.all(operations.map((operation) => waitForOperation(operation)))
    .then((results) => {
      const completed = results.filter(
        (operation) => operation.status === "completed"
      ).length
      const failed = results.filter(
        (operation) => operation.status === "failed"
      )
      if (failed.length === 0) {
        toast({
          title: `${completed} 组草稿已生成，待确认`,
          variant: "success",
        })
      } else if (completed > 0) {
        toast({
          title: `${completed} 组草稿已生成，${failed.length} 条起草失败已退回选题池`,
          description: failed[0]?.error?.message,
          variant: "success",
        })
      } else {
        toast({
          title: "草稿生成失败，选题已退回选题池",
          description: failed[0]?.error?.message,
          variant: "error",
        })
      }
      onChanged()
    })
    .catch((error) => {
      toast({
        title: "读取起草进度失败",
        description: String(error),
        variant: "error",
      })
      onChanged()
    })
}
