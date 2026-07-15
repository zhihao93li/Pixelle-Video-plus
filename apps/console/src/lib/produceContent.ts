import {
  getTask,
  produceContentItem,
  type ContentItem,
  type GenerationTask,
} from "@/lib/generationApi"

/** Backend-owned content production: React chooses inputs and observes tasks. */

export function isProducibleItem(item: ContentItem) {
  return item.kind === "text" && ["confirmed", "produced"].includes(item.status)
}

export function confirmedVariants(item: ContentItem) {
  return Object.values(item.variants).filter(
    (variant) => variant.status === "confirmed" && variant.script.trim()
  )
}

export function buildProduceSubmissions(items: ContentItem[]) {
  const rows: Array<{ itemId: string; input: Record<string, unknown> }> = []
  for (const item of items) {
    if (!isProducibleItem(item)) continue
    for (const variant of confirmedVariants(item)) {
      rows.push({ itemId: item.item_id, input: { language: variant.language } })
    }
  }
  return rows
}

export async function submitContentProduction({
  submissions,
  templateId,
  overrides,
  trackTask,
}: {
  submissions: Array<{ itemId: string; input: Record<string, unknown> }>
  templateId: string
  overrides: Record<string, unknown>
  projectId?: string
  allItems: ContentItem[]
  trackTask: (task: GenerationTask, templateName?: string | null) => void
}) {
  const itemIds = [
    ...new Set(submissions.map((submission) => submission.itemId)),
  ]
  const responses = await Promise.all(
    itemIds.map((itemId) =>
      produceContentItem({
        itemId,
        recipeId: templateId,
        overrides,
      })
    )
  )
  const tasks = await Promise.allSettled(
    responses
      .flatMap((response) => response.task_ids)
      .map((taskId) => getTask(taskId))
  )
  for (const task of tasks) {
    if (task.status === "fulfilled") trackTask(task.value, "内容出片")
  }
  return responses
}
