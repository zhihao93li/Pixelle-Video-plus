type ImportMetaWithEnv = ImportMeta & {
  env?: {
    VITE_PIXELLE_API_BASE_URL?: string
  }
}

export const API_BASE_URL =
  (import.meta as ImportMetaWithEnv).env?.VITE_PIXELLE_API_BASE_URL ??
  "http://127.0.0.1:8000/api"

export type GenerationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"

export type ProductionTemplate = {
  id: string
  version: string
  display_name: string
  description: string
  project: string | null
  channel: string | null
  use_case: string
  runtime_label: string
  estimated_turnaround: string
  failure_guidance: string
  requires_user_assets: boolean
  advanced_controls_hidden: boolean
  template_tags: string[]
  input_requirements: string[]
  quality_tier: string
  pipeline_id: string
  entry: string
  fixed_params: Record<string, unknown>
  required_capabilities: string[]
  user_selectable_runtime: boolean
  user_selectable_providers: string[]
  enabled: boolean
  /** 代码层退役标记：已退役的内置预设（只读、不可复活、归入「已退役」分组）。 */
  retired: boolean
  migration_status: "ready" | "partial" | "legacy_only" | "planned"
  product_entry: string
  streamlit_source: string | null
  migration_notes: string
  allowed_user_params: string[]
  passthrough_input_fields: string[]
  is_custom?: boolean
}

export type TemplateListResponse = {
  default_template: string | null
  templates: ProductionTemplate[]
}

export type GenerationProgress = {
  stage: string
  percentage: number
  message: string
  current: number | null
  total: number | null
  detail: Record<string, unknown>
}

export type GenerationError = {
  layer: string
  message: string
  exception_type: string | null
  detail: Record<string, unknown>
}

export type GenerationTask = {
  task_id: string
  pipeline_id: string
  entry: string
  status: GenerationStatus
  progress: GenerationProgress
  error: GenerationError | null
  created_at: string
  updated_at: string
}

export type GenerationArtifact = {
  kind: string
  path: string
  url: string | null
  media_type: string | null
  role: string | null
  metadata: Record<string, unknown>
}

export type GenerationResult = {
  task_id: string
  pipeline_id: string
  entry: string
  status: "completed"
  // 产物形态：video（默认）/ image_set（图文帖图集）/ text（长文）。旧数据无此字段 → 按 video 处理
  artifact_type?: "video" | "image_set" | "text"
  artifacts: GenerationArtifact[]
  // 图集产物没有主视频；读取前先判 artifact_type / 判空
  primary_video: GenerationArtifact | null
  duration: number | null
  file_size: number | null
  storyboard_path: string | null
  metadata: Record<string, unknown>
}

export type GenerationBatchItem = {
  index: number
  input: Record<string, unknown>
  params: Record<string, unknown>
  metadata: Record<string, unknown>
  task_id: string | null
  status: string
  progress: GenerationProgress | null
  error: GenerationError | null
}

export type GenerationBatch = {
  batch_id: string
  template_id: string
  status: string
  total_count: number
  submitted_count: number
  failed_count: number
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
  items: GenerationBatchItem[]
}

export type GenerationBatchListResponse = {
  batches: GenerationBatch[]
}

export type GenerationBatchCreateInput = {
  templateId: string
  items: Array<{
    input: Record<string, unknown>
    metadata?: Record<string, unknown>
    idempotencyKey?: string
  }>
  metadata?: Record<string, unknown>
  idempotencyKey?: string
  projectId?: string
}

export type ScriptReviewPromptTemplate = {
  name: string
  content: string
  source: string
}

export type ScriptReviewTemplateListResponse = {
  default_languages: string[]
  script_templates: ScriptReviewPromptTemplate[]
  split_templates: ScriptReviewPromptTemplate[]
}

export type ScriptReviewLanguageDraft = {
  title: string
  script: string
  narrations: string[]
}

export type ScriptReviewDraft = {
  index?: number
  topic: string
  title?: string
  language_drafts?: Record<string, ScriptReviewLanguageDraft>
  selected_languages?: string[]
  selected_for_generation?: boolean
  script_model?: string
  split_model?: string
  workflow_mode?: string
  [key: string]: unknown
}

/** 草稿集溯源字段（读取时收窄；其余字段仍为 unknown）。 */
export type DraftSetSettings = {
  drafting_profile_name?: string
  script_model?: string
  script_template_name?: string
  project_id?: string
}

export type ScriptReviewDraftSet = {
  draft_set_id: string
  status: string
  created_at: string
  updated_at: string
  topics: string[]
  languages: string[]
  metadata: Record<string, unknown>
  draft_settings: Record<string, unknown>
  drafts: ScriptReviewDraft[]
  errors: Array<Record<string, unknown>>
  submissions: Array<Record<string, unknown>>
}

export type ScriptReviewDraftSetListResponse = {
  draft_sets: ScriptReviewDraftSet[]
}

export type ScriptReviewCreateInput = {
  topics: string[]
  languages: string[]
  projectId?: string
  draftingProfileId?: string
  scriptTemplateName?: string
  splitTemplateName?: string
  scriptModel?: string
  splitModel?: string
  languageScriptTemplates?: Record<string, string>
  languageScriptModels?: Record<string, string>
  metadata?: Record<string, unknown>
  idempotencyKey?: string
}

export type ScriptReviewUpdateInput = {
  drafts: ScriptReviewDraft[]
  metadata?: Record<string, unknown>
}

export type ScriptReviewSubmitInput = {
  drafts?: ScriptReviewDraft[]
  templateId?: string
  baseParams?: Record<string, unknown>
  languageTtsOverrides?: Record<string, Record<string, unknown>>
  metadata?: Record<string, unknown>
  idempotencyKey?: string
}

export type ScriptReviewSubmitResponse = {
  draft_set: ScriptReviewDraftSet
  batch: GenerationBatch
}

export type GenerationSubmitResponse = {
  success: boolean
  message: string
  generation_task_id: string
  task: GenerationTask
}

export type UploadedGenerationAsset = {
  original_filename: string
  filename: string
  path: string
  kind: "image" | "video" | "audio" | string
  content_type: string | null
  size: number
}

export type GenerationAssetUploadResponse = {
  count: number
  assets: UploadedGenerationAsset[]
}

export type TtsPreviewInput = {
  text: string
  inferenceMode?: "local" | "comfyui" | "fish"
  workflow?: string
  refAudio?: string
  voiceId?: string
  referenceId?: string
  speed?: number
  fishModel?: "s1" | "s2-pro"
}

export type TtsPreviewResponse = {
  success: boolean
  message: string
  audio_path: string
  duration: number
}

export type FramePreviewInput = {
  template: string
  title?: string
  text: string
  image?: string
  templateParams?: Record<string, unknown>
}

export type FramePreviewResponse = {
  success: boolean
  message: string
  frame_path: string
  width: number
  height: number
}

export type MediaPreviewInput = {
  prompt: string
  workflow?: string
  mediaType: "image" | "video"
  width: number
  height: number
  duration?: number
}

export type MediaPreviewResponse = {
  success: boolean
  message: string
  media_type: "image" | "video"
  media_path: string
  duration: number | null
}

export type TemplateParamConfig = {
  type: string
  default: unknown
  label: string
}

export type TemplateParamsResponse = {
  success: boolean
  message: string
  template: string
  media_width: number
  media_height: number
  params: Record<string, TemplateParamConfig>
}

export type HistoryTaskSummary = {
  task_id: string
  status: GenerationStatus | string
  title?: string | null
  created_at?: string | null
  completed_at?: string | null
  result?: Record<string, unknown> | null
  input?: Record<string, unknown> | null
}

export type HistoryTaskListResponse = {
  tasks: HistoryTaskSummary[]
  total: number
  page: number
  page_size: number
  total_pages?: number
}

export type HistoryTaskDetail = {
  metadata: Record<string, unknown>
  storyboard: Record<string, unknown> | null
  generation_summary: Record<string, unknown>
}

export type HistoryStatistics = {
  total_tasks?: number
  completed?: number
  failed?: number
  [key: string]: unknown
}

export type PublishPlatform = {
  id: string
  label: string
}

export type PublishPlatformListResponse = {
  platforms: PublishPlatform[]
}

export type PublishTimezoneListResponse = {
  default_timezone: string
  timezones: string[]
}

export type PublishJob = {
  platform: string
  status: string
  buffer_channel_id?: string | null
  public_video_url?: string | null
  buffer_post_id?: string | null
  due_at?: string | null
  error?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export type PublishRecord = {
  task_id: string
  title?: string | null
  caption?: string | null
  public_video_url?: string | null
  jobs?: PublishJob[]
  created_at?: string | null
  updated_at?: string | null
  [key: string]: unknown
}

export type PublishRecordResponse = {
  task_id: string
  record: PublishRecord | null
}

export type PublishCheck = {
  name: string
  ok: boolean
  message: string
}

export type PublishCheckResponse = {
  checks: PublishCheck[]
}

export type PublishTaskInput = {
  platforms: string[]
  caption: string
  title?: string
  dueAt?: string | null
}

export type PublishTaskResponse = {
  task_id: string
  record: PublishRecord
}

export type AppSettingsConfig = {
  project_name?: string
  llm: {
    api_key: string
    base_url: string
    model: string
  }
  comfyui: {
    comfyui_url: string
    comfyui_api_key?: string | null
    runninghub_api_key?: string | null
    runninghub_concurrent_limit: number
    runninghub_instance_type?: string | null
    runninghub_timeout?: number | null
    tts: {
      inference_mode?: string
      fish_audio: {
        api_key: string
        base_url: string
        model: "s1" | "s2-pro"
        reference_id?: string | null
      }
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  publish: {
    buffer: {
      api_key: string
      channels: Record<string, string>
    }
    cos: {
      region: string
      bucket: string
      secret_id: string
      secret_key: string
      public_base_url: string
      endpoint_url?: string | null
    }
  }
  [key: string]: unknown
}

export type SettingsConfigResponse = {
  configured: boolean
  config: AppSettingsConfig
}

export type SettingsDiagnosticCheck = {
  id: string
  label: string
  ok: boolean
  severity: "info" | "warning" | "error"
  message: string
}

export type SettingsDiagnosticsResponse = {
  ok: boolean
  checks: SettingsDiagnosticCheck[]
}

export type SettingsConfigUpdate = Partial<{
  llm: Partial<AppSettingsConfig["llm"]>
  comfyui: Partial<AppSettingsConfig["comfyui"]>
  publish: Partial<AppSettingsConfig["publish"]>
}>

export type ResourceWorkflow = {
  name: string
  display_name: string
  source: string
  path: string
  key: string
  workflow_id?: string | null
}

export type ResourceTemplate = {
  name: string
  display_name: string
  size: string
  width: number
  height: number
  orientation: string
  path: string
  key: string
}

export type ResourceBgm = {
  name: string
  path: string
  source: string
}

export type ResourceBgmUploadResponse = {
  success: boolean
  message: string
  bgm_file: ResourceBgm
  bgm_files: ResourceBgm[]
}

export type LlmModelListResponse = {
  models: string[]
}

export type LlmConnectionResponse = {
  ok: boolean
  message: string
  model_count: number
}

export type ComfyuiConnectionResponse = {
  ok: boolean
  message: string
}

export type RunninghubWorkflow = {
  filename: string
  key: string
  path: string
  workflow_id: string
}

export type RunninghubWorkflowCreateInput = {
  kind: "video" | "image" | "tts"
  name: string
  workflowId: string
  overwrite: boolean
}

export type RunninghubWorkflowListResponse = {
  workflows: RunninghubWorkflow[]
}

export type RunninghubWorkflowCreateResponse = {
  workflow: RunninghubWorkflow
  workflows: RunninghubWorkflow[]
}

export type BufferChannel = {
  id: string | null
  name: string | null
  displayName: string | null
  service: string | null
  isQueuePaused: boolean | null
}

export type BufferChannelsResponse = {
  channels: BufferChannel[]
  detected_channels: Record<string, string>
}

export type FaqSection = {
  question: string
  answer: string
}

export type FaqResponse = {
  language: string
  content: string
  sections: FaqSection[]
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(message: string, status: number, detail: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

export async function listTemplates(projectId?: string) {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : ""
  return fetchJson<TemplateListResponse>(`/generation/templates${query}`)
}

export type TemplateGenerationConfig = {
  template_id: string
  overridable_keys: string[]
  overrides: Record<string, unknown>
  effective_params: Record<string, unknown>
}

export async function getTemplateGenerationConfig(templateId: string) {
  return fetchJson<TemplateGenerationConfig>(
    `/generation/templates/${templateId}/generation-config`
  )
}

export async function updateTemplateGenerationConfig(
  templateId: string,
  overrides: Record<string, unknown>
) {
  return fetchJson<TemplateGenerationConfig>(
    `/generation/templates/${templateId}/generation-config`,
    {
      method: "PUT",
      body: JSON.stringify({ overrides }),
    }
  )
}

export type CloneProductionTemplateInput = {
  sourceTemplateId: string
  id: string
  displayName: string
  description?: string
  fixedParamsPatch?: Record<string, unknown>
}

export async function cloneProductionTemplate(input: CloneProductionTemplateInput) {
  return fetchJson<ProductionTemplate>("/generation/templates", {
    method: "POST",
    body: JSON.stringify({
      source_template_id: input.sourceTemplateId,
      id: input.id,
      display_name: input.displayName,
      description: input.description ?? null,
      fixed_params_patch: input.fixedParamsPatch ?? {},
    }),
  })
}

export async function deleteProductionTemplate(templateId: string) {
  return fetchJson<{ deleted: boolean; id: string }>(
    `/generation/templates/${templateId}`,
    { method: "DELETE" }
  )
}

/** 用户侧启用/停用模板（退役的内置模板不可启用；被项目默认引用的不可停用）。 */
export async function setTemplateEnabled(templateId: string, enabled: boolean) {
  return fetchJson<ProductionTemplate>(
    `/generation/templates/${templateId}/enabled`,
    {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }
  )
}

export async function createGenerationTemplateTask(
  templateId: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown> = { source: "react_p8_demo" },
  projectId?: string
) {
  return fetchJson<GenerationSubmitResponse>(
    `/generation/templates/${templateId}/tasks`,
    {
      method: "POST",
      body: JSON.stringify({
        input,
        metadata: projectId ? { ...metadata, project_id: projectId } : metadata,
      }),
    }
  )
}

export async function createDailyVideoTask(templateId: string, script: string) {
  return createGenerationTemplateTask(
    templateId,
    { script },
    { source: "react_p0_demo" }
  )
}

export async function createGenerationBatch(input: GenerationBatchCreateInput) {
  const metadata = input.projectId
    ? { ...(input.metadata ?? {}), project_id: input.projectId }
    : (input.metadata ?? {})
  return fetchJson<GenerationBatch>("/generation/batches", {
    method: "POST",
    body: JSON.stringify({
      template_id: input.templateId,
      items: input.items.map((item) => ({
        input: item.input,
        metadata: item.metadata ?? {},
        idempotency_key: item.idempotencyKey ?? null,
      })),
      metadata,
      idempotency_key: input.idempotencyKey ?? null,
    }),
  })
}

export async function getGenerationBatch(batchId: string) {
  return fetchJson<GenerationBatch>(`/generation/batches/${batchId}`)
}

export async function retryGenerationBatchItem(batchId: string, itemIndex: number) {
  return fetchJson<GenerationBatch>(
    `/generation/batches/${batchId}/items/${itemIndex}/retry`,
    { method: "POST" }
  )
}

export async function listGenerationBatches() {
  return fetchJson<GenerationBatchListResponse>("/generation/batches")
}

export async function listScriptReviewTemplates() {
  return fetchJson<ScriptReviewTemplateListResponse>(
    "/generation/script-review/templates"
  )
}

export async function createScriptReviewDraftSet(input: ScriptReviewCreateInput) {
  return fetchJson<ScriptReviewDraftSet>("/generation/script-review/draft-sets", {
    method: "POST",
    body: JSON.stringify({
      topics: input.topics,
      languages: input.languages,
      project_id: input.projectId ?? null,
      drafting_profile_id: input.draftingProfileId ?? null,
      script_template_name: input.scriptTemplateName || null,
      split_template_name: input.splitTemplateName || null,
      script_model: input.scriptModel || null,
      split_model: input.splitModel || null,
      language_script_templates: input.languageScriptTemplates ?? {},
      language_script_models: input.languageScriptModels ?? {},
      metadata: input.metadata ?? {},
      idempotency_key: input.idempotencyKey ?? null,
    }),
  })
}

export async function listScriptReviewDraftSets(projectId?: string) {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : ""
  return fetchJson<ScriptReviewDraftSetListResponse>(
    `/generation/script-review/draft-sets${query}`
  )
}

export async function getScriptReviewDraftSet(draftSetId: string) {
  return fetchJson<ScriptReviewDraftSet>(
    `/generation/script-review/draft-sets/${draftSetId}`
  )
}

export async function updateScriptReviewDraftSet(
  draftSetId: string,
  input: ScriptReviewUpdateInput
) {
  return fetchJson<ScriptReviewDraftSet>(
    `/generation/script-review/draft-sets/${draftSetId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        drafts: input.drafts,
        metadata: input.metadata ?? {},
      }),
    }
  )
}

export async function submitScriptReviewDraftSetTasks(
  draftSetId: string,
  input: ScriptReviewSubmitInput
) {
  return fetchJson<ScriptReviewSubmitResponse>(
    `/generation/script-review/draft-sets/${draftSetId}/tasks`,
    {
      method: "POST",
      body: JSON.stringify({
        drafts: input.drafts ?? null,
        template_id: input.templateId ?? null,
        base_params: input.baseParams ?? {},
        language_tts_overrides: input.languageTtsOverrides ?? {},
        metadata: input.metadata ?? {},
        idempotency_key: input.idempotencyKey ?? null,
      }),
    }
  )
}

// ---------------------------------------------------------------------------
// ContentItem（内容工作台看板）
// ---------------------------------------------------------------------------

export type ContentVariantStatus = "pending" | "confirmed" | "rejected"

export type ContentVariant = {
  language: string
  status: ContentVariantStatus
  title: string
  script: string
  narrations: string[]
}

export type ContentEvent = {
  type: string
  actor: string
  at: string
  detail: Record<string, unknown>
}

export type ContentItemLinks = {
  draft_set_id?: string | null
  draft_index?: number
  task_ids?: string[]
  batch_ids?: string[]
  publish_record_ids?: string[]
  [key: string]: unknown
}

export type ContentItemMetrics = {
  likes?: number
  favorites?: number
  comments?: number
  note?: string
  recorded_at?: string
  [key: string]: unknown
}

export type ContentItem = {
  item_id: string
  project: string
  channel: string
  title: string
  kind: "text" | "asset"
  source: "manual" | "agent" | "derived"
  status: string
  languages: string[]
  variants: Record<string, ContentVariant>
  asset_paths: string[]
  links: ContentItemLinks
  metrics: ContentItemMetrics
  automation: Record<string, unknown>
  events: ContentEvent[]
  created_at: string
  updated_at: string
}

export type CreateContentItemsInput = {
  titles: string[]
  kind?: "text" | "asset"
  languages?: string[]
  source?: "manual" | "agent" | "derived"
  initialStatus?: "idea" | "confirmed"
  scripts?: string[]
  assetPaths?: string[]
  projectId?: string
}

export type PatchContentItemInput = {
  title?: string
  languages?: string[]
  variants?: Record<string, Partial<ContentVariant>>
  assetPaths?: string[]
  metrics?: Record<string, unknown>
  links?: Record<string, unknown>
}

export type ImportExistingResponse = {
  created: number
  skipped: number
}

export async function listContentItems(params?: {
  status?: string
  limit?: number
  project?: string
}) {
  const search = new URLSearchParams()
  if (params?.status) {
    search.set("status", params.status)
  }
  if (params?.project) {
    search.set("project", params.project)
  }
  if (params?.limit != null) {
    search.set("limit", String(params.limit))
  }
  const query = search.toString()
  return fetchJson<ContentItem[]>(`/content-items${query ? `?${query}` : ""}`)
}

export async function getContentItem(itemId: string) {
  return fetchJson<ContentItem>(`/content-items/${itemId}`)
}

export async function createContentItems(input: CreateContentItemsInput) {
  return fetchJson<ContentItem[]>("/content-items", {
    method: "POST",
    body: JSON.stringify({
      titles: input.titles,
      kind: input.kind ?? "text",
      languages: input.languages ?? null,
      source: input.source ?? "manual",
      initial_status: input.initialStatus ?? "idea",
      scripts: input.scripts ?? null,
      asset_paths: input.assetPaths ?? null,
      project_id: input.projectId ?? null,
    }),
  })
}

export async function patchContentItem(
  itemId: string,
  input: PatchContentItemInput
) {
  return fetchJson<ContentItem>(`/content-items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: input.title ?? null,
      languages: input.languages ?? null,
      variants: input.variants ?? null,
      asset_paths: input.assetPaths ?? null,
      metrics: input.metrics ?? null,
      links: input.links ?? null,
    }),
  })
}

export async function transitionContentItem(
  itemId: string,
  to: string,
  detail: Record<string, unknown> = {},
  actor: string = "user"
) {
  return fetchJson<ContentItem>(`/content-items/${itemId}/transition`, {
    method: "POST",
    body: JSON.stringify({ to, actor, detail }),
  })
}

export async function deleteContentItem(itemId: string) {
  return fetchJson<{ deleted: boolean; item_id: string }>(
    `/content-items/${itemId}`,
    { method: "DELETE" }
  )
}

export async function importExistingContentItems() {
  return fetchJson<ImportExistingResponse>("/content-items/import-existing", {
    method: "POST",
  })
}

export async function uploadGenerationAssets(files: File[]) {
  const formData = new FormData()
  for (const file of files) {
    formData.append("files", file, file.name)
  }

  return fetchApi<GenerationAssetUploadResponse>("/generation/assets", {
    method: "POST",
    body: formData,
  })
}

export async function uploadResourceBgm(file: File) {
  const formData = new FormData()
  formData.append("file", file, file.name)

  return fetchApi<ResourceBgmUploadResponse>("/resources/bgm/upload", {
    method: "POST",
    body: formData,
  })
}

export async function synthesizeTtsPreview(input: TtsPreviewInput) {
  return fetchJson<TtsPreviewResponse>("/tts/synthesize", {
    method: "POST",
    body: JSON.stringify({
      text: input.text,
      inference_mode: input.inferenceMode,
      workflow: input.workflow || undefined,
      ref_audio: input.refAudio || undefined,
      voice_id: input.voiceId || undefined,
      reference_id: input.referenceId || undefined,
      speed: input.speed,
      fish_model: input.fishModel,
    }),
  })
}

export async function renderFramePreview(input: FramePreviewInput) {
  return fetchJson<FramePreviewResponse>("/frame/render", {
    method: "POST",
    body: JSON.stringify({
      template: input.template,
      title: input.title || undefined,
      text: input.text,
      image: input.image || undefined,
      template_params: input.templateParams ?? {},
    }),
  })
}

export async function generateMediaPreview(input: MediaPreviewInput) {
  return fetchJson<MediaPreviewResponse>("/media/generate", {
    method: "POST",
    body: JSON.stringify({
      prompt: input.prompt,
      workflow: input.workflow || undefined,
      media_type: input.mediaType,
      width: input.width,
      height: input.height,
      duration: input.mediaType === "video" ? input.duration : undefined,
    }),
  })
}

export async function getFrameTemplateParams(template: string) {
  const params = new URLSearchParams()
  params.set("template", template)
  return fetchJson<TemplateParamsResponse>(
    `/frame/template/params?${params.toString()}`
  )
}

export async function getTask(taskId: string) {
  return fetchJson<GenerationTask>(`/generation/tasks/${taskId}`)
}

export async function cancelGenerationTask(taskId: string) {
  return fetchJson<GenerationTask>(`/generation/tasks/${taskId}`, {
    method: "DELETE",
  })
}

export async function getTaskResult(taskId: string) {
  return fetchJson<GenerationResult>(`/generation/tasks/${taskId}/result`)
}

export async function listHistoryTasks({
  page = 1,
  pageSize = 20,
  status,
  sortBy = "created_at",
  sortOrder = "desc",
}: {
  page?: number
  pageSize?: number
  status?: string
  sortBy?: string
  sortOrder?: "asc" | "desc"
} = {}) {
  const params = new URLSearchParams()
  params.set("page", String(page))
  params.set("page_size", String(pageSize))
  if (status && status !== "all") {
    params.set("status", status)
  }
  params.set("sort_by", sortBy)
  params.set("sort_order", sortOrder)
  return fetchJson<HistoryTaskListResponse>(`/history/tasks?${params.toString()}`)
}

export async function getHistoryTaskDetail(taskId: string) {
  return fetchJson<HistoryTaskDetail>(`/history/tasks/${taskId}`)
}

export async function getHistoryStatistics() {
  return fetchJson<HistoryStatistics>("/history/statistics")
}

export async function deleteHistoryTask(taskId: string) {
  return fetchJson<{ deleted: boolean; task_id: string }>(
    `/history/tasks/${taskId}`,
    { method: "DELETE" }
  )
}

export async function listPublishPlatforms() {
  return fetchJson<PublishPlatformListResponse>("/publish/platforms")
}

export async function listPublishTimezones() {
  return fetchJson<PublishTimezoneListResponse>("/publish/timezones")
}

export async function getPublishRecord(taskId: string) {
  return fetchJson<PublishRecordResponse>(`/publish/tasks/${taskId}/record`)
}

export async function checkPublishConfiguration(platforms: string[]) {
  return fetchJson<PublishCheckResponse>("/publish/check", {
    method: "POST",
    body: JSON.stringify({ platforms }),
  })
}

export async function publishTask(taskId: string, input: PublishTaskInput) {
  return fetchJson<PublishTaskResponse>(`/publish/tasks/${taskId}`, {
    method: "POST",
    body: JSON.stringify({
      platforms: input.platforms,
      caption: input.caption,
      title: input.title ?? "",
      due_at: input.dueAt || null,
    }),
  })
}

export async function getSettingsConfig() {
  return fetchJson<SettingsConfigResponse>("/settings/config")
}

export async function getSettingsDiagnostics() {
  return fetchJson<SettingsDiagnosticsResponse>("/settings/diagnostics")
}

export async function updateSettingsConfig(updates: SettingsConfigUpdate) {
  return fetchJson<SettingsConfigResponse>("/settings/config", {
    method: "PUT",
    body: JSON.stringify(updates),
  })
}

export async function resetSettingsConfig() {
  return fetchJson<SettingsConfigResponse>("/settings/config/reset", {
    method: "POST",
  })
}

export async function loadLlmModels(apiKey: string, baseUrl: string) {
  return fetchJson<LlmModelListResponse>("/settings/llm/models", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey, base_url: baseUrl }),
  })
}

export async function testLlmConnection(apiKey: string, baseUrl: string) {
  return fetchJson<LlmConnectionResponse>("/settings/llm/test", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey, base_url: baseUrl }),
  })
}

export async function testComfyuiConnection(comfyuiUrl: string) {
  return fetchJson<ComfyuiConnectionResponse>("/settings/comfyui/test", {
    method: "POST",
    body: JSON.stringify({ comfyui_url: comfyuiUrl }),
  })
}

export async function listRunninghubWorkflows() {
  return fetchJson<RunninghubWorkflowListResponse>(
    "/settings/runninghub/workflows"
  )
}

export async function addRunninghubWorkflow(
  input: RunninghubWorkflowCreateInput
) {
  return fetchJson<RunninghubWorkflowCreateResponse>(
    "/settings/runninghub/workflows",
    {
      method: "POST",
      body: JSON.stringify({
        kind: input.kind,
        name: input.name,
        workflow_id: input.workflowId,
        overwrite: input.overwrite,
      }),
    }
  )
}

export async function fetchBufferChannels(apiKey: string) {
  return fetchJson<BufferChannelsResponse>("/settings/buffer/channels", {
    method: "POST",
    body: JSON.stringify({ api_key: apiKey }),
  })
}

export async function getHelpFaq(language = "zh_CN") {
  const params = new URLSearchParams()
  params.set("language", language)
  return fetchJson<FaqResponse>(`/help/faq?${params.toString()}`)
}

export async function listResourceBgm() {
  return fetchJson<{ bgm_files: ResourceBgm[] }>("/resources/bgm")
}

export function resourceFileUrl(path: string | null | undefined) {
  if (!path) {
    return null
  }
  if (/^https?:\/\//.test(path)) {
    return path
  }
  const encodedPath = path
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")
  return `${API_BASE_URL.replace(/\/$/, "")}/files/${encodedPath}`
}

export async function listResourceTemplates() {
  return fetchJson<{ templates: ResourceTemplate[] }>("/resources/templates")
}

export async function listResourceMediaWorkflows() {
  return fetchJson<{ workflows: ResourceWorkflow[] }>("/resources/workflows/media")
}

export async function listResourceTtsWorkflows() {
  return fetchJson<{ workflows: ResourceWorkflow[] }>("/resources/workflows/tts")
}

export function artifactFileUrl(artifact: GenerationArtifact | null | undefined) {
  if (!artifact) {
    return null
  }

  if (artifact.url) {
    return artifact.url
  }

  return fileUrlFromPath(artifact.path)
}

export function fileUrlFromPath(path: string | null | undefined) {
  if (!path) {
    return null
  }

  const relativePath = outputRelativePath(path)
  if (!relativePath) {
    return null
  }

  return `${API_BASE_URL.replace(/\/$/, "")}/files/${relativePath}`
}

export function isTerminalStatus(status: GenerationStatus) {
  return status === "completed" || status === "failed" || status === "cancelled"
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  return fetchApi<T>(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL.replace(/\/$/, "")}${path}`, {
      ...init,
    })
  } catch (error) {
    throw new ApiError(
      "无法连接 Pixelle API。请确认 http://127.0.0.1:8000 正在运行。",
      0,
      error instanceof Error ? error.message : error
    )
  }

  const text = await response.text()
  const data = text ? safeJson(text) : null

  if (!response.ok) {
    throw new ApiError(errorMessage(data, response.statusText), response.status, data)
  }

  return data as T
}

function safeJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessage(data: unknown, fallback: string) {
  if (typeof data === "object" && data && "detail" in data) {
    const detail = (data as { detail?: unknown }).detail
    if (typeof detail === "string") {
      return detail
    }
    return JSON.stringify(detail)
  }

  if (typeof data === "string") {
    return data
  }

  return fallback || "请求失败"
}

function outputRelativePath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const outputMarker = "/output/"
  const markerIndex = normalized.indexOf(outputMarker)

  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + outputMarker.length)
  }

  if (normalized.startsWith("output/")) {
    return normalized.slice("output/".length)
  }

  return null
}


// ---------------------------------------------------------------------------
// 起草配方（DraftingProfile）与 Prompt 模板自助管理
// ---------------------------------------------------------------------------

export type DraftingProfile = {
  profile_id: string
  name: string
  script_template_name: string
  split_template_name: string
  script_model: string
  split_model: string
  languages: string[]
  language_script_models: Record<string, string>
  project_id: string
  created_at: string
  updated_at: string
}

export type DraftingProfileListResponse = {
  default_profile_id: string | null
  profiles: DraftingProfile[]
}

export type DraftingProfileInput = {
  name: string
  script_template_name: string
  split_template_name: string
  script_model?: string
  split_model?: string
  languages?: string[]
  language_script_models?: Record<string, string>
}

export async function listDraftingProfiles() {
  return fetchJson<DraftingProfileListResponse>("/drafting/profiles")
}

export async function updateDraftingProfile(
  profileId: string,
  patch: Partial<DraftingProfileInput>
) {
  return fetchJson<DraftingProfile>(`/drafting/profiles/${profileId}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  })
}

export type PromptTemplateWriteInput = {
  kind: "script" | "split"
  name: string
  content: string
}

export async function createPromptTemplate(input: PromptTemplateWriteInput) {
  return fetchJson<{ kind: string; name: string }>("/drafting/prompt-templates", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updatePromptTemplate(input: PromptTemplateWriteInput) {
  return fetchJson<{ kind: string; name: string }>("/drafting/prompt-templates", {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export async function deletePromptTemplate(kind: string, name: string) {
  const search = new URLSearchParams({ kind, name })
  return fetchJson<{ deleted: boolean }>(
    `/drafting/prompt-templates?${search.toString()}`,
    { method: "DELETE" }
  )
}

// ---------------------------------------------------------------------------
// 项目（品牌级内容线）
// ---------------------------------------------------------------------------

export type Project = {
  project_id: string
  name: string
  description: string
  status: "active" | "archived"
  default_drafting_profile_id: string | null
  default_production_template_id: string | null
  languages: string[]
  tts_voice_by_language: Record<string, string>
  publish_platforms: string[]
  created_at: string
  updated_at: string
}

export type ProjectListResponse = {
  default_project_id: string | null
  projects: Project[]
}

export type ProjectInput = {
  name: string
  description?: string
  defaultDraftingProfileId?: string | null
  defaultProductionTemplateId?: string | null
  languages?: string[]
  ttsVoiceByLanguage?: Record<string, string>
  publishPlatforms?: string[]
  copyFromProjectId?: string
}

function projectBody(input: Partial<ProjectInput>) {
  return {
    name: input.name,
    description: input.description,
    default_drafting_profile_id: input.defaultDraftingProfileId,
    default_production_template_id: input.defaultProductionTemplateId,
    languages: input.languages,
    tts_voice_by_language: input.ttsVoiceByLanguage,
    publish_platforms: input.publishPlatforms,
    copy_from_project_id: input.copyFromProjectId,
  }
}

export async function listProjects() {
  return fetchJson<ProjectListResponse>("/projects")
}

export async function createProject(input: ProjectInput) {
  return fetchJson<Project>("/projects", {
    method: "POST",
    body: JSON.stringify(projectBody(input)),
  })
}

export async function updateProject(
  projectId: string,
  patch: Partial<ProjectInput>
) {
  return fetchJson<Project>(`/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(projectBody(patch)),
  })
}

export async function setDefaultProject(projectId: string) {
  return fetchJson<ProjectListResponse>("/projects/default", {
    method: "PUT",
    body: JSON.stringify({ project_id: projectId }),
  })
}

export async function archiveProject(projectId: string) {
  return fetchJson<ProjectListResponse>(`/projects/${projectId}/archive`, {
    method: "POST",
  })
}

export async function restoreProject(projectId: string) {
  return fetchJson<ProjectListResponse>(`/projects/${projectId}/restore`, {
    method: "POST",
  })
}
