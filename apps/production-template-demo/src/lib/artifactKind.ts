/**
 * 产物形态判定（video / image_set / text）的唯一来源。
 *
 * 有产物结果时优先读 `GenerationResult.artifact_type`（真源）；只有模板还没跑、
 * 拿不到结果时才用 pipeline_id 推断。全站禁止再散落 `pipeline_id === "image_post"`
 * 之类的字面比较——一律走这里的函数或 result.artifact_type。
 */

export type ArtifactKind = "video" | "image_set" | "text"

const PIPELINE_ARTIFACT: Record<string, ArtifactKind> = {
  image_post: "image_set",
  long_form: "text",
}

/** 由模板 pipeline_id 推断产物形态（image_post→image_set，long_form→text，其余→video）。 */
export function templateArtifactType(
  pipelineId: string | null | undefined
): ArtifactKind {
  if (!pipelineId) {
    return "video"
  }
  return PIPELINE_ARTIFACT[pipelineId] ?? "video"
}

/** 非视频产线（图文线 / 长文线）——无配音/无合成视频等视频专属能力。 */
export function isNonVideoPipeline(
  pipelineId: string | null | undefined
): boolean {
  return templateArtifactType(pipelineId) !== "video"
}

/** 产物形态的人话标签（用于徽标 / 标题 / Facts）。 */
export function artifactKindLabel(kind: ArtifactKind): string {
  if (kind === "text") {
    return "长文"
  }
  if (kind === "image_set") {
    return "图集"
  }
  return "视频"
}
