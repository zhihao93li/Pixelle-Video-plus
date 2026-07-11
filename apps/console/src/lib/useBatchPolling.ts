import { useEffect, useState } from "react"

import { isTerminalBatchStatus } from "@/lib/batchInput"
import { readableError } from "@/lib/format"
import {
  getGenerationBatch,
  retryGenerationBatchItem,
  type GenerationBatch,
} from "@/lib/generationApi"

/**
 * 批次进度轮询 hook：仅在非终态时每 2 秒拉一次，终态自动停。
 *
 * 依赖数组只放 `batchId` + `isTerminal`（**不放 batch 对象/isLoading**），
 * 避免每次轮询回写都重建 interval 或取消在途请求（历史「cleanup 取消请求致永久转圈」坑）。
 */
export function useBatchPolling(initial: GenerationBatch | null = null) {
  const [batch, setBatch] = useState<GenerationBatch | null>(initial)
  const [error, setError] = useState<string | null>(null)
  const [retryingItemIndex, setRetryingItemIndex] = useState<number | null>(
    null
  )

  const batchId = batch?.batch_id ?? null
  const isTerminal = batch ? isTerminalBatchStatus(batch.status) : true

  useEffect(() => {
    if (!batchId || isTerminal) {
      return
    }
    const timer = window.setInterval(() => {
      void getGenerationBatch(batchId)
        .then((next) => setBatch(next))
        .catch((pollError) => setError(readableError(pollError)))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [batchId, isTerminal])

  async function retryItem(itemIndex: number) {
    if (!batchId || retryingItemIndex !== null) {
      return
    }
    setRetryingItemIndex(itemIndex)
    setError(null)
    try {
      setBatch(await retryGenerationBatchItem(batchId, itemIndex))
    } catch (retryError) {
      setError(readableError(retryError))
    } finally {
      setRetryingItemIndex(null)
    }
  }

  return { batch, setBatch, error, retryItem, retryingItemIndex }
}
