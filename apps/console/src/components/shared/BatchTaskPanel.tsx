import { BatchStatusCard } from "@/components/shared/BatchStatusCard"
import type { GenerationBatch } from "@/lib/generationApi"

/** 统一批任务轨：进度、取消、失败项重试和结果入口。 */
export function BatchTaskPanel({
  artifactLabel,
  batch,
  onRetryItem,
  retryingItemIndex,
  isCancelling,
  onCancel,
}: {
  artifactLabel?: string | null
  batch: GenerationBatch | null
  onRetryItem: (itemIndex: number) => void
  retryingItemIndex: number | null
  isCancelling: boolean
  onCancel: () => void
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
        isCancelling={isCancelling}
        onCancel={onCancel}
        onRetryItem={onRetryItem}
        retryingItemIndex={retryingItemIndex}
      />
    </aside>
  )
}
