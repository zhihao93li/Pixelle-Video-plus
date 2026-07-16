type ImportMetaWithEnv = ImportMeta & {
  env?: {
    VITE_PIXELLE_API_BASE_URL?: string
  }
}

export const API_BASE_URL =
  (import.meta as ImportMetaWithEnv).env?.VITE_PIXELLE_API_BASE_URL ?? "/api"

export type GenerationStatus =
  "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted"

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
  fixed_params: Record<string, unknown>
  required_capabilities: string[]
  user_selectable_runtime: boolean
  user_selectable_providers: string[]
  enabled: boolean
  allowed_user_params: string[]
  passthrough_input_fields: string[]
  is_custom?: boolean
  access_scope?: "public" | "agent"
}

export type TemplateListResponse = {
  default_template: string | null
  templates: ProductionTemplate[]
  agent_templates?: ProductionTemplate[]
}

export function templatesForManagement(response: TemplateListResponse) {
  return [...response.templates, ...(response.agent_templates ?? [])]
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
  status: GenerationStatus
  request?: {
    input: Record<string, unknown>
    params: Record<string, unknown>
    metadata: Record<string, unknown>
  }
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
  status: "completed"
  // 产物形态：video（默认）/ image_set（图文帖图集）/ text（长文）。
  artifact_type?: "video" | "image_set" | "text"
  artifacts: GenerationArtifact[]
  // 图集产物没有主视频；读取前先判 artifact_type / 判空
  primary_video: GenerationArtifact | null
  duration: number | null
  file_size: number | null
  storyboard_path: string | null
  metadata: Record<string, unknown>
}

export type PipelineInputField = {
  name: string
  field_type: string
  description: string
  default: unknown
}

export type PipelineStage = {
  id: string
  name: string
  description: string
  setting_keys: string[]
  actor: "system" | "user" | "agent"
}

export type PipelineOutput = {
  kind: string
  role: string
  description: string
  required: boolean
}

export type PipelineManifest = {
  id: string
  name: string
  description: string
  category: string
  product_family: string
  input: {
    description: string
    required_fields: PipelineInputField[]
    optional_fields: PipelineInputField[]
  }
  stages: PipelineStage[]
  quick_setting_keys: string[]
  outputs: PipelineOutput[]
  required_capabilities: string[]
  access_scope: "public" | "agent"
  launch_surfaces: Array<"react" | "agent" | "batch">
}

export type PipelineListResponse = {
  default_pipeline: string | null
  pipelines: PipelineManifest[]
}

export type ProductionTaskState =
  "needs_user" | "in_progress" | "failed" | "produced" | "cancelled"

export type ProductionTask = {
  production_task_id: string
  content_item_id: string
  project_id: string
  pipeline_id: string
  recipe_id: string
  recipe_version: string
  title: string
  artifact_type: "video" | "image_set" | "text" | "audio"
  source: "react" | "agent" | "batch"
  actor: "user" | "system" | "agent"
  client_name: string | null
  agent_session_id: string | null
  batch_id: string | null
  state: ProductionTaskState
  stage_id: string
  stage_label: string
  next_actor: "user" | "system" | "agent"
  progress_current: number | null
  progress_total: number | null
  progress_percentage: number | null
  action_type: string | null
  action_label: string | null
  input_snapshot: Record<string, unknown>
  confirmed_version_refs: Record<string, string>
  effective_params: Record<string, unknown>
  request_id: string
  request_hash: string
  operation_ids: string[]
  generation_task_ids: string[]
  artifact_ids: string[]
  provider_job_ids: string[]
  attempts: Array<{
    generation_task_id: string
    run_id: string
    status: string
    stage: string
    error: GenerationError | null
    required_artifacts_ok: boolean | null
    artifact_ids: string[]
    provider_job_ids: string[]
    created_at: string
    updated_at: string
  }>
  created_at: string
  updated_at: string
  state_since: string
  waiting_since: string | null
  failed_at: string | null
  produced_at: string | null
  cancelled_at: string | null
  cancellation_request_id: string | null
  error: GenerationError | null
}

export type ProductionTimelineEntry = {
  event_id: string
  event_type: string
  category: "output" | "activity"
  title: string
  occurred_at: string
  actor: "user" | "system" | "agent"
  stage: string | null
  revision_id: string | null
  generation_task_id: string | null
  detail: Record<string, unknown>
}

export type ProductionTimelinePage = {
  items: ProductionTimelineEntry[]
  next_cursor: string | null
}

export type ProductionTaskCreateResponse = {
  production_task_id: string
  content_item_id: string
  state: ProductionTaskState
  created: boolean
  task: ProductionTask
}

export type WorkbenchTaskCard = {
  production_task_id: string
  content_item_id: string
  project_id: string
  project_name: string
  state: ProductionTaskState
  title: string
  pipeline_id: string
  recipe_id: string
  artifact_type: string
  source: string
  stage: { id: string; label: string }
  progress: {
    current: number | null
    total: number | null
    percentage: number | null
  } | null
  next_actor: "user" | "system" | "agent"
  action: { type: string; label: string } | null
  error: { layer: string; code?: string | null; message: string } | null
  created_at: string
  updated_at: string
  state_since: string
  waiting_since: string | null
  failed_at: string | null
  produced_at: string | null
}

export type WorkbenchTaskListResponse = {
  items: WorkbenchTaskCard[]
  counts: Record<ProductionTaskState, number>
  next_cursor: string | null
}

export type PromptTemplate = {
  name: string
  content: string
  source: string
}

export type PromptTemplateListResponse = {
  default_languages: string[]
  script_templates: PromptTemplate[]
  split_templates: PromptTemplate[]
}

export type PromptTemplateKind = "script" | "split"

export type PromptTemplateWriteInput = {
  kind: PromptTemplateKind
  name: string
  content: string
  new_name?: string
}

export type PromptTemplateWriteResponse = {
  kind: PromptTemplateKind
  name: string
  source: string
}

export type LlmModelProvider = {
  id: string
  label: string
  provider_type: string
  configured: boolean
  default_model: string
  error?: string | null
  models: Array<{ id: string; label: string }>
}

export type LlmModelCatalogResponse = {
  configured: boolean
  default_provider_id: string
  providers: LlmModelProvider[]
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
    api_key_configured?: boolean
    clear_api_key?: boolean
    base_url: string
    model: string
    default_provider_id?: string
    providers?: Record<string, LlmProviderConfig>
  }
  comfyui: {
    comfyui_url: string
    comfyui_api_key?: string | null
    comfyui_api_key_configured?: boolean
    clear_comfyui_api_key?: boolean
    runninghub_api_key?: string | null
    runninghub_api_key_configured?: boolean
    clear_runninghub_api_key?: boolean
    runninghub_concurrent_limit: number
    runninghub_instance_type?: string | null
    runninghub_timeout?: number | null
    tts: {
      inference_mode?: "local" | "comfyui" | "fish"
      fish_audio: {
        api_key: string
        api_key_configured?: boolean
        clear_api_key?: boolean
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
      api_key_configured?: boolean
      clear_api_key?: boolean
      channels: Record<string, string>
    }
    cos: {
      region: string
      bucket: string
      secret_id: string
      secret_id_configured?: boolean
      clear_secret_id?: boolean
      secret_key: string
      secret_key_configured?: boolean
      clear_secret_key?: boolean
      public_base_url: string
      endpoint_url?: string | null
    }
  }
  [key: string]: unknown
}

export type LlmProviderConfig = {
  name: string
  provider_type:
    | "aihubmix"
    | "openai"
    | "deepseek"
    | "minimax"
    | "kimi"
    | "anthropic"
    | "xai"
    | "aliyun_bailian"
    | "volcengine_ark"
    | "custom_openai"
  enabled: boolean
  api_key: string
  api_key_configured?: boolean
  clear_api_key?: boolean
  base_url: string
  default_model: string
}

export type LlmProviderPreset = {
  id: LlmProviderConfig["provider_type"]
  label: string
  base_url: string
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

export type ImageProviderModel = { id: string; label: string }

export type ImageProviderSetting = {
  id: "aliyun_bailian" | "volcengine_ark"
  enabled: boolean
  configured: boolean
  base_url: string
  default_model: string
  timeout: number
  concurrency_limit: number
  region?: "cn-beijing" | "ap-southeast-1"
  workspace_id?: string
  models: ImageProviderModel[]
}

export type ImageProviderListResponse = {
  default_provider: "comfy_workflow" | "aliyun_bailian" | "volcengine_ark"
  providers: ImageProviderSetting[]
}

export type ImageProviderUpdate = Partial<
  Omit<ImageProviderSetting, "id" | "configured" | "models">
> & {
  api_key?: string
  clear_api_key?: boolean
}

export type ImageProviderTestResponse = {
  ok: boolean
  provider: string
  model: string
  request_id?: string | null
  image_url: string
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
  /** 静态预览图相对路径（docs/images 同源图库），无则 null */
  preview_url?: string | null
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

export async function listPipelines() {
  return fetchJson<PipelineListResponse>("/generation/pipelines")
}

export async function createProductionTask(input: {
  projectId: string
  pipelineId: string
  recipeId: string
  payload: Record<string, unknown>
  overrides?: Record<string, unknown>
  contentItemId?: string
  source?: "react"
  requestId?: string
}) {
  return fetchJson<ProductionTaskCreateResponse>("/production-tasks", {
    method: "POST",
    body: JSON.stringify({
      request_id: input.requestId ?? newContentRequestId("production"),
      project_id: input.projectId,
      pipeline_id: input.pipelineId,
      recipe_id: input.recipeId,
      input: input.payload,
      overrides: input.overrides ?? {},
      content_item_id: input.contentItemId ?? null,
      source: input.source ?? "react",
      client_name: "react-console",
    }),
  })
}

export async function getProductionTask(taskId: string) {
  return fetchJson<ProductionTask>(`/production-tasks/${taskId}`)
}

export async function getProductionTaskTimeline(
  taskId: string,
  input?: { cursor?: string; limit?: number }
) {
  const search = new URLSearchParams()
  if (input?.cursor) search.set("cursor", input.cursor)
  if (input?.limit != null) search.set("limit", String(input.limit))
  const query = search.toString()
  return fetchJson<ProductionTimelinePage>(
    `/production-tasks/${encodeURIComponent(taskId)}/timeline${query ? `?${query}` : ""}`
  )
}

export async function cancelProductionTask(taskId: string) {
  const requestId = newContentRequestId("cancel")
  return fetchJson<ProductionTask>(
    `/production-tasks/${taskId}?request_id=${encodeURIComponent(requestId)}`,
    {
      method: "DELETE",
    }
  )
}

export async function retryProductionTask(taskId: string, requestId?: string) {
  return fetchJson<ProductionTask>(`/production-tasks/${taskId}/retry`, {
    method: "POST",
    body: JSON.stringify({
      request_id: requestId ?? newContentRequestId("retry"),
      client_name: "react-console",
      source: "react",
    }),
  })
}

export async function listWorkbenchTasks(params?: {
  state?: ProductionTaskState
  projectId?: string
  pipelineId?: string
  recipeId?: string
  artifactType?: string
  source?: string
  createdFrom?: string
  createdTo?: string
  includeArchived?: boolean
  cursor?: string
  limit?: number
}) {
  const search = new URLSearchParams()
  if (params?.state) search.set("state", params.state)
  if (params?.projectId) search.set("project_id", params.projectId)
  if (params?.pipelineId) search.set("pipeline_id", params.pipelineId)
  if (params?.recipeId) search.set("recipe_id", params.recipeId)
  if (params?.artifactType) search.set("artifact_type", params.artifactType)
  if (params?.source) search.set("source", params.source)
  if (params?.createdFrom) search.set("created_from", params.createdFrom)
  if (params?.createdTo) search.set("created_to", params.createdTo)
  if (params?.includeArchived) search.set("include_archived", "true")
  if (params?.cursor) search.set("cursor", params.cursor)
  if (params?.limit != null) search.set("limit", String(params.limit))
  const query = search.toString()
  return fetchJson<WorkbenchTaskListResponse>(
    `/production-tasks${query ? `?${query}` : ""}`
  )
}

export type TemplateGenerationConfig = {
  template_id: string
  overridable_keys: string[]
  overrides: Record<string, unknown>
  base_params: Record<string, unknown>
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

export async function cloneProductionTemplate(
  input: CloneProductionTemplateInput
) {
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
  pipelineId: string,
  input: Record<string, unknown>,
  projectId: string,
  overrides: Record<string, unknown> = {}
) {
  return createProductionTask({
    projectId,
    pipelineId,
    recipeId: templateId,
    payload: input,
    requestId: newContentRequestId("production"),
    source: "react",
    overrides,
  })
}

export async function listPromptTemplates() {
  return fetchJson<PromptTemplateListResponse>("/drafting/prompt-templates")
}

export async function createPromptTemplate(input: PromptTemplateWriteInput) {
  return fetchJson<PromptTemplateWriteResponse>("/drafting/prompt-templates", {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function updatePromptTemplate(input: PromptTemplateWriteInput) {
  return fetchJson<PromptTemplateWriteResponse>("/drafting/prompt-templates", {
    method: "PUT",
    body: JSON.stringify(input),
  })
}

export async function deletePromptTemplate(
  kind: PromptTemplateKind,
  name: string
) {
  const query = new URLSearchParams({ kind, name })
  return fetchJson<{ deleted: boolean }>(
    `/drafting/prompt-templates?${query.toString()}`,
    { method: "DELETE" }
  )
}

export async function getLlmModelCatalog() {
  return fetchJson<LlmModelCatalogResponse>("/settings/llm/model-catalog")
}

export async function getLlmProviderPresets() {
  return fetchJson<{ providers: LlmProviderPreset[] }>(
    "/settings/llm/provider-presets"
  )
}

export async function updateLlmProvider(
  providerId: string,
  provider: LlmProviderConfig
) {
  return fetchJson<SettingsConfigResponse>(
    `/settings/llm/providers/${providerId}`,
    {
      method: "PUT",
      body: JSON.stringify(provider),
    }
  )
}

export async function deleteLlmProvider(providerId: string) {
  return fetchJson<SettingsConfigResponse>(
    `/settings/llm/providers/${providerId}`,
    {
      method: "DELETE",
    }
  )
}

export async function setDefaultLlmProvider(providerId: string) {
  return fetchJson<SettingsConfigResponse>(
    `/settings/llm/default-provider/${providerId}`,
    {
      method: "PUT",
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
}

export type ContentEvent = {
  type: string
  actor: string
  at: string
  detail: Record<string, unknown>
}

export type ContentItemLinks = {
  task_ids?: string[]
  production_task_ids?: string[]
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

export type SceneDraft = {
  scene_id: string
  order: number
  narration: string
  image_prompt: string
  duration?: number | null
  asset_id?: string | null
}

export type SceneManifest = {
  review_kind: "video_scenes" | "agent_image_scenes" | "image_pages"
  scenes: SceneDraft[]
  confirmed: boolean
  updated_at: string
}

export type ReviewAction =
  | "direct_edit"
  | "rewrite_script"
  | "regenerate_selected"
  | "regenerate_all"
  | "confirm"

export type ReviewReference = {
  title: string
  variants: Record<string, ContentVariant>
}

export type PendingReviewSession = {
  review_id: string
  item_id: string
  version: string
  payload:
    | {
        kind: "script"
        variants: Record<string, ContentVariant>
      }
    | {
        kind: "video_scenes" | "agent_image_scenes" | "image_pages"
        scene_manifest: SceneManifest
      }
  reference?: ReviewReference | null
  allowed_actions: ReviewAction[]
}

export type ContentPublication = {
  publication_id: string
  production_task_id?: string | null
  platform: string
  published_at: string
  evidence_type: "url" | "platform_post_id" | "buffer_id" | "manual"
  evidence_value: string
  actor: "user" | "agent" | "system"
  request_id: string
}

export type ContentFlowOperation = {
  operation_id: string
  request_id?: string
  operation?: string
  item_id?: string
  status: "running" | "completed" | "failed"
  result?: Record<string, unknown> | null
  error?: { layer?: string; message?: string } | null
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
  scene_manifest?: SceneManifest | null
  publications: ContentPublication[]
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
  sceneManifest?: SceneManifest
  contentVersion?: string
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

export function newContentRequestId(prefix = "react") {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}:${id}`
}

export async function createContentTopics(input: {
  titles: string[]
  languages?: string[]
  projectId: string
  source?: "manual" | "derived"
  requestId?: string
}) {
  return fetchJson<ContentItem[]>("/content-items/topics", {
    method: "POST",
    body: JSON.stringify({
      titles: input.titles,
      languages: input.languages ?? null,
      project_id: input.projectId,
      content_source: input.source ?? "manual",
      request_id: input.requestId ?? newContentRequestId("topics"),
      client_name: "react-console",
      source: "react",
    }),
  })
}

export async function startContentDraft(
  itemId: string,
  input: { recipeId: string; requestId?: string }
) {
  return fetchJson<ContentFlowOperation>(`/content-items/${itemId}/draft`, {
    method: "POST",
    body: JSON.stringify({
      recipe_id: input.recipeId,
      request_id: input.requestId ?? newContentRequestId("draft"),
      client_name: "react-console",
      source: "react",
    }),
  })
}

export async function getContentOperation(operationId: string) {
  return fetchJson<ContentFlowOperation>(`/agent/operations/${operationId}`)
}

export async function getPendingContentReview(itemId: string) {
  return fetchJson<{ item: ContentItem; review: PendingReviewSession | null }>(
    `/content-items/${encodeURIComponent(itemId)}/pending-review`
  )
}

export async function confirmContentItem(
  itemId: string,
  input: {
    reviewId: string
    contentVersion: string
    requestId?: string
  }
) {
  return fetchJson<ContentItem>(`/content-items/${itemId}/confirm`, {
    method: "POST",
    body: JSON.stringify({
      request_id: input.requestId ?? newContentRequestId("confirm"),
      client_name: "react-console",
      source: "react",
      review_id: input.reviewId,
      content_version: input.contentVersion,
    }),
  })
}

export async function reviseContentReview(input: {
  itemId: string
  action:
    "direct_edit" | "rewrite_script" | "regenerate_selected" | "regenerate_all"
  reviewId: string
  contentVersion: string
  selectedSceneIds?: string[]
  instruction?: string
  variants?: Record<string, ContentVariant>
  sceneManifest?: SceneManifest
  requestId?: string
}) {
  return fetchJson<ContentItem>(
    `/content-items/${encodeURIComponent(input.itemId)}/revise-review`,
    {
      method: "POST",
      body: JSON.stringify({
        action: input.action,
        review_id: input.reviewId,
        content_version: input.contentVersion,
        selected_scene_ids: input.selectedSceneIds ?? [],
        instruction: input.instruction?.trim() || null,
        variants: input.variants ?? null,
        scene_manifest: input.sceneManifest ?? null,
        request_id: input.requestId ?? newContentRequestId("revise-review"),
        client_name: "react-console",
        source: "react",
      }),
    }
  )
}

export type ContentProduceResponse = {
  operation_id: string
  item_id: string
  batch_id: string
  task_ids: string[]
}

export async function produceContentItem(input: {
  itemId: string
  recipeId?: string
  language?: string
  overrides?: Record<string, unknown>
  requestId?: string
}) {
  return fetchJson<ContentProduceResponse>(
    `/content-items/${input.itemId}/produce`,
    {
      method: "POST",
      body: JSON.stringify({
        recipe_id: input.recipeId ?? null,
        language: input.language ?? null,
        overrides: input.overrides ?? {},
        request_id: input.requestId ?? newContentRequestId("produce"),
        client_name: "react-console",
        source: "react",
      }),
    }
  )
}

export async function markContentPublished(input: {
  itemId: string
  productionTaskId?: string
  platform: string
  publishedAt: string
  publishUrl?: string
  manualEvidence?: string
  requestId?: string
}) {
  return fetchJson<ContentItem>(
    `/content-items/${input.itemId}/mark-published`,
    {
      method: "POST",
      body: JSON.stringify({
        production_task_id: input.productionTaskId ?? null,
        platform: input.platform,
        published_at: input.publishedAt,
        publish_url: input.publishUrl || null,
        manual_evidence: input.manualEvidence || null,
        request_id: input.requestId ?? newContentRequestId("published"),
        client_name: "react-console",
        source: "react",
      }),
    }
  )
}

export async function recordContentMetrics(input: {
  itemId: string
  productionTaskId?: string
  likes?: number
  favorites?: number
  comments?: number
  note?: string
  publicationId?: string
  requestId?: string
}) {
  return fetchJson<ContentItem>(`/content-items/${input.itemId}/metrics`, {
    method: "POST",
    body: JSON.stringify({
      production_task_id: input.productionTaskId ?? null,
      likes: input.likes ?? null,
      favorites: input.favorites ?? null,
      comments: input.comments ?? null,
      note: input.note || null,
      publication_id: input.publicationId ?? null,
      mock: false,
      request_id: input.requestId ?? newContentRequestId("metrics"),
      client_name: "react-console",
      source: "react",
    }),
  })
}

export function contentSceneImageUrl(itemId: string, sceneId: string) {
  return `/api/content-items/${encodeURIComponent(itemId)}/scene-images/${encodeURIComponent(sceneId)}`
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
      scene_manifest: input.sceneManifest ?? null,
      content_version: input.contentVersion ?? null,
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
  return fetchJson<HistoryTaskListResponse>(
    `/history/tasks?${params.toString()}`
  )
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

export async function listImageProviders() {
  return fetchJson<ImageProviderListResponse>("/settings/image-providers")
}

export async function listImageProviderResources() {
  return fetchJson<ImageProviderListResponse>("/resources/image-providers")
}

export async function updateImageProvider(
  providerId: ImageProviderSetting["id"],
  updates: ImageProviderUpdate
) {
  return fetchJson<ImageProviderListResponse>(
    `/settings/image-providers/${providerId}`,
    { method: "PUT", body: JSON.stringify(updates) }
  )
}

export async function testImageProvider(
  providerId: ImageProviderSetting["id"]
) {
  return fetchJson<ImageProviderTestResponse>(
    `/settings/image-providers/${providerId}/test`,
    { method: "POST" }
  )
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

/** 资源相对 URL（如模板 preview_url）拼成完整 API 地址；空值透传 null。 */
export function apiResourceUrl(path: string | null | undefined) {
  if (!path) {
    return null
  }
  return `${API_BASE_URL.replace(/\/$/, "")}${path}`
}

export async function listResourceTemplates() {
  return fetchJson<{ templates: ResourceTemplate[] }>("/resources/templates")
}

export async function listResourceMediaWorkflows() {
  return fetchJson<{ workflows: ResourceWorkflow[] }>(
    "/resources/workflows/media"
  )
}

export async function listResourceTtsWorkflows() {
  return fetchJson<{ workflows: ResourceWorkflow[] }>(
    "/resources/workflows/tts"
  )
}

export function artifactFileUrl(
  artifact: GenerationArtifact | null | undefined
) {
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
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "interrupted"
  )
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
      "无法连接 Pixelle API。请确认 Pixelle 服务正在运行并可访问。",
      0,
      error instanceof Error ? error.message : error
    )
  }

  const text = await response.text()
  const data = text ? safeJson(text) : null

  if (!response.ok) {
    throw new ApiError(
      errorMessage(data, response.statusText),
      response.status,
      data
    )
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
// 项目（品牌级内容线）
// ---------------------------------------------------------------------------

export type Project = {
  project_id: string
  name: string
  description: string
  status: "active" | "archived"
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
