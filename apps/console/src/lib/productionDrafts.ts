import type { ProductionTemplate } from "./generationApi.ts"
import {
  createGenerationDraft,
  type GenerationDraft,
} from "./productViewModels.ts"

export type TemplateParamValue = string | number | boolean

export type StandardGenerationSettings = {
  title: string
  scriptTemplateName: string
  scriptPrompt: string
  scriptProviderId: string
  scriptModel: string
  languageScriptModels: Record<string, { provider_id: string; model: string }>
  splitTemplateName: string
  splitPrompt: string
  splitProviderId: string
  splitModel: string
  frameTemplate: string
  templateParams: Record<string, TemplateParamValue>
  mediaWorkflow: string
  imageProvider: string
  imageModel: string
  mediaWidth: number
  mediaHeight: number
  mediaDuration: number
  mediaPreviewPrompt: string
  promptPrefix: string
  imagePromptVisualContext: string
  imagePromptGenerationRules: string
  bgmPath: string
  bgmVolume: number
  bgmMode: "loop" | "once"
  ttsInferenceMode: "local" | "comfyui" | "fish"
  ttsVoice: string
  ttsWorkflow: string
  ttsSpeed: number
  ttsRefAudioPath: string
  ttsRefAudioName: string
}

export type AssetGenerationSettings = {
  bgmPath: string
  bgmVolume: number
  bgmMode: "loop" | "once"
  voiceId: string
  ttsSpeed: number
}

export type LongFormGenerationSettings = {
  wordCount: number
  longFormPrompt: string
  llmModel: string
  llmProviderId: string
}

export const fallbackStandardSettings: StandardGenerationSettings = {
  title: "",
  scriptTemplateName: "Short Oral Script",
  scriptPrompt: "",
  scriptProviderId: "",
  scriptModel: "",
  languageScriptModels: {},
  splitTemplateName: "Copy-Safe Scene Split",
  splitPrompt: "",
  splitProviderId: "",
  splitModel: "",
  frameTemplate: "1080x1920/image_default.html",
  templateParams: {},
  mediaWorkflow: "",
  imageProvider: "comfy_workflow",
  imageModel: "",
  mediaWidth: 1080,
  mediaHeight: 1440,
  mediaDuration: 4,
  mediaPreviewPrompt: "",
  promptPrefix: "",
  imagePromptVisualContext: "",
  imagePromptGenerationRules: "",
  bgmPath: "",
  bgmVolume: 0.2,
  bgmMode: "loop",
  ttsInferenceMode: "local",
  ttsVoice: "zh-CN-YunjianNeural",
  ttsWorkflow: "",
  ttsSpeed: 1,
  ttsRefAudioPath: "",
  ttsRefAudioName: "",
}

export const fallbackAssetSettings: AssetGenerationSettings = {
  bgmPath: "",
  bgmVolume: 0.18,
  bgmMode: "loop",
  voiceId: "",
  ttsSpeed: 1,
}

export const fallbackLongFormSettings: LongFormGenerationSettings = {
  wordCount: 1800,
  longFormPrompt: "",
  llmModel: "",
  llmProviderId: "",
}

/**
 * `listTemplates()` 返回的 fixed_params 已合并持久化模板覆盖。这里把后端
 * snake_case 合同一次性适配成页面草稿，页面不再拿硬编码默认值冒充模板值。
 */
export function standardDraftForTemplate(
  template: ProductionTemplate
): GenerationDraft<StandardGenerationSettings> {
  const params = template.fixed_params
  const refAudioPath = stringParam(
    params,
    "ref_audio",
    fallbackStandardSettings.ttsRefAudioPath
  )
  return createGenerationDraft({
    title: stringParam(params, "title", fallbackStandardSettings.title),
    scriptTemplateName: stringParam(
      params,
      "script_template_name",
      fallbackStandardSettings.scriptTemplateName
    ),
    scriptPrompt: stringParam(
      params,
      "script_prompt",
      fallbackStandardSettings.scriptPrompt
    ),
    scriptProviderId: stringParam(
      params,
      "script_provider_id",
      fallbackStandardSettings.scriptProviderId
    ),
    scriptModel: stringParam(
      params,
      "script_model",
      fallbackStandardSettings.scriptModel
    ),
    languageScriptModels: recordParam(
      params,
      "language_script_models",
      fallbackStandardSettings.languageScriptModels
    ),
    splitTemplateName: stringParam(
      params,
      "split_template_name",
      fallbackStandardSettings.splitTemplateName
    ),
    splitPrompt: stringParam(
      params,
      "split_prompt",
      fallbackStandardSettings.splitPrompt
    ),
    splitProviderId: stringParam(
      params,
      "split_provider_id",
      fallbackStandardSettings.splitProviderId
    ),
    splitModel: stringParam(
      params,
      "split_model",
      fallbackStandardSettings.splitModel
    ),
    frameTemplate: stringParam(
      params,
      "frame_template",
      fallbackStandardSettings.frameTemplate
    ),
    templateParams: recordParam(
      params,
      "template_params",
      fallbackStandardSettings.templateParams
    ),
    mediaWorkflow: stringParam(
      params,
      "media_workflow",
      fallbackStandardSettings.mediaWorkflow
    ),
    imageProvider: stringParam(
      params,
      "image_provider",
      fallbackStandardSettings.imageProvider
    ),
    imageModel: stringParam(
      params,
      "image_model",
      fallbackStandardSettings.imageModel
    ),
    mediaWidth: positiveNumberParam(
      params,
      "media_width",
      fallbackStandardSettings.mediaWidth
    ),
    mediaHeight: positiveNumberParam(
      params,
      "media_height",
      fallbackStandardSettings.mediaHeight
    ),
    mediaDuration: positiveNumberParam(
      params,
      "media_duration",
      fallbackStandardSettings.mediaDuration
    ),
    mediaPreviewPrompt: fallbackStandardSettings.mediaPreviewPrompt,
    promptPrefix: stringParam(
      params,
      "prompt_prefix",
      fallbackStandardSettings.promptPrefix
    ),
    imagePromptVisualContext: stringParam(
      params,
      "image_prompt_visual_context",
      fallbackStandardSettings.imagePromptVisualContext
    ),
    imagePromptGenerationRules: stringParam(
      params,
      "image_prompt_generation_rules",
      fallbackStandardSettings.imagePromptGenerationRules
    ),
    bgmPath: stringParam(params, "bgm_path", fallbackStandardSettings.bgmPath),
    bgmVolume: numberParam(
      params,
      "bgm_volume",
      fallbackStandardSettings.bgmVolume
    ),
    bgmMode: enumParam(
      params,
      "bgm_mode",
      ["loop", "once"] as const,
      fallbackStandardSettings.bgmMode
    ),
    ttsInferenceMode: enumParam(
      params,
      "tts_inference_mode",
      ["local", "comfyui", "fish"] as const,
      fallbackStandardSettings.ttsInferenceMode
    ),
    ttsVoice: stringParam(
      params,
      "tts_voice",
      fallbackStandardSettings.ttsVoice
    ),
    ttsWorkflow: stringParam(
      params,
      "tts_workflow",
      fallbackStandardSettings.ttsWorkflow
    ),
    ttsSpeed: positiveNumberParam(
      params,
      "tts_speed",
      fallbackStandardSettings.ttsSpeed
    ),
    ttsRefAudioPath: refAudioPath,
    ttsRefAudioName: refAudioPath.split("/").pop() ?? "",
  })
}

export function assetDraftForTemplate(
  template: ProductionTemplate
): GenerationDraft<AssetGenerationSettings> {
  const params = template.fixed_params
  return createGenerationDraft({
    bgmPath: stringParam(params, "bgm_path", fallbackAssetSettings.bgmPath),
    bgmVolume: numberParam(
      params,
      "bgm_volume",
      fallbackAssetSettings.bgmVolume
    ),
    bgmMode: enumParam(
      params,
      "bgm_mode",
      ["loop", "once"] as const,
      fallbackAssetSettings.bgmMode
    ),
    voiceId: stringParam(params, "voice_id", fallbackAssetSettings.voiceId),
    ttsSpeed: positiveNumberParam(
      params,
      "tts_speed",
      fallbackAssetSettings.ttsSpeed
    ),
  })
}

export function longFormDraftForTemplate(
  template: ProductionTemplate
): GenerationDraft<LongFormGenerationSettings> {
  const params = template.fixed_params
  return createGenerationDraft({
    wordCount: positiveNumberParam(
      params,
      "word_count",
      fallbackLongFormSettings.wordCount
    ),
    longFormPrompt: stringParam(
      params,
      "long_form_prompt",
      fallbackLongFormSettings.longFormPrompt
    ),
    llmModel: stringParam(
      params,
      "llm_model",
      fallbackLongFormSettings.llmModel
    ),
    llmProviderId: stringParam(
      params,
      "llm_provider_id",
      fallbackLongFormSettings.llmProviderId
    ),
  })
}

const STANDARD_API_KEYS: Partial<
  Record<keyof StandardGenerationSettings, string>
> = {
  title: "title",
  scriptTemplateName: "script_template_name",
  scriptPrompt: "script_prompt",
  scriptProviderId: "script_provider_id",
  scriptModel: "script_model",
  languageScriptModels: "language_script_models",
  splitTemplateName: "split_template_name",
  splitPrompt: "split_prompt",
  splitProviderId: "split_provider_id",
  splitModel: "split_model",
  frameTemplate: "frame_template",
  templateParams: "template_params",
  mediaWorkflow: "media_workflow",
  imageProvider: "image_provider",
  imageModel: "image_model",
  mediaWidth: "media_width",
  mediaHeight: "media_height",
  promptPrefix: "prompt_prefix",
  imagePromptVisualContext: "image_prompt_visual_context",
  imagePromptGenerationRules: "image_prompt_generation_rules",
  bgmPath: "bgm_path",
  bgmVolume: "bgm_volume",
  bgmMode: "bgm_mode",
  ttsInferenceMode: "tts_inference_mode",
  ttsVoice: "tts_voice",
  ttsWorkflow: "tts_workflow",
  ttsSpeed: "tts_speed",
  ttsRefAudioPath: "ref_audio",
}

const ASSET_API_KEYS: Record<keyof AssetGenerationSettings, string> = {
  bgmPath: "bgm_path",
  bgmVolume: "bgm_volume",
  bgmMode: "bgm_mode",
  voiceId: "voice_id",
  ttsSpeed: "tts_speed",
}

const LONG_FORM_API_KEYS: Record<keyof LongFormGenerationSettings, string> = {
  wordCount: "word_count",
  longFormPrompt: "long_form_prompt",
  llmModel: "llm_model",
  llmProviderId: "llm_provider_id",
}

export function standardOverridesToInput(
  template: ProductionTemplate,
  overrides: Partial<StandardGenerationSettings>
) {
  return mapAllowedOverrides(template, overrides, STANDARD_API_KEYS)
}

export function assetOverridesToInput(
  template: ProductionTemplate,
  overrides: Partial<AssetGenerationSettings>
) {
  return mapAllowedOverrides(template, overrides, ASSET_API_KEYS)
}

export function longFormOverridesToInput(
  template: ProductionTemplate,
  overrides: Partial<LongFormGenerationSettings>
) {
  return mapAllowedOverrides(template, overrides, LONG_FORM_API_KEYS)
}

export function standardSettingsToParams(
  settings: StandardGenerationSettings
): Record<string, unknown> {
  return settingsToParams(settings, STANDARD_API_KEYS)
}

export function standardParamPatch(
  key: string,
  value: unknown
): Partial<StandardGenerationSettings> {
  return paramPatch<StandardGenerationSettings>(key, value, STANDARD_API_KEYS)
}

export function standardDirtyParamKeys(
  keys: Array<keyof StandardGenerationSettings>
): string[] {
  return settingKeysToParamKeys(keys, STANDARD_API_KEYS)
}

export function assetSettingsToParams(
  settings: AssetGenerationSettings
): Record<string, unknown> {
  return settingsToParams(settings, ASSET_API_KEYS)
}

export function assetParamPatch(
  key: string,
  value: unknown
): Partial<AssetGenerationSettings> {
  return paramPatch<AssetGenerationSettings>(key, value, ASSET_API_KEYS)
}

export function assetDirtyParamKeys(
  keys: Array<keyof AssetGenerationSettings>
): string[] {
  return settingKeysToParamKeys(keys, ASSET_API_KEYS)
}

export function longFormSettingsToParams(
  settings: LongFormGenerationSettings
): Record<string, unknown> {
  return settingsToParams(settings, LONG_FORM_API_KEYS)
}

export function longFormParamPatch(
  key: string,
  value: unknown
): Partial<LongFormGenerationSettings> {
  return paramPatch<LongFormGenerationSettings>(key, value, LONG_FORM_API_KEYS)
}

export function longFormDirtyParamKeys(
  keys: Array<keyof LongFormGenerationSettings>
): string[] {
  return settingKeysToParamKeys(keys, LONG_FORM_API_KEYS)
}

function settingsToParams<T extends Record<string, unknown>>(
  settings: T,
  apiKeys: Partial<Record<keyof T, string>>
): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const [rawKey, value] of Object.entries(settings)) {
    const apiKey = apiKeys[rawKey as keyof T]
    if (apiKey) params[apiKey] = value
  }
  return params
}

function paramPatch<T extends Record<string, unknown>>(
  apiKey: string,
  value: unknown,
  apiKeys: Partial<Record<keyof T, string>>
): Partial<T> {
  const entry = Object.entries(apiKeys).find(([, key]) => key === apiKey)
  if (!entry) return {}
  return { [entry[0]]: value } as Partial<T>
}

function settingKeysToParamKeys<T extends Record<string, unknown>>(
  keys: Array<keyof T>,
  apiKeys: Partial<Record<keyof T, string>>
): string[] {
  return keys.flatMap((key) => {
    const apiKey = apiKeys[key]
    return apiKey ? [apiKey] : []
  })
}

function mapAllowedOverrides<T extends Record<string, unknown>>(
  template: ProductionTemplate,
  overrides: Partial<T>,
  apiKeys: Partial<Record<keyof T, string>>
) {
  const allowed = new Set(template.allowed_user_params)
  const input: Record<string, unknown> = {}
  for (const [rawKey, value] of Object.entries(overrides)) {
    const key = rawKey as keyof T
    const apiKey = apiKeys[key]
    if (!apiKey || !allowed.has(apiKey)) {
      continue
    }
    input[apiKey] = normalizeOverrideValue(value)
  }
  return input
}

function normalizeOverrideValue(value: unknown) {
  if (typeof value !== "string") {
    return value
  }
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

function stringParam(
  params: Record<string, unknown>,
  key: string,
  fallback: string
) {
  return typeof params[key] === "string" ? params[key] : fallback
}

function numberParam(
  params: Record<string, unknown>,
  key: string,
  fallback: number
) {
  const value = Number(params[key])
  return Number.isFinite(value) ? value : fallback
}

function positiveNumberParam(
  params: Record<string, unknown>,
  key: string,
  fallback: number
) {
  const value = numberParam(params, key, fallback)
  return value > 0 ? value : fallback
}

function enumParam<const T extends readonly string[]>(
  params: Record<string, unknown>,
  key: string,
  values: T,
  fallback: T[number]
) {
  const value = params[key]
  return typeof value === "string" && values.includes(value)
    ? (value as T[number])
    : fallback
}

function recordParam<T extends Record<string, unknown>>(
  params: Record<string, unknown>,
  key: string,
  fallback: T
) {
  const value = params[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback
  }
  return value as T
}
