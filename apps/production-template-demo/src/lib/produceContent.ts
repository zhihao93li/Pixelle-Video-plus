import {
  createGenerationBatch,
  patchContentItem,
  transitionContentItem,
  type ContentItem,
  type GenerationBatch,
} from "@/lib/generationApi"
import { trackBatchTasks } from "@/lib/trackBatch"

/**
 * 内容条目出片的共享提交管线：看板多选出片与内容详情页单条出片共用，
 * 保证行为一致（分镜按行直出、任务 id 追加不替换、任务中心跟踪）。
 */

export function isProducibleItem(item: ContentItem) {
  return (
    item.kind === "text" &&
    (item.status === "idea" ||
      item.status === "confirmed" ||
      item.status === "produced")
  )
}

export function confirmedVariants(item: ContentItem) {
  return Object.values(item.variants).filter(
    (variant) => variant.status === "confirmed" && variant.script.trim()
  )
}

/** 每个已确认语言变体 = 一个出片任务；有已确认分镜时按分镜行直出（split_mode=line）。 */
export function buildProduceSubmissions(items: ContentItem[]) {
  const rows: Array<{ itemId: string; input: Record<string, unknown> }> = []
  for (const item of items) {
    if (!isProducibleItem(item)) {
      continue
    }
    for (const variant of confirmedVariants(item)) {
      const narrations = (variant.narrations ?? [])
        .map((line) => line.trim())
        .filter(Boolean)
      rows.push({
        itemId: item.item_id,
        input:
          narrations.length > 0
            ? {
                script: narrations.join("\n"),
                title: variant.title || item.title,
                split_mode: "line",
              }
            : { script: variant.script, title: variant.title || item.title },
      })
    }
  }
  return rows
}

export async function submitContentProduction({
  submissions,
  templateId,
  overrides,
  projectId,
  allItems,
  trackTask,
}: {
  submissions: Array<{ itemId: string; input: Record<string, unknown> }>
  templateId: string
  overrides: Record<string, unknown>
  projectId?: string
  /** 用于读取既有 links 以做追加合并（找不到时按空处理） */
  allItems: ContentItem[]
  trackTask: Parameters<typeof trackBatchTasks>[1]
}): Promise<GenerationBatch> {
  const batch = await createGenerationBatch({
    templateId,
    items: submissions.map((row) => ({
      input: { ...row.input, ...overrides },
      metadata: { content_item_id: row.itemId, source: "content_workbench" },
    })),
    metadata: { source: "content_workbench" },
    projectId,
  })

  const byItem = new Map<string, string[]>()
  batch.items.forEach((batchItem, index) => {
    const itemId = submissions[index]?.itemId
    if (itemId && batchItem.task_id) {
      const list = byItem.get(itemId) ?? []
      list.push(batchItem.task_id)
      byItem.set(itemId, list)
    }
  })

  for (const [itemId, taskIds] of byItem) {
    await transitionContentItem(itemId, "producing")
    // 追加而非替换：同一条内容可多次出片，历史产物引用要保留。
    const existing = allItems.find((entry) => entry.item_id === itemId)
    const previousTaskIds = existing?.links.task_ids ?? []
    const previousBatchIds = existing?.links.batch_ids ?? []
    await patchContentItem(itemId, {
      links: {
        task_ids: [...previousTaskIds, ...taskIds],
        batch_ids: [...previousBatchIds, batch.batch_id],
      },
    })
  }

  await trackBatchTasks(batch, trackTask, "内容出片")
  return batch
}
