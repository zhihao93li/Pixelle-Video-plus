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
    <aside
      className="min-w-0 xl:sticky xl:top-[5.5rem] xl:self-start"
      data-slot="production-rail"
    >
      <BatchStatusCard
        artifactLabel={artifactLabel}
        batch={batch}
        className="min-h-[420px] xl:h-[calc(100svh-10.25rem)] xl:min-h-[640px] xl:overflow-y-auto"
        onRetryItem={onRetryItem}
        retryingItemIndex={retryingItemIndex}
      />
    </aside>
  )
}
