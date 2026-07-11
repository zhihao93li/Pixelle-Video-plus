import { ApiError, type DraftSetSettings } from "@/lib/generationApi"

/** 把任意错误转成可展示的中文消息。唯一来源，勿在组件内重复实现。 */
export function readableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export function formatDuration(value: number | null | undefined) {
  if (value == null) {
    return "未返回"
  }
  if (value >= 60) {
    const minutes = Math.floor(value / 60)
    const seconds = Math.round(value % 60)
    return `${minutes} 分 ${seconds} 秒`
  }
  return `${value.toFixed(1)} 秒`
}

export function formatBytes(value: number | null | undefined) {
  if (value == null) {
    return "未返回"
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

/** 草稿溯源短句：`配方名 · <模型或"默认模型">`；无溯源信息时返回 null。 */
export function draftSetProvenance(draftSet: {
  draft_settings?: Record<string, unknown>
}): string | null {
  const settings = draftSet.draft_settings as DraftSetSettings | undefined
  if (!settings?.production_template_name && !settings?.script_model) {
    return null
  }
  const model =
    settings?.script_model && settings.script_model.trim()
      ? settings.script_model
      : "默认模型"
  return `${settings.production_template_name ?? "生产配方"} · ${model}`
}

/** 参数生值 → 人话（面向用户禁止 fixed/local 等内部 key 裸奔）。查不到返回原值。 */
const PARAM_VALUE_LABELS: Record<string, string> = {
  fixed: "固定文案",
  ai: "AI 起草",
  local: "本地",
  comfyui: "ComfyUI",
  fish: "Fish Audio",
}

export function paramValueLabel(value: string): string {
  return PARAM_VALUE_LABELS[value] || value
}

/** 常见音色 id → 中文名；查不到显示原值（Fish reference_id 等）。 */
const VOICE_LABELS: Record<string, string> = {
  "zh-CN-YunjianNeural": "云健",
  "zh-CN-YunxiNeural": "云希",
  "zh-CN-YunxiaNeural": "云夏",
  "zh-CN-YunyangNeural": "云扬",
  "zh-CN-XiaoxiaoNeural": "晓晓",
  "zh-CN-XiaoyiNeural": "晓伊",
}

export function voiceLabel(voice: string): string {
  return VOICE_LABELS[voice] || voice
}

export function formatDate(value?: string | null) {
  if (!value) {
    return "未返回"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
