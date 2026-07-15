import type { ProductionSettingMode } from "./configStages.ts"
import type { PipelineManifest } from "./generationApi.ts"
import {
  PART_EDIT_HINTS,
  PART_EDIT_OPTIONS,
  PART_KEY_LABELS,
} from "./pipelineParts.ts"

export type ProductionSettingControl =
  | "audio"
  | "bgm"
  | "frame_template"
  | "image_model"
  | "image_provider"
  | "language_models"
  | "number"
  | "prompt_template"
  | "readonly"
  | "select"
  | "slider"
  | "template_params"
  | "text"
  | "textarea"
  | "workflow"

export type ProductionSettingField = {
  control: ProductionSettingControl
  expert?: boolean
  hint?: string
  key: string
  label: string
  options?: Array<{ label: string; value: string }>
  readOnly?: boolean
  scope: "both" | "recipe" | "run"
}

export type ProductionSettingSection = {
  description: string
  fields: ProductionSettingField[]
  id: string
  step: number | null
  title: string
}

type FieldSeed = Omit<ProductionSettingField, "key" | "label"> & {
  label?: string
}

const FIELD_REGISTRY: Record<string, FieldSeed> = {
  title: { control: "text", scope: "run" },
  script_template_name: { control: "prompt_template", scope: "both" },
  script_model: { control: "text", scope: "both" },
  language_script_models: { control: "language_models", scope: "both" },
  split_template_name: { control: "prompt_template", scope: "both" },
  split_model: { control: "text", scope: "both" },
  split_mode: {
    control: "select",
    options: [
      { value: "paragraph", label: "按段落切" },
      { value: "line", label: "按行直出" },
      { value: "sentence", label: "按句子切" },
    ],
    scope: "both",
  },
  frame_template: { control: "frame_template", scope: "both" },
  template_params: { control: "template_params", scope: "run" },
  image_provider: { control: "image_provider", scope: "both" },
  image_model: { control: "image_model", scope: "both" },
  media_workflow: {
    control: "workflow",
    expert: true,
    scope: "both",
  },
  workflow_key: { control: "workflow", expert: true, scope: "both" },
  source: {
    control: "select",
    options: PART_EDIT_OPTIONS.source,
    scope: "both",
  },
  media_width: { control: "number", scope: "both" },
  media_height: { control: "number", scope: "both" },
  prompt_prefix: { control: "textarea", scope: "both" },
  image_prompt_visual_context: { control: "textarea", scope: "both" },
  image_prompt_generation_rules: { control: "textarea", scope: "both" },
  tts_inference_mode: {
    control: "select",
    options: PART_EDIT_OPTIONS.tts_inference_mode,
    scope: "both",
  },
  tts_workflow: { control: "workflow", expert: true, scope: "both" },
  tts_voice: { control: "text", scope: "both" },
  voice_id: { control: "text", scope: "run" },
  tts_speed: { control: "slider", scope: "both" },
  ref_audio: { control: "audio", scope: "both" },
  bgm_path: { control: "bgm", scope: "both" },
  bgm_volume: { control: "slider", scope: "both" },
  bgm_mode: {
    control: "select",
    options: PART_EDIT_OPTIONS.bgm_mode,
    scope: "both",
  },
  compose_runtime: {
    control: "select",
    options: PART_EDIT_OPTIONS.compose_runtime,
    scope: "recipe",
  },
  long_form_prompt: { control: "textarea", scope: "both" },
  word_count: { control: "number", scope: "both" },
  llm_model: { control: "text", scope: "both" },
}

const SECTION_DESCRIPTIONS: Record<string, string> = {
  写稿: "选择写稿提示词和模型；提示词可以当场展开修改。",
  分镜: "选择分镜提示词和模型，由分镜模型根据确认稿自行决定镜头数量。",
  视觉提示: "设置生成画面提示词时使用的视觉方向和约束。",
  配音引擎: "选择配音方式及对应工作流。",
  配音: "设置声音、语速与可选参考音频。",
  音色: "设置声音、语速与可选参考音频。",
  画面: "选择图片生成服务、模型、画面模板与尺寸。",
  每镜画面: "选择图片 Provider、模型、画面风格与排版。",
  每页配图: "选择图片 Provider、模型和图集视觉风格。",
  版式: "设置图文成品的画面模板。",
  合成: "设置背景音乐和最终合成方式。",
  长文改写: "设置长文改写规则。",
  字数: "设置长文目标篇幅。",
  写作模型: "选择长文写作模型。",
}

function fieldForKey(
  key: string,
  mode: ProductionSettingMode,
  expertMode: boolean
): ProductionSettingField | null {
  const seed = FIELD_REGISTRY[key]
  if (!seed) return null
  if (seed.expert && !expertMode) return null

  const readOnly = key === "compose_runtime" && mode === "run"
  if (!readOnly && seed.scope !== "both" && seed.scope !== mode) return null
  return {
    ...seed,
    control: readOnly ? "readonly" : seed.control,
    hint: seed.hint ?? PART_EDIT_HINTS[key],
    key,
    label: seed.label ?? PART_KEY_LABELS[key] ?? key,
    readOnly,
  }
}

/**
 * 把运行时白名单投影到产线步骤。显式登记决定是否可编辑；未知白名单键只在
 * 「更多参数」中只读展示，防止漏登记时被悄悄吞掉。
 */
export function productionSettingSections(
  pipeline: PipelineManifest | undefined,
  mode: ProductionSettingMode,
  keys: string[],
  expertMode: boolean
): ProductionSettingSection[] {
  const remaining = new Set(keys)
  const stages = pipeline?.stages ?? []
  const sections: ProductionSettingSection[] = []
  let visibleStep = 0

  if (mode === "run" && remaining.has("title")) {
    const title = fieldForKey("title", mode, expertMode)
    remaining.delete("title")
    if (title) {
      sections.push({
        id: "run-info",
        title: "本次信息",
        description: "只影响这一次生产，不会改动模板默认。",
        step: null,
        fields: [title],
      })
    }
  }

  stages.forEach((stage, index) => {
    const partKeys = stage.setting_keys.filter((key) => remaining.has(key))
    for (const key of partKeys) remaining.delete(key)
    const fields = partKeys.flatMap((key) => {
      const field = fieldForKey(key, mode, expertMode)
      return field ? [field] : []
    })
    if (fields.length === 0) return
    visibleStep += 1
    sections.push({
      id: `${index + 1}-${stage.id}`,
      title: stage.name,
      description:
        stage.description ||
        SECTION_DESCRIPTIONS[stage.name] ||
        "调整这一生产步骤的参数。",
      step: visibleStep,
      fields,
    })
  })

  const registered = Array.from(remaining).flatMap((key) => {
    const field = fieldForKey(key, mode, expertMode)
    return field ? [field] : []
  })
  for (const field of registered) remaining.delete(field.key)
  for (const key of Array.from(remaining)) {
    if (key in FIELD_REGISTRY) remaining.delete(key)
  }
  if (registered.length > 0) {
    sections.push({
      id: "registered-extra",
      title: "其他生产设置",
      description: "已登记、但不属于当前产线步骤图的设置。",
      step: null,
      fields: registered,
    })
  }

  if (remaining.size > 0) {
    sections.push({
      id: "unregistered",
      title: "更多参数",
      description:
        "这些参数已由后端开放，但前端尚未登记安全控件，因此仅展示当前值。",
      step: null,
      fields: Array.from(remaining).map((key) => ({
        key,
        label: PART_KEY_LABELS[key] ?? key,
        control: "readonly",
        readOnly: true,
        scope: "both",
      })),
    })
  }

  return sections
}
