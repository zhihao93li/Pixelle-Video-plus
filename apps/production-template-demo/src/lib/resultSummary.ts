type QualityCheck = {
  id?: string
  status?: string
  message?: string
}

export type QualityReviewInput = {
  status?: string
  summary?: string
  checks?: QualityCheck[]
}

type Asset = {
  role?: string
  kind?: string
  path?: string
  text?: string
  status?: string
  exists?: boolean | null
  frame_index?: number
}

export type AssetManifestInput = {
  assets?: Asset[]
}

export type QualitySummary = {
  label: "可发布" | "需检查" | "不可发布" | "未返回"
  tone: "passed" | "warning" | "failed" | "missing"
  summary: string
  failures: string[]
  warnings: string[]
}

export type AssetItem = {
  label: string
  kind: string
  statusLabel: "可用" | "缺失" | "未知"
  detail: string
}

const roleLabels: Record<string, string> = {
  final_video: "成片视频",
  primary_video: "成片视频",
  narration_audio: "旁白音频",
  voiceover: "旁白音频",
  primary_visual: "主要画面",
  bgm: "背景音乐",
  subtitle_text: "字幕文案",
  composed_frame: "合成画面",
  video_segment: "视频片段",
}

export function buildQualitySummary(
  qualityReview: QualityReviewInput | null | undefined
): QualitySummary {
  if (!qualityReview) {
    return {
      label: "未返回",
      tone: "missing",
      summary: "后端没有返回质量检查结果。",
      failures: [],
      warnings: [],
    }
  }

  const failures = checkMessages(qualityReview, "failed")
  const warnings = checkMessages(qualityReview, "warning")
  const tone =
    qualityReview.status === "failed"
      ? "failed"
      : qualityReview.status === "warning"
        ? "warning"
        : "passed"

  return {
    label:
      tone === "failed" ? "不可发布" : tone === "warning" ? "需检查" : "可发布",
    tone,
    summary:
      qualityReview.summary ||
      (tone === "passed" ? "视频通过质量检查。" : "视频质量检查需要关注。"),
    failures,
    warnings,
  }
}

export function buildAssetItems(
  assetManifest: AssetManifestInput | null | undefined,
  limit = 8
): AssetItem[] {
  return (assetManifest?.assets || []).slice(0, limit).map((asset) => ({
    label: roleLabels[String(asset.role || "")] || String(asset.role || "素材"),
    kind: String(asset.kind || "unknown"),
    statusLabel: assetStatusLabel(asset),
    detail: asset.path || asset.text || "未返回路径或文本",
  }))
}

function checkMessages(qualityReview: QualityReviewInput, status: string) {
  return (qualityReview.checks || [])
    .filter((check) => check.status === status)
    .map((check) => check.message || check.id || "Quality check needs attention.")
}

function assetStatusLabel(asset: Asset): AssetItem["statusLabel"] {
  if (asset.status === "missing" || asset.exists === false) {
    return "缺失"
  }
  if (asset.status === "available" || asset.exists === true || asset.text) {
    return "可用"
  }
  return "未知"
}
