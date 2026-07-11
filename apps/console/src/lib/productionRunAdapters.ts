import { templateArtifactType } from "./artifactKind.ts"
import {
  artifactFileUrl,
  type GenerationResult,
  type GenerationTask,
  type ProductionTemplate,
} from "./generationApi.ts"
import { imageSetLabel } from "./imageSet.ts"
import {
  adaptRunStatus,
  knownStatus,
  runStatusIsCancellable,
  statusIs,
  type ArtifactViewModel,
  type ProductionRunViewModel,
} from "./productViewModels.ts"

export function productionRunViewModel({
  isSubmitting,
  result,
  task,
  template,
}: {
  isSubmitting: boolean
  result: GenerationResult | null
  task: GenerationTask | null
  template: ProductionTemplate | null
}): ProductionRunViewModel | null {
  if (!task && !result && !isSubmitting) {
    return null
  }

  const state = task
    ? adaptRunStatus(task.status)
    : result
      ? knownStatus("completed")
      : knownStatus("submitting")
  const artifact = resultArtifactViewModel(result, template)
  const errorMessage =
    task?.error?.message && statusIs(state, "failed")
      ? [task.error.message, template?.failure_guidance]
          .filter(Boolean)
          .join(" ")
      : null

  return {
    id: task?.task_id ?? result?.task_id ?? "pending-submission",
    title: template?.display_name ?? "本次生产",
    artifactKind: templateArtifactType(
      result?.pipeline_id ?? task?.pipeline_id ?? template?.pipeline_id
    ),
    state,
    progress: task?.progress.percentage ?? (artifact ? 100 : 0),
    message:
      task?.progress.message ??
      (statusIs(state, "submitting") ? "正在提交任务" : null),
    error: errorMessage,
    createdAt: task?.created_at ?? null,
    updatedAt: task?.updated_at ?? null,
    children: [],
    artifact,
    canCancel: task ? runStatusIsCancellable(state) : false,
    canRetry: statusIs(state, "failed") || statusIs(state, "interrupted"),
  }
}

export function resultArtifactViewModel(
  result: GenerationResult | null,
  template: ProductionTemplate | null
): ArtifactViewModel | null {
  if (!result) {
    return null
  }
  const title =
    typeof result.metadata?.title === "string" && result.metadata.title.trim()
      ? result.metadata.title.trim()
      : (template?.display_name ?? "生成结果")

  if (result.artifact_type === "text") {
    const article =
      typeof result.metadata?.article === "string"
        ? result.metadata.article
        : ""
    return {
      id: result.task_id,
      kind: "text",
      title,
      article,
    }
  }

  if (result.artifact_type === "image_set") {
    return {
      id: result.task_id,
      kind: "image_set",
      title,
      caption:
        typeof result.metadata?.caption === "string"
          ? result.metadata.caption
          : null,
      images: result.artifacts
        .filter((artifact) => artifact.kind === "image")
        .map((artifact, index) => ({
          id: artifact.path || artifact.url || `${result.task_id}-${index}`,
          url: artifactFileUrl(artifact) ?? "",
          label: imageSetLabel(index, artifact.role),
        }))
        .filter((item) => item.url),
    }
  }

  const videoUrl = artifactFileUrl(result.primary_video)
  return videoUrl
    ? {
        id: result.task_id,
        kind: "video",
        title,
        src: videoUrl,
        downloadUrl: videoUrl,
        duration: result.duration,
        fileSize: result.file_size,
      }
    : null
}
