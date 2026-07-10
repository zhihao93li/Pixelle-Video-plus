import type { ProductionTemplate } from "./generationApi.ts"

export const SPECIAL_PIPELINE_MODES = [
  "image_to_video",
  "action_transfer",
  "digital_human",
] as const

export type SpecialPipelineMode = (typeof SPECIAL_PIPELINE_MODES)[number]
export type DigitalHumanMode = "customize" | "digital"

export const SPECIAL_MODE_COPY: Record<
  SpecialPipelineMode,
  { label: string; inputTitle: string; inputDescription: string }
> = {
  image_to_video: {
    label: "图片生成视频",
    inputTitle: "让图片动起来",
    inputDescription:
      "上传图片并描述运动方式。单条每次使用一张图，批量每张图创建一个任务。",
  },
  action_transfer: {
    label: "动作迁移视频",
    inputTitle: "迁移参考动作",
    inputDescription: "上传一段参考视频和一张目标人物图，再描述期望效果。",
  },
  digital_human: {
    label: "数字人视频",
    inputTitle: "生成数字人口播",
    inputDescription: "使用角色形象和文案生成口播；商品模式还需要一张商品图。",
  },
}

const PIPELINE_BY_MODE: Record<SpecialPipelineMode, string> = {
  image_to_video: "i2v",
  action_transfer: "action_transfer",
  digital_human: "digital_human",
}

export type SpecialTemplateResolution =
  | {
      kind: "ready"
      template: ProductionTemplate
      canonicalPath: string
      legacyRoute: boolean
    }
  | { kind: "not_found"; templateId: string }
  | {
      kind: "mode_mismatch"
      template: ProductionTemplate
      expectedMode: SpecialPipelineMode
    }
  | { kind: "unavailable"; template: ProductionTemplate }
  | { kind: "empty"; mode: SpecialPipelineMode }

export function specialTemplatePath(
  mode: SpecialPipelineMode,
  templateId: string
) {
  return `/create/special/${mode}/${encodeURIComponent(templateId)}`
}

export function templateMatchesSpecialMode(
  template: ProductionTemplate,
  mode: SpecialPipelineMode
) {
  return (
    template.product_entry === mode &&
    template.pipeline_id === PIPELINE_BY_MODE[mode]
  )
}

export function specialTemplatesForMode(
  templates: ProductionTemplate[],
  mode: SpecialPipelineMode
) {
  return templates.filter((template) =>
    templateMatchesSpecialMode(template, mode)
  )
}

export function preferredSpecialTemplate(
  templates: ProductionTemplate[],
  mode: SpecialPipelineMode
) {
  const candidates = specialTemplatesForMode(templates, mode)
  return (
    candidates.find(
      (template) => template.enabled && !template.retired && !template.is_custom
    ) ??
    candidates.find((template) => template.enabled && !template.retired) ??
    null
  )
}

export function resolveSpecialTemplate(
  templates: ProductionTemplate[],
  mode: SpecialPipelineMode,
  templateId?: string
): SpecialTemplateResolution {
  if (templateId) {
    const template = templates.find((item) => item.id === templateId)
    if (!template) {
      return { kind: "not_found", templateId }
    }
    if (!templateMatchesSpecialMode(template, mode)) {
      return { kind: "mode_mismatch", template, expectedMode: mode }
    }
    if (!template.enabled || template.retired) {
      return { kind: "unavailable", template }
    }
    return {
      kind: "ready",
      template,
      canonicalPath: specialTemplatePath(mode, template.id),
      legacyRoute: false,
    }
  }

  const template = preferredSpecialTemplate(templates, mode)
  if (!template) {
    const unavailable = specialTemplatesForMode(templates, mode)[0]
    return unavailable
      ? { kind: "unavailable", template: unavailable }
      : { kind: "empty", mode }
  }
  return {
    kind: "ready",
    template,
    canonicalPath: specialTemplatePath(mode, template.id),
    legacyRoute: true,
  }
}

export type SpecialSubmissionSnapshot = {
  mode: SpecialPipelineMode
  digitalMode: DigitalHumanMode
  templateEnabled: boolean
  imageCount: number
  referenceVideoCount: number
  characterCount: number
  goodsCount: number
  prompt: string
  script: string
  goodsTitle: string
  isSubmitting?: boolean
  hasActiveTask?: boolean
}

export type SpecialSubmissionValidation =
  { ok: true } | { ok: false; reason: string }

export function validateSpecialSubmission({
  mode,
  digitalMode,
  templateEnabled,
  imageCount,
  referenceVideoCount,
  characterCount,
  goodsCount,
  prompt,
  script,
  goodsTitle,
  isSubmitting = false,
  hasActiveTask = false,
}: SpecialSubmissionSnapshot): SpecialSubmissionValidation {
  if (!templateEnabled) {
    return { ok: false, reason: "当前配方暂不可用" }
  }
  if (isSubmitting) {
    return { ok: false, reason: "正在提交" }
  }
  if (hasActiveTask) {
    return { ok: false, reason: "当前任务完成后才能再次提交" }
  }

  if (mode === "image_to_video") {
    if (imageCount === 0) {
      return { ok: false, reason: "请先选择图片" }
    }
    if (!prompt.trim()) {
      return { ok: false, reason: "请描述画面如何运动" }
    }
    return { ok: true }
  }

  if (mode === "action_transfer") {
    if (referenceVideoCount === 0) {
      return { ok: false, reason: "请先选择参考动作视频" }
    }
    if (imageCount === 0) {
      return { ok: false, reason: "请先选择目标人物图" }
    }
    if (!prompt.trim()) {
      return { ok: false, reason: "请描述期望的迁移效果" }
    }
    return { ok: true }
  }

  if (characterCount === 0) {
    return { ok: false, reason: "请先选择角色图" }
  }
  if (digitalMode === "customize") {
    return script.trim()
      ? { ok: true }
      : { ok: false, reason: "请输入数字人文案" }
  }
  if (goodsCount === 0) {
    return { ok: false, reason: "商品模式需要一张商品图" }
  }
  return script.trim() || goodsTitle.trim()
    ? { ok: true }
    : { ok: false, reason: "请输入商品标题或讲解文案" }
}

export type DigitalVoiceSettings = {
  voice: string
  speed: number
}

export function digitalVoiceDefaults(
  template: ProductionTemplate
): DigitalVoiceSettings {
  const rawSpeed = Number(template.fixed_params.tts_speed)
  return {
    voice: String(template.fixed_params.tts_voice ?? ""),
    speed: Number.isFinite(rawSpeed) && rawSpeed > 0 ? rawSpeed : 1.2,
  }
}

export function digitalVoiceOverrides(
  defaults: DigitalVoiceSettings,
  current: DigitalVoiceSettings
) {
  const overrides: Record<string, string | number> = {}
  const voice = current.voice.trim()
  if (voice && voice !== defaults.voice.trim()) {
    overrides.tts_voice = voice
  }
  if (current.speed !== defaults.speed) {
    overrides.tts_speed = current.speed
  }
  return overrides
}

export function buildSpecialTaskInput({
  mode,
  digitalMode,
  imagePaths,
  referenceVideoPaths,
  characterPaths,
  goodsPaths,
  prompt,
  title,
  duration,
  script,
  goodsTitle,
  voiceOverrides,
}: {
  mode: SpecialPipelineMode
  digitalMode: DigitalHumanMode
  imagePaths: string[]
  referenceVideoPaths: string[]
  characterPaths: string[]
  goodsPaths: string[]
  prompt: string
  title: string
  duration: number
  script: string
  goodsTitle: string
  voiceOverrides: Record<string, string | number>
}): Record<string, unknown> {
  if (mode === "image_to_video") {
    return compactRecord({
      assets: imagePaths.slice(0, 1),
      prompt: prompt.trim(),
      title: title.trim(),
    })
  }

  if (mode === "action_transfer") {
    return compactRecord({
      reference_video: referenceVideoPaths[0],
      assets: imagePaths.slice(0, 1),
      prompt: prompt.trim(),
      duration: duration > 0 ? duration : undefined,
      title: title.trim(),
    })
  }

  return compactRecord({
    character_assets: characterPaths.slice(0, 1),
    script: script.trim(),
    title: title.trim(),
    mode: digitalMode,
    goods_assets:
      digitalMode === "digital" ? goodsPaths.slice(0, 1) : undefined,
    goods_title: digitalMode === "digital" ? goodsTitle.trim() : undefined,
    ...voiceOverrides,
  })
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== "" && value != null)
  )
}
