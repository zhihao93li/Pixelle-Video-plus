import { getTask, type GenerationBatch, type GenerationTask } from "@/lib/generationApi"

/**
 * 把一个 generation batch 的每条任务注册进全局任务中心。
 * 抽成共用函数，供批量页与内容工作台复用（避免各自复制轮询逻辑）。
 */
export async function trackBatchTasks(
  batch: GenerationBatch,
  trackTask: (task: GenerationTask, templateName?: string | null) => void,
  templateName: string | null = null
) {
  const ids = batch.items
    .map((item) => item.task_id)
    .filter((id): id is string => Boolean(id))
  const results = await Promise.allSettled(ids.map((id) => getTask(id)))
  for (const result of results) {
    if (result.status === "fulfilled") {
      trackTask(result.value, templateName)
    }
  }
}
