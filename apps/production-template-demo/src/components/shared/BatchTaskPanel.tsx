import { BatchStatusCard } from "@/components/shared/BatchStatusCard"
import type { GenerationBatch } from "@/lib/generationApi"

/** 阶段 2 的统一批任务入口；后续 ENG-03 可在这里替换为批次 ViewModel。 */
export function BatchTaskPanel({
  artifactLabel,
  batch,
  onRetryItem,
  retryingItemIndex,
}: {
  artifactLabel?: string | null
  batch: GenerationBatch | null
  onRetryItem: (itemIndex: number) => void
  retryingItemIndex: number | null
}) {
  return (
    <BatchStatusCard
      artifactLabel={artifactLabel}
      batch={batch}
      onRetryItem={onRetryItem}
      retryingItemIndex={retryingItemIndex}
    />
  )
}
