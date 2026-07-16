import type { Page, Route } from "playwright/test"

const PROJECT_ID = "project-1"
const CONTENT_ITEM_ID = "content-1"
const VIDEO_TEMPLATE_ID = "template-video"
const TOPIC_TEMPLATE_ID = "template-topic-video"
const IMAGE_TEMPLATE_ID = "template-image"
const TEXT_TEMPLATE_ID = "template-text"
const ASSET_TEMPLATE_ID = "template-asset"
const I2V_TEMPLATE_ID = "template-i2v"
const ACTION_TEMPLATE_ID = "template-action"
const HUMAN_TEMPLATE_ID = "template-human"
const HISTORY_VIDEO_TASK_ID = "history-video-1"
const HISTORY_IMAGE_TASK_ID = "history-image-set-1"
const HISTORY_TEXT_TASK_ID = "history-text-1"
const HISTORY_FAILED_TASK_ID = "history-failed-1"
const SUBMITTED_TASK_ID = "submitted-task-1"
const STATIC_VIDEO_URL = "http://127.0.0.1:8000/api/files/visual-video.mp4"
const STATIC_IMAGE_URLS = [
  "http://127.0.0.1:8000/api/files/visual-card-cover.svg",
  "http://127.0.0.1:8000/api/files/visual-card-science.svg",
  "http://127.0.0.1:8000/api/files/visual-card-guide.svg",
] as const

export type ApiFixtureOptions = {
  projectState?: "ready" | "loading" | "empty" | "error"
  productionState?:
    "ready" | "loading" | "empty" | "error" | "stale" | "resource-error"
  contentState?: "ready" | "loading" | "empty" | "error" | "stale"
  contentDetailState?: "ready" | "loading" | "error" | "stale"
  contentItemStatus?: string
  productionReviewKind?: "script" | "scenes" | "pages"
  transitionScriptToScenes?: boolean
  linkContentToProductionTask?: boolean
  taskState?: "ready" | "loading" | "empty" | "error" | "stale"
  historyState?: "ready" | "loading" | "empty" | "error" | "stale"
  historyPages?: number
  publishAttemptState?: "scheduled" | "published" | "failed"
  settingsState?: "ready" | "loading" | "error" | "stale"
  settingsDiagnosticsState?: "ready" | "error"
  helpState?: "ready" | "loading" | "empty" | "error"
  includeBatch?: boolean
  enableBatchSubmission?: boolean
  batchSubmissionState?: "partial_failed" | "running"
  includeSecondProject?: boolean
  projectName?: string
  contentScript?: string
  configState?: "ready" | "partial-error" | "error"
  article?: string
  delayMs?: number
  submissionDelayMs?: number
  submissionState?:
    | "completed"
    | "failed"
    | "running"
    | "unknown"
    | "submit-error"
    | "result-error"
  videoFixedParams?: Record<string, unknown>
  imageProvidersReady?: boolean
  captureJsonRequests?: ApiFixtureRequest[]
}

export type ApiFixtureRequest = {
  method: string
  path: string
  body: unknown
}

const project = {
  project_id: PROJECT_ID,
  name: "PetWoods 内容计划",
  description: "用于正式路由验收的本地项目。",
  status: "active",
  default_production_template_id: VIDEO_TEMPLATE_ID,
  languages: ["Chinese"],
  tts_voice_by_language: {
    Chinese: "zh-CN-YunjianNeural",
  },
  publish_platforms: ["youtube"],
  created_at: "2026-07-10T08:00:00Z",
  updated_at: "2026-07-10T08:00:00Z",
}

function productionTemplate(
  id: string,
  displayName: string,
  pipelineId: string,
  productEntry = "generate"
) {
  const requiresAssets = [
    "asset_based",
    "i2v",
    "action_transfer",
    "digital_human",
  ].includes(pipelineId)
  const supportsDrafting = pipelineId === "topic_to_video"
  return {
    id,
    version: "1.0.0",
    display_name: displayName,
    description: `${displayName}测试模板`,
    project: PROJECT_ID,
    channel: "xiaohongshu",
    use_case: productEntry,
    runtime_label: "标准生成",
    estimated_turnaround: "约 2 分钟",
    failure_guidance: "请检查输入后重试。",
    requires_user_assets: requiresAssets,
    advanced_controls_hidden: true,
    template_tags: ["测试"],
    input_requirements: requiresAssets
      ? ["assets"]
      : supportsDrafting
        ? ["topic"]
        : ["script"],
    quality_tier: "standard",
    pipeline_id: pipelineId,
    fixed_params: ["topic_to_video", "script_to_video"].includes(pipelineId)
      ? {
          ...(supportsDrafting
            ? {
                script_template_name: "default-script",
                script_model: "test-model",
                language_script_models: {},
              }
            : {}),
          split_template_name: "default-split",
          split_model: "test-model",
          frame_template: "1080x1920/image_default.html",
          tts_inference_mode: "local",
          tts_voice: "zh-CN-YunjianNeural",
        }
      : {},
    required_capabilities: [],
    user_selectable_runtime: false,
    user_selectable_providers: [],
    enabled: true,
    allowed_user_params: ["topic_to_video", "script_to_video"].includes(
      pipelineId
    )
      ? [
          "title",
          ...(supportsDrafting
            ? ["script_template_name", "script_model", "language_script_models"]
            : []),
          "split_template_name",
          "split_model",
          "frame_template",
          "template_params",
          "image_provider",
          "image_model",
          "media_workflow",
          "media_width",
          "media_height",
          "prompt_prefix",
          "image_prompt_visual_context",
          "image_prompt_generation_rules",
          "tts_inference_mode",
          "tts_voice",
          "tts_speed",
          "bgm_path",
          "bgm_volume",
          "bgm_mode",
          "compose_runtime",
        ]
      : pipelineId === "asset_based"
        ? [
            "voice_id",
            "tts_speed",
            "bgm_path",
            "bgm_volume",
            "bgm_mode",
            "compose_runtime",
          ]
        : pipelineId === "long_form"
          ? ["title", "long_form_prompt", "word_count", "llm_model"]
          : pipelineId === "image_post"
            ? [
                "title",
                "split_mode",
                "frame_template",
                "template_params",
                "image_provider",
                "image_model",
                "media_workflow",
                "media_width",
                "media_height",
                "prompt_prefix",
                "image_prompt_visual_context",
                "image_prompt_generation_rules",
              ]
            : [
                "workflow_key",
                "source",
                "tts_inference_mode",
                "tts_voice",
                "tts_speed",
              ],
    passthrough_input_fields: [],
  }
}

const templates = [
  productionTemplate(TOPIC_TEMPLATE_ID, "主题口播视频", "topic_to_video"),
  productionTemplate(VIDEO_TEMPLATE_ID, "图文口播视频", "script_to_video"),
  productionTemplate(IMAGE_TEMPLATE_ID, "小红书图文", "image_post"),
  productionTemplate(TEXT_TEMPLATE_ID, "长文", "long_form"),
  productionTemplate(ASSET_TEMPLATE_ID, "素材成片", "asset_based"),
  productionTemplate(I2V_TEMPLATE_ID, "图生视频", "i2v", "image_to_video"),
  productionTemplate(
    ACTION_TEMPLATE_ID,
    "动作迁移",
    "action_transfer",
    "action_transfer"
  ),
  productionTemplate(
    HUMAN_TEMPLATE_ID,
    "数字人",
    "digital_human",
    "digital_human"
  ),
]

function pipelineManifest(
  id: string,
  name: string,
  requiredInput: string,
  productFamily: string,
  stages: Array<{ id: string; name: string; setting_keys: string[] }>
) {
  const quickSettingKeys: Record<string, string[]> = {
    topic_to_video: ["frame_template", "tts_voice", "tts_speed", "bgm_path"],
    script_to_video: ["frame_template", "tts_voice", "tts_speed", "bgm_path"],
    image_post: ["frame_template", "image_provider", "image_model"],
    long_form: ["word_count", "llm_model"],
    asset_based: ["voice_id", "tts_speed", "bgm_path"],
    digital_human: ["tts_voice", "tts_speed"],
  }
  return {
    id,
    name,
    description: `${name}测试路线`,
    category: "content",
    product_family: productFamily,
    input: {
      description: "",
      required_fields: [
        {
          name: requiredInput,
          field_type: requiredInput === "assets" ? "array" : "string",
          description: "",
          default: null,
        },
      ],
      optional_fields: [],
    },
    stages: stages.map((stage) => ({
      ...stage,
      description: "",
      actor: stage.id.startsWith("review") ? "user" : "system",
    })),
    quick_setting_keys: quickSettingKeys[id] ?? [],
    outputs: [
      {
        kind:
          id === "image_post"
            ? "image"
            : id === "long_form"
              ? "metadata"
              : "video",
        role:
          id === "image_post"
            ? "primary_images"
            : id === "long_form"
              ? "article"
              : "primary_video",
        description: "",
        required: true,
      },
    ],
    required_capabilities: [],
    access_scope: "public",
    launch_surfaces: ["react", "batch"],
  }
}

const videoStages = [
  {
    id: "split_scenes",
    name: "分镜",
    setting_keys: ["split_template_name", "split_model"],
  },
  {
    id: "generate_media",
    name: "每镜画面",
    setting_keys: [
      "frame_template",
      "image_provider",
      "image_model",
      "media_workflow",
      "media_width",
      "media_height",
      "prompt_prefix",
      "image_prompt_visual_context",
      "image_prompt_generation_rules",
    ],
  },
  {
    id: "generate_tts",
    name: "音色",
    setting_keys: ["tts_inference_mode", "tts_voice", "tts_speed"],
  },
  {
    id: "compose_video",
    name: "合成",
    setting_keys: ["bgm_path", "bgm_volume", "bgm_mode", "compose_runtime"],
  },
]

const pipelineManifests = [
  pipelineManifest("topic_to_video", "主题转视频", "topic", "图文口播", [
    {
      id: "generate_script",
      name: "写稿",
      setting_keys: [
        "script_template_name",
        "script_model",
        "language_script_models",
      ],
    },
    { id: "review_script", name: "确认文案", setting_keys: [] },
    ...videoStages,
  ]),
  pipelineManifest(
    "script_to_video",
    "文案转视频",
    "script",
    "图文口播",
    videoStages
  ),
  pipelineManifest("image_post", "图文帖", "script", "图文内容", [
    { id: "split_pages", name: "分页", setting_keys: ["split_mode"] },
    {
      id: "render_pages",
      name: "每页配图",
      setting_keys: [
        "frame_template",
        "image_provider",
        "image_model",
        "media_workflow",
        "media_width",
        "media_height",
        "prompt_prefix",
        "image_prompt_visual_context",
        "image_prompt_generation_rules",
      ],
    },
  ]),
  pipelineManifest("long_form", "长文", "script", "图文内容", [
    {
      id: "write_article",
      name: "长文改写",
      setting_keys: ["long_form_prompt", "word_count", "llm_model"],
    },
  ]),
  pipelineManifest("asset_based", "素材成片", "assets", "素材创作", [
    {
      id: "compose_assets",
      name: "素材制作",
      setting_keys: [
        "voice_id",
        "tts_speed",
        "bgm_path",
        "bgm_volume",
        "bgm_mode",
        "compose_runtime",
      ],
    },
  ]),
  ...["i2v", "action_transfer", "digital_human"].map((id) =>
    pipelineManifest(id, id, "assets", "素材创作", [
      {
        id: "generate",
        name: "生成",
        setting_keys: [
          "workflow_key",
          "source",
          "tts_inference_mode",
          "tts_voice",
          "tts_speed",
        ],
      },
    ])
  ),
]

function templatesForOptions(options: ApiFixtureOptions) {
  if (!options.videoFixedParams) {
    return templates
  }
  return templates.map((template) =>
    template.id === VIDEO_TEMPLATE_ID
      ? {
          ...template,
          fixed_params: {
            ...template.fixed_params,
            ...options.videoFixedParams,
          },
        }
      : template
  )
}

const contentItem = {
  item_id: CONTENT_ITEM_ID,
  project: PROJECT_ID,
  channel: "xiaohongshu",
  title: "猫咪为什么喜欢猫薄荷",
  kind: "text",
  source: "manual",
  status: "confirmed",
  languages: ["Chinese"],
  variants: {
    Chinese: {
      language: "Chinese",
      status: "confirmed",
      title: "猫咪为什么喜欢猫薄荷",
      script: "猫薄荷会通过嗅觉让一部分猫咪短暂兴奋。",
    },
  },
  asset_paths: [],
  links: {
    task_ids: [HISTORY_IMAGE_TASK_ID],
    batch_ids: [],
  },
  metrics: { likes: 128, favorites: 46, comments: 12 },
  automation: {},
  scene_manifest: null,
  publications: [],
  events: [
    {
      type: "created",
      actor: "user",
      at: "2026-07-10T08:00:00Z",
      detail: { status: "confirmed" },
    },
  ],
  created_at: "2026-07-10T08:00:00Z",
  updated_at: "2026-07-10T08:00:00Z",
}

function workbenchCard(
  state: "needs_user" | "in_progress" | "failed" | "produced"
) {
  return {
    production_task_id: `production-${state}`,
    content_item_id: CONTENT_ITEM_ID,
    project_id: PROJECT_ID,
    project_name: project.name,
    state,
    title: contentItem.title,
    pipeline_id: "script_to_video",
    recipe_id: VIDEO_TEMPLATE_ID,
    artifact_type: "video",
    source: "react",
    stage: {
      id: state,
      label:
        state === "needs_user"
          ? "确认文案"
          : state === "in_progress"
            ? "正在合成"
            : state === "failed"
              ? "合成失败"
              : "已保存产物",
    },
    progress:
      state === "in_progress" ? { current: 2, total: 4, percentage: 50 } : null,
    next_actor: state === "needs_user" ? "user" : "system",
    action:
      state === "needs_user"
        ? { type: "confirm_script", label: "确认文案" }
        : state === "failed"
          ? { type: "view_error", label: "查看原因" }
          : state === "produced"
            ? { type: "view_artifacts", label: "查看产物" }
            : null,
    error:
      state === "failed"
        ? {
            layer: "runtime",
            code: "FixtureError",
            message: "渲染节点暂时不可用。",
          }
        : null,
    created_at: "2026-07-10T08:00:00Z",
    updated_at: "2026-07-10T08:05:00Z",
    state_since: "2026-07-10T08:05:00Z",
    waiting_since: state === "needs_user" ? "2026-07-10T08:05:00Z" : null,
    failed_at: state === "failed" ? "2026-07-10T08:05:00Z" : null,
    produced_at: state === "produced" ? "2026-07-10T08:05:00Z" : null,
  }
}

function productionTaskFixture(
  state: "needs_user" | "in_progress" | "failed" | "produced" | "cancelled",
  taskId = `production-${state}`,
  generationTaskIds: string[] = []
) {
  const baseState = state === "cancelled" ? "in_progress" : state
  const card = workbenchCard(baseState)
  return {
    production_task_id: taskId,
    content_item_id: card.content_item_id,
    project_id: card.project_id,
    pipeline_id: card.pipeline_id,
    recipe_id: card.recipe_id,
    recipe_version: "1.0.0",
    title: card.title,
    artifact_type: card.artifact_type,
    source: card.source,
    actor: "user",
    client_name: "react-console",
    agent_session_id: null,
    batch_id: null,
    state,
    stage_id: state === "cancelled" ? "cancelled" : card.stage.id,
    stage_label: state === "cancelled" ? "已取消" : card.stage.label,
    next_actor: card.next_actor,
    progress_current:
      state === "cancelled" ? null : (card.progress?.current ?? null),
    progress_total:
      state === "cancelled" ? null : (card.progress?.total ?? null),
    progress_percentage:
      state === "cancelled" ? null : (card.progress?.percentage ?? null),
    action_type: card.action?.type ?? null,
    action_label: card.action?.label ?? null,
    input_snapshot: { script: "猫薄荷会让一部分猫咪短暂兴奋。" },
    confirmed_version_refs: {},
    effective_params: {},
    request_id: `production:${state}`,
    request_hash: `fixture:${state}`,
    generation_task_ids: generationTaskIds,
    operation_ids: [],
    artifact_ids: [],
    provider_job_ids: [],
    attempts: [],
    error: card.error
      ? {
          layer: card.error.layer,
          message: card.error.message,
          exception_type: card.error.code,
          detail: {},
        }
      : null,
    created_at: card.created_at,
    updated_at: card.updated_at,
    state_since: card.state_since,
    waiting_since: card.waiting_since,
    failed_at: card.failed_at,
    produced_at: card.produced_at,
    cancelled_at: state === "cancelled" ? "2026-07-10T08:06:00Z" : null,
    cancellation_request_id: null,
  }
}

function submittedProductionTaskFixture(
  options: ApiFixtureOptions,
  requestCounts: Map<string, number>
) {
  const taskId = "production-submitted-1"
  const generationTaskIds = [SUBMITTED_TASK_ID]
  if ((requestCounts.get(`DELETE /production-tasks/${taskId}`) ?? 0) > 0) {
    return productionTaskFixture("cancelled", taskId, generationTaskIds)
  }
  if (
    options.submissionState === "completed" ||
    options.submissionState === "result-error"
  ) {
    return productionTaskFixture("produced", taskId, generationTaskIds)
  }
  if (options.submissionState === "failed") {
    return productionTaskFixture("failed", taskId, generationTaskIds)
  }
  const task = productionTaskFixture("in_progress", taskId, generationTaskIds)
  if (
    options.submissionState === "running" ||
    options.submissionState === "unknown"
  ) {
    return {
      ...task,
      stage_id: "plan_scenes",
      stage_label: "正在规划分镜",
      progress_current: null,
      progress_total: null,
      progress_percentage: null,
    }
  }
  return task
}

function productionTimelineFixture(
  taskId: string,
  options: ApiFixtureOptions,
  requestCounts: Map<string, number>
) {
  const task =
    taskId === "production-submitted-1"
      ? submittedProductionTaskFixture(options, requestCounts)
      : productionTaskFixture("needs_user", taskId)
  const entries: Array<Record<string, unknown>> = []
  if (task.state === "needs_user") {
    const context = reviewContextForOptions(options, requestCounts)
    if (context.review) {
      const kind = context.review.payload.kind
      entries.push({
        event_id: `revision:${context.review.review_id}`,
        event_type:
          kind === "script"
            ? "script_generated"
            : kind === "image_pages"
              ? "pages_generated"
              : "scenes_generated",
        category: "output",
        title:
          kind === "script"
            ? "文案已生成"
            : kind === "image_pages"
              ? "分页已生成"
              : "分镜已生成",
        occurred_at: "2026-07-10T08:05:00Z",
        actor: "system",
        stage: kind === "scenes" ? "scene_plan" : kind,
        revision_id: context.review.review_id,
        generation_task_id: null,
        detail: { payload: context.review.payload },
      })
    }
  } else if (task.state === "produced") {
    entries.push({
      event_id: `artifact-produced:${SUBMITTED_TASK_ID}`,
      event_type: "artifact_produced",
      category: "output",
      title: "产物已生成",
      occurred_at: "2026-07-10T08:07:00Z",
      actor: "system",
      stage: "compose_video",
      revision_id: null,
      generation_task_id: SUBMITTED_TASK_ID,
      detail: { artifact_ids: ["artifact-submitted"] },
    })
  } else if (task.state === "failed") {
    entries.push({
      event_id: `attempt-failed:${SUBMITTED_TASK_ID}`,
      event_type: "production_failed",
      category: "activity",
      title: "生产失败",
      occurred_at: "2026-07-10T08:07:00Z",
      actor: "system",
      stage: "compose_video",
      revision_id: null,
      generation_task_id: SUBMITTED_TASK_ID,
      detail: { message: "渲染节点暂时不可用。", layer: "runtime" },
    })
  } else if (task.state === "cancelled") {
    entries.push({
      event_id: `task-cancelled:${taskId}`,
      event_type: "task_cancelled",
      category: "activity",
      title: "任务已取消",
      occurred_at: "2026-07-10T08:06:00Z",
      actor: "user",
      stage: "cancelled",
      revision_id: null,
      generation_task_id: null,
      detail: {},
    })
  }
  if (task.generation_task_ids.length > 0 && task.state !== "cancelled") {
    entries.push({
      event_id: "run-started:run-1",
      event_type: "production_started",
      category: "activity",
      title: "开始生产",
      occurred_at: "2026-07-10T08:06:00Z",
      actor: "system",
      stage: "compose_video",
      revision_id: null,
      generation_task_id: null,
      detail: { run_id: "run-1" },
    })
  }
  entries.push({
    event_id: `task-created:${taskId}`,
    event_type: "task_created",
    category: "activity",
    title: "任务已创建",
    occurred_at: "2026-07-10T08:00:00Z",
    actor: "user",
    stage: "created",
    revision_id: null,
    generation_task_id: null,
    detail: { title: task.title, input: task.input_snapshot },
  })
  return { items: entries, next_cursor: null }
}

const settings = {
  project_name: "Pixelle",
  llm: {
    api_key: "",
    api_key_configured: true,
    base_url: "https://api.example.invalid/v1",
    model: "pixelle-test-model",
    default_provider_id: "aihubmix",
    providers: {
      aihubmix: {
        name: "AiHubMix 主账号",
        provider_type: "aihubmix",
        enabled: true,
        api_key: "",
        api_key_configured: true,
        base_url: "https://aihubmix.com/v1",
        default_model: "gpt-4.1",
      },
      openai: {
        name: "OpenAI 直连",
        provider_type: "openai",
        enabled: true,
        api_key: "",
        api_key_configured: true,
        base_url: "https://api.openai.com/v1",
        default_model: "gpt-4.1",
      },
    },
  },
  comfyui: {
    comfyui_url: "http://127.0.0.1:8188",
    comfyui_api_key: "",
    comfyui_api_key_configured: true,
    runninghub_api_key: "",
    runninghub_api_key_configured: true,
    runninghub_concurrent_limit: 2,
    runninghub_instance_type: "standard",
    runninghub_timeout: 300,
    tts: {
      inference_mode: "local",
      fish_audio: {
        api_key: "",
        api_key_configured: false,
        base_url: "https://example.invalid",
        model: "s1",
        reference_id: "",
      },
    },
  },
  publish: {
    buffer: {
      api_key: "",
      api_key_configured: true,
      channels: { youtube: "youtube-test-channel" },
    },
    cos: {
      region: "ap-shanghai",
      bucket: "pixelle-test",
      secret_id: "",
      secret_id_configured: true,
      secret_key: "",
      secret_key_configured: true,
      public_base_url: "https://cdn.example.invalid",
      endpoint_url: "https://cos.example.invalid",
    },
  },
}

const imageProviders = {
  default_provider: "comfy_workflow",
  providers: [
    {
      id: "aliyun_bailian",
      enabled: false,
      configured: false,
      base_url: "https://dashscope.aliyuncs.com/api/v1",
      default_model: "qwen-image-2.0",
      timeout: 300,
      concurrency_limit: 2,
      region: "cn-beijing",
      workspace_id: "",
      models: [
        { id: "qwen-image-2.0", label: "Qwen-Image 2.0" },
        { id: "qwen-image-2.0-pro", label: "Qwen-Image 2.0 Pro" },
        { id: "wan2.6-t2i", label: "通义万相 2.6 文生图" },
      ],
    },
    {
      id: "volcengine_ark",
      enabled: false,
      configured: false,
      base_url: "https://ark.cn-beijing.volces.com/api/v3",
      default_model: "doubao-seedream-5-0-lite",
      timeout: 300,
      concurrency_limit: 2,
      models: [
        {
          id: "doubao-seedream-5-0-lite",
          label: "Seedream 5.0 Lite",
        },
      ],
    },
  ],
}

const generationProgress = (
  percentage: number,
  message: string,
  stage = "render"
) => ({
  stage,
  percentage,
  message,
  current: null,
  total: null,
  detail: {},
})

const generationBatch = {
  batch_id: "batch-visual-regression-1",
  template_id: VIDEO_TEMPLATE_ID,
  status: "partial_failed",
  total_count: 3,
  submitted_count: 3,
  failed_count: 1,
  created_at: "2026-07-10T08:12:00Z",
  updated_at: "2026-07-10T08:16:00Z",
  metadata: { source: "e2e-visual-regression" },
  items: [
    {
      index: 1,
      input: {
        title: "猫咪为什么喜欢猫薄荷",
        script: "猫薄荷会通过嗅觉让一部分猫咪短暂兴奋。",
      },
      params: {},
      metadata: {},
      task_id: "batch-task-1",
      status: "completed",
      progress: generationProgress(100, "视频已经生成", "completed"),
      error: null,
    },
    {
      index: 2,
      input: {
        title: "猫咪尾巴语言",
        script: "尾巴的位置和摆动速度，能透露猫咪当下的情绪。",
      },
      params: {},
      metadata: {},
      task_id: "batch-task-2",
      status: "completed",
      progress: generationProgress(100, "视频已经生成", "completed"),
      error: null,
    },
    {
      index: 3,
      input: {
        title: "新手养猫避坑",
        script: "把猫砂盆放在安静、通风且容易到达的位置。",
      },
      params: {},
      metadata: {},
      task_id: "batch-task-3",
      status: "failed",
      progress: generationProgress(48, "渲染中断"),
      error: {
        layer: "runtime",
        message: "渲染节点暂时不可用，可单独重试这一条。",
        exception_type: "FixtureRuntimeError",
        detail: {},
      },
    },
  ],
}

const completedGenerationBatch = {
  ...generationBatch,
  status: "completed",
  failed_count: 0,
  updated_at: "2026-07-10T08:18:00Z",
  items: generationBatch.items.map((item) => ({
    ...item,
    status: "completed",
    progress: generationProgress(100, "产物已经生成", "completed"),
    error: null,
  })),
}

const runningGenerationBatch = {
  ...generationBatch,
  status: "running",
  failed_count: 0,
  items: generationBatch.items.map((item) => ({
    ...item,
    status: "running",
    progress: generationProgress(42, "正在生成产物"),
    error: null,
  })),
}

const cancelledGenerationBatch = {
  ...runningGenerationBatch,
  status: "cancelled",
  items: runningGenerationBatch.items.map((item) => ({
    ...item,
    status: "cancelled",
    progress: generationProgress(42, "任务已取消", "cancelled"),
  })),
}

const historyTasks = [
  {
    task_id: HISTORY_VIDEO_TASK_ID,
    status: "completed",
    title: "猫咪尾巴语言",
    created_at: "2026-07-10T09:00:00Z",
    completed_at: "2026-07-10T09:05:00Z",
    result: {
      artifact_type: "video",
      video_path: STATIC_VIDEO_URL,
      cover_path: STATIC_IMAGE_URLS[1],
      duration: 42,
      file_size: 2_400_000,
    },
    input: { title: "猫咪尾巴语言" },
  },
  {
    task_id: HISTORY_IMAGE_TASK_ID,
    status: "completed",
    title: "猫咪为什么喜欢猫薄荷",
    created_at: "2026-07-10T08:00:00Z",
    completed_at: "2026-07-10T08:04:00Z",
    result: { artifact_type: "image_set", page_count: 3 },
    input: { title: "猫咪为什么喜欢猫薄荷" },
  },
  {
    task_id: HISTORY_TEXT_TASK_ID,
    status: "completed",
    title: "第一次养猫的七天准备清单",
    created_at: "2026-07-09T10:00:00Z",
    completed_at: "2026-07-09T10:03:00Z",
    result: { artifact_type: "text", word_count: 860 },
    input: { title: "第一次养猫的七天准备清单" },
  },
  {
    task_id: HISTORY_FAILED_TASK_ID,
    status: "failed",
    title: "猫咪饮水观察记录",
    created_at: "2026-07-08T12:00:00Z",
    completed_at: null,
    result: {
      artifact_type: "video",
      error: { message: "声音生成服务返回超时。" },
    },
    input: { title: "猫咪饮水观察记录" },
  },
]

const historyDetails: Record<string, Record<string, unknown>> = {
  [HISTORY_VIDEO_TASK_ID]: {
    metadata: {
      status: "completed",
      input: {
        title: "猫咪尾巴语言",
        script: "尾巴的位置和摆动速度，能透露猫咪当下的情绪。",
        tts_voice: "zh-CN-YunjianNeural",
      },
      production_template: {
        id: VIDEO_TEMPLATE_ID,
        name: "图文口播视频",
      },
      result: {
        artifact_type: "video",
        video_path: STATIC_VIDEO_URL,
        cover_path: STATIC_IMAGE_URLS[1],
        duration: 42,
        file_size: 2_400_000,
        artifacts: [],
      },
    },
    storyboard: {
      frames: [
        {
          index: 0,
          narration: "尾巴高高竖起，通常表示友好和放松。",
          composed_image_path: STATIC_IMAGE_URLS[1],
        },
      ],
    },
    generation_summary: { status: "completed" },
  },
  [HISTORY_IMAGE_TASK_ID]: {
    metadata: {
      status: "completed",
      input: {
        title: "猫咪为什么喜欢猫薄荷",
        script:
          "猫薄荷并不是每只猫都会喜欢。大约三分之二的猫会对它产生短暂反应。",
      },
      production_template: {
        id: IMAGE_TEMPLATE_ID,
        name: "小红书图文",
      },
      result: {
        artifact_type: "image_set",
        image_paths: [...STATIC_IMAGE_URLS],
        page_count: 3,
        caption: "猫薄荷的反应来自遗传，也会随年龄和状态变化。",
        artifacts: [],
      },
    },
    storyboard: null,
    generation_summary: { status: "completed" },
  },
  [HISTORY_TEXT_TASK_ID]: {
    metadata: {
      status: "completed",
      input: { title: "第一次养猫的七天准备清单" },
      production_template: { id: TEXT_TEMPLATE_ID, name: "长文" },
      result: {
        artifact_type: "text",
        word_count: 860,
        article:
          "# 第一次养猫的七天准备清单\n\n先准备安静的适应空间，再逐步开放活动区域。稳定的节奏比一次买齐所有用品更重要。",
      },
    },
    storyboard: null,
    generation_summary: { status: "completed" },
  },
  [HISTORY_FAILED_TASK_ID]: {
    metadata: {
      status: "failed",
      input: { title: "猫咪饮水观察记录" },
      production_template: { id: VIDEO_TEMPLATE_ID, name: "图文口播视频" },
      result: {
        artifact_type: "video",
        error: { message: "声音生成服务返回超时。" },
      },
    },
    storyboard: null,
    generation_summary: { status: "failed" },
  },
}

function contentItemForOptions(
  options: ApiFixtureOptions,
  reviewKindOverride?: ApiFixtureOptions["productionReviewKind"]
) {
  const reviewKind = reviewKindOverride ?? options.productionReviewKind
  if (
    !options.contentScript &&
    !options.contentItemStatus &&
    !reviewKind &&
    !options.linkContentToProductionTask
  )
    return contentItem
  const isScriptReview = reviewKind === "script"
  const isSceneReview = reviewKind === "scenes" || reviewKind === "pages"
  return {
    ...contentItem,
    status:
      options.contentItemStatus ??
      (reviewKind ? "pending_review" : contentItem.status),
    links: options.linkContentToProductionTask
      ? {
          ...contentItem.links,
          production_task_ids: ["production-needs_user"],
        }
      : contentItem.links,
    variants: {
      ...contentItem.variants,
      Chinese: {
        ...contentItem.variants.Chinese,
        status:
          options.contentItemStatus === "pending_review" || isScriptReview
            ? "pending"
            : contentItem.variants.Chinese.status,
        script: options.contentScript ?? contentItem.variants.Chinese.script,
      },
    },
    scene_manifest: isSceneReview
      ? {
          review_kind: reviewKind === "pages" ? "image_pages" : "video_scenes",
          confirmed: false,
          updated_at: "2026-07-10T08:05:00Z",
          scenes: [
            {
              scene_id: "scene-1",
              order: 1,
              narration: "猫咪先闻到猫薄荷。",
              image_prompt: "猫咪靠近猫薄荷",
            },
            {
              scene_id: "scene-2",
              order: 2,
              narration: "随后短暂兴奋起来。",
              image_prompt: "猫咪开心翻滚",
            },
          ],
        }
      : null,
  }
}

function reviewContextForOptions(
  options: ApiFixtureOptions,
  requestCounts: Map<string, number>
) {
  const revisionSequence =
    (requestCounts.get(
      `POST /content-items/${CONTENT_ITEM_ID}/revise-review`
    ) ?? 0) > 0
      ? 2
      : 1
  const transitionedToScenes =
    options.transitionScriptToScenes &&
    (requestCounts.get(`POST /content-items/${CONTENT_ITEM_ID}/confirm`) ?? 0) >
      0
  const item = contentItemForOptions(
    options,
    transitionedToScenes ? "scenes" : undefined
  )
  if (item.status !== "pending_review" && item.status !== "draft_ready") {
    return { item, review: null }
  }
  if (item.scene_manifest) {
    const kind = item.scene_manifest.review_kind
    return {
      item,
      review: {
        review_id: `revision-${kind}-${revisionSequence}`,
        item_id: item.item_id,
        version: `v${revisionSequence}`,
        payload: { kind, scene_manifest: item.scene_manifest },
        reference: { title: item.title, variants: item.variants },
        allowed_actions: [
          "direct_edit",
          "regenerate_selected",
          "regenerate_all",
          "confirm",
        ],
      },
    }
  }
  return {
    item,
    review: {
      review_id: `revision-script-${revisionSequence}`,
      item_id: item.item_id,
      version: `v${revisionSequence}`,
      payload: { kind: "script", variants: item.variants },
      reference: null,
      allowed_actions: ["direct_edit", "rewrite_script", "confirm"],
    },
  }
}

function historyDetailForOptions(
  taskId: string,
  options: ApiFixtureOptions
): Record<string, unknown> | undefined {
  const detail = historyDetails[taskId]
  if (!detail || taskId !== HISTORY_TEXT_TASK_ID || !options.article) {
    return detail
  }
  const metadata = detail.metadata as Record<string, unknown>
  const result = metadata.result as Record<string, unknown>
  return {
    ...detail,
    metadata: {
      ...metadata,
      result: { ...result, article: options.article, word_count: 5000 },
    },
  }
}

function runTaskFixture(taskId: string) {
  const state = taskId.replace(/^run-/, "")
  const percentage =
    state === "completed"
      ? 100
      : state === "failed" || state === "cancelled" || state === "interrupted"
        ? 62
        : state === "idle"
          ? 0
          : 38
  return {
    task_id: taskId,
    pipeline_id: "script_to_video",
    status: state,
    progress: generationProgress(percentage, `当前状态：${state}`, state),
    error:
      state === "failed" || state === "interrupted"
        ? {
            layer: "runtime",
            message: "用于界面状态验收的故障信息。",
            exception_type: "FixtureError",
            detail: {},
          }
        : null,
    created_at: "2026-07-11T08:00:00Z",
    updated_at: "2026-07-11T08:01:00Z",
  }
}

function submittedTaskFixture(state: ApiFixtureOptions["submissionState"]) {
  const status =
    state === "unknown"
      ? "provider_reviewing"
      : state === "failed"
        ? "failed"
        : state === "running"
          ? "running"
          : "completed"
  return {
    task_id: SUBMITTED_TASK_ID,
    pipeline_id: "script_to_video",
    status,
    progress: generationProgress(
      status === "completed" ? 100 : status === "failed" ? 62 : 38,
      status === "completed"
        ? "视频已经生成"
        : status === "failed"
          ? "生成没有完成"
          : status === "provider_reviewing"
            ? "正在同步供应商状态"
            : "正在生成视频",
      status
    ),
    error:
      status === "failed"
        ? {
            layer: "runtime",
            message: "渲染节点暂时不可用。",
            exception_type: "FixtureRuntimeError",
            detail: {},
          }
        : null,
    created_at: "2026-07-11T08:00:00Z",
    updated_at: "2026-07-11T08:01:00Z",
  }
}

function submittedVideoResult() {
  return {
    task_id: SUBMITTED_TASK_ID,
    pipeline_id: "script_to_video",
    status: "completed",
    artifact_type: "video",
    artifacts: [],
    primary_video: {
      kind: "video",
      path: "",
      url: STATIC_VIDEO_URL,
      media_type: "video/mp4",
      role: "primary",
      metadata: {},
    },
    duration: 38,
    file_size: 2_100_000,
    storyboard_path: null,
    metadata: {
      production_template: { id: VIDEO_TEMPLATE_ID, name: "图文口播视频" },
      quality_review: { status: "passed", checks: [] },
    },
  }
}

const promptTemplates = {
  default_languages: ["Chinese"],
  script_templates: [
    {
      name: "default-script",
      content: "根据选题撰写口播文案。",
      source: "builtin",
    },
  ],
  split_templates: [
    {
      name: "default-split",
      content: "将文案拆成分镜。",
      source: "builtin",
    },
  ],
}

const frameTemplate = {
  name: "image_default.html",
  display_name: "清爽图文",
  size: "1080x1920",
  width: 1080,
  height: 1920,
  orientation: "portrait",
  path: "1080x1920/image_default.html",
  key: "1080x1920/image_default.html",
  preview_url: null,
}

type ApiFixture = {
  status?: number
  body: unknown
}

function responseFor(
  requestUrl: string,
  method: string,
  options: ApiFixtureOptions,
  requestCounts: Map<string, number>
): ApiFixture | null {
  const url = new URL(requestUrl)
  const path = url.pathname.replace(/^\/api/, "")

  if (method === "GET" && path === "/projects") {
    if (options.projectState === "error") {
      return { status: 503, body: { detail: "项目服务暂时不可用。" } }
    }
    if (options.projectState === "empty") {
      return { body: { default_project_id: null, projects: [] } }
    }
    const configuredProject = {
      ...project,
      name: options.projectName ?? project.name,
    }
    const configuredProjects = options.includeSecondProject
      ? [
          configuredProject,
          {
            ...project,
            project_id: "project-2",
            name: "WhiskerLab 内容计划",
          },
        ]
      : [configuredProject]
    return {
      body: {
        default_project_id: PROJECT_ID,
        projects: configuredProjects,
      },
    }
  }
  if (method === "GET" && path === "/content-items") {
    const count = requestCounts.get(`${method} ${path}`) ?? 1
    if (
      options.contentState === "error" ||
      (options.contentState === "stale" && count > 2)
    ) {
      return { status: 503, body: { detail: "内容服务暂时不可用。" } }
    }
    return {
      body:
        options.contentState === "empty"
          ? []
          : [
              contentItemForOptions(
                options,
                options.transitionScriptToScenes &&
                  (requestCounts.get(
                    `POST /content-items/${CONTENT_ITEM_ID}/confirm`
                  ) ?? 0) > 0
                  ? "scenes"
                  : undefined
              ),
            ],
    }
  }
  if (
    method === "GET" &&
    path === `/content-items/${CONTENT_ITEM_ID}/pending-review`
  ) {
    const count = requestCounts.get(`${method} ${path}`) ?? 1
    if (
      options.contentDetailState === "error" ||
      (options.contentDetailState === "stale" && count > 2)
    ) {
      return { status: 503, body: { detail: "内容详情暂时不可用。" } }
    }
    return { body: reviewContextForOptions(options, requestCounts) }
  }
  if (method === "GET" && path === `/content-items/${CONTENT_ITEM_ID}`) {
    const count = requestCounts.get(`${method} ${path}`) ?? 1
    if (
      options.contentDetailState === "error" ||
      (options.contentDetailState === "stale" && count > 2)
    ) {
      return { status: 503, body: { detail: "内容详情暂时不可用。" } }
    }
    return {
      body: contentItemForOptions(
        options,
        options.transitionScriptToScenes &&
          (requestCounts.get(
            `POST /content-items/${CONTENT_ITEM_ID}/confirm`
          ) ?? 0) > 0
          ? "scenes"
          : undefined
      ),
    }
  }
  if (
    method === "POST" &&
    path === `/content-items/${CONTENT_ITEM_ID}/revise-review`
  ) {
    return {
      body: {
        ...reviewContextForOptions(options, requestCounts).item,
        updated_at: "2026-07-10T08:10:00Z",
      },
    }
  }
  if (
    method === "POST" &&
    path === `/content-items/${CONTENT_ITEM_ID}/confirm`
  ) {
    const confirmationCount = requestCounts.get(`${method} ${path}`) ?? 1
    if (options.transitionScriptToScenes && confirmationCount === 1) {
      const nextReview = contentItemForOptions(options, "scenes")
      return {
        body: {
          ...nextReview,
          variants: Object.fromEntries(
            Object.entries(nextReview.variants).map(([language, variant]) => [
              language,
              { ...variant, status: "confirmed" },
            ])
          ),
        },
      }
    }
    const current = contentItemForOptions(
      options,
      options.transitionScriptToScenes ? "scenes" : undefined
    )
    return {
      body: {
        ...current,
        status: "confirmed",
        variants: Object.fromEntries(
          Object.entries(current.variants).map(([language, variant]) => [
            language,
            { ...variant, status: "confirmed" },
          ])
        ),
        scene_manifest: current.scene_manifest
          ? { ...current.scene_manifest, confirmed: true }
          : null,
      },
    }
  }
  if (method === "GET" && path === "/production-tasks") {
    const count = requestCounts.get(`${method} ${path}`) ?? 1
    if (
      options.contentState === "error" ||
      (options.contentState === "stale" && count > 4)
    ) {
      return { status: 503, body: { detail: "生产任务服务暂时不可用。" } }
    }
    const state = url.searchParams.get("state") as
      "needs_user" | "in_progress" | "failed" | "produced" | "cancelled" | null
    const empty = options.contentState === "empty"
    return {
      body: {
        items:
          !empty && state === "needs_user" ? [workbenchCard("needs_user")] : [],
        counts: {
          needs_user: empty ? 0 : 1,
          in_progress: 0,
          failed: 0,
          produced: 0,
          cancelled: 0,
        },
        next_cursor: null,
      },
    }
  }
  if (method === "GET" && path === "/production-tasks/production-needs_user") {
    return { body: productionTaskFixture("needs_user") }
  }
  if (method === "GET" && path === "/production-tasks/production-submitted-1") {
    return { body: submittedProductionTaskFixture(options, requestCounts) }
  }
  const productionTimelineMatch = path.match(
    /^\/production-tasks\/([^/]+)\/timeline$/
  )
  if (method === "GET" && productionTimelineMatch) {
    return {
      body: productionTimelineFixture(
        decodeURIComponent(productionTimelineMatch[1]),
        options,
        requestCounts
      ),
    }
  }
  if (method === "POST" && path === "/production-tasks") {
    if (options.submissionState === "submit-error") {
      return { status: 503, body: { detail: "生成服务暂时不可用。" } }
    }
    return {
      body: {
        production_task_id: "production-submitted-1",
        content_item_id: CONTENT_ITEM_ID,
        state: "in_progress",
        created: true,
        task: productionTaskFixture("in_progress", "production-submitted-1", [
          SUBMITTED_TASK_ID,
        ]),
      },
    }
  }
  if (
    method === "DELETE" &&
    path === "/production-tasks/production-submitted-1"
  ) {
    return {
      body: productionTaskFixture("cancelled", "production-submitted-1", [
        SUBMITTED_TASK_ID,
      ]),
    }
  }
  if (method === "GET" && path === "/generation/pipelines") {
    return {
      body: {
        default_pipeline: "script_to_video",
        pipelines: pipelineManifests,
      },
    }
  }
  if (method === "GET" && path === "/generation/templates") {
    const count = requestCounts.get(`${method} ${path}`) ?? 1
    if (
      options.productionState === "error" ||
      (options.productionState === "stale" && count > 2)
    ) {
      return { status: 503, body: { detail: "模板服务暂时不可用。" } }
    }
    if (options.productionState === "empty") {
      return { body: { default_template: null, templates: [] } }
    }
    return {
      body: {
        default_template: VIDEO_TEMPLATE_ID,
        templates: templatesForOptions(options),
      },
    }
  }
  if (
    method === "GET" &&
    /^\/generation\/templates\/[^/]+\/generation-config$/.test(path)
  ) {
    const templateId = path.split("/")[3]
    if (
      options.configState === "error" ||
      (options.configState === "partial-error" &&
        templateId === IMAGE_TEMPLATE_ID)
    ) {
      return { status: 503, body: { detail: "模板默认值服务暂时不可用。" } }
    }
    const template = templatesForOptions(options).find(
      (item) => item.id === templateId
    )
    return {
      body: {
        template_id: templateId,
        overridable_keys: (template?.allowed_user_params ?? []).filter(
          (key) => !["title", "template_params", "voice_id"].includes(key)
        ),
        overrides: {},
        base_params: template?.fixed_params ?? {},
        effective_params: template?.fixed_params ?? {},
      },
    }
  }
  if (
    method === "PUT" &&
    /^\/generation\/templates\/[^/]+\/generation-config$/.test(path)
  ) {
    const templateId = path.split("/")[3]
    const template = templatesForOptions(options).find(
      (item) => item.id === templateId
    )
    return {
      body: {
        template_id: templateId,
        overridable_keys: (template?.allowed_user_params ?? []).filter(
          (key) => !["title", "template_params", "voice_id"].includes(key)
        ),
        overrides: { media_workflow: "runninghub/image_flux.json" },
        base_params: template?.fixed_params ?? {},
        effective_params: {
          ...(template?.fixed_params ?? {}),
          media_workflow: "runninghub/image_flux.json",
        },
      },
    }
  }
  if (
    method === "POST" &&
    path === "/generation/assets" &&
    options.submissionState
  ) {
    return {
      body: {
        assets: [
          {
            original_filename: "front.png",
            filename: "front-fixture.png",
            path: "uploads/front-fixture.png",
            kind: "image",
            content_type: "image/png",
            size: 13,
          },
          {
            original_filename: "detail.png",
            filename: "detail-fixture.png",
            path: "uploads/detail-fixture.png",
            kind: "image",
            content_type: "image/png",
            size: 14,
          },
        ],
      },
    }
  }
  if (
    (method === "GET" || method === "DELETE") &&
    path === `/generation/tasks/${SUBMITTED_TASK_ID}` &&
    options.submissionState
  ) {
    return {
      body:
        method === "DELETE"
          ? { ...submittedTaskFixture("running"), status: "cancelled" }
          : submittedTaskFixture(options.submissionState),
    }
  }
  if (
    method === "GET" &&
    path === `/generation/tasks/${SUBMITTED_TASK_ID}/result` &&
    options.submissionState
  ) {
    return options.submissionState === "result-error"
      ? { status: 503, body: { detail: "结果服务暂时不可用。" } }
      : { body: submittedVideoResult() }
  }
  if (
    method === "GET" &&
    path === `/generation/tasks/${HISTORY_IMAGE_TASK_ID}/result`
  ) {
    return {
      body: {
        task_id: HISTORY_IMAGE_TASK_ID,
        pipeline_id: "image_post",
        status: "completed",
        artifact_type: "image_set",
        artifacts: [
          {
            kind: "image",
            path: "",
            url: STATIC_IMAGE_URLS[0],
            media_type: "image/png",
            role: "cover",
            metadata: {},
          },
          {
            kind: "image",
            path: "",
            url: STATIC_IMAGE_URLS[1],
            media_type: "image/png",
            role: "page",
            metadata: {},
          },
        ],
        primary_video: null,
        duration: null,
        file_size: null,
        storyboard_path: null,
        metadata: { page_count: 2 },
      },
    }
  }
  if (
    method === "GET" &&
    /^\/generation\/tasks\/batch-task-[1-3]$/.test(path) &&
    options.enableBatchSubmission
  ) {
    const taskId = path.split("/")[3]
    const item = generationBatch.items.find(
      (candidate) => candidate.task_id === taskId
    )
    return item
      ? {
          body: {
            task_id: taskId,
            pipeline_id: "script_to_video",
            status: item.status,
            progress: item.progress,
            error: item.error,
            created_at: generationBatch.created_at,
            updated_at: generationBatch.updated_at,
          },
        }
      : null
  }
  if (method === "GET" && /^\/generation\/tasks\/run-[^/]+$/.test(path)) {
    return { body: runTaskFixture(decodeURIComponent(path.split("/")[3])) }
  }
  if (method === "GET" && path === "/generation/batches") {
    const count = requestCounts.get(`${method} ${path}`) ?? 1
    if (
      options.taskState === "error" ||
      (options.taskState === "stale" && count > 2)
    ) {
      return { status: 503, body: { detail: "运行列表暂时不可用。" } }
    }
    return {
      body: {
        batches:
          options.includeBatch === false || options.taskState === "empty"
            ? []
            : [generationBatch],
      },
    }
  }
  if (
    method === "POST" &&
    path === "/generation/batches" &&
    options.enableBatchSubmission
  ) {
    return {
      body:
        options.batchSubmissionState === "running"
          ? runningGenerationBatch
          : generationBatch,
    }
  }
  if (
    method === "GET" &&
    path === `/generation/batches/${generationBatch.batch_id}` &&
    options.enableBatchSubmission
  ) {
    return {
      body:
        options.batchSubmissionState === "running"
          ? runningGenerationBatch
          : generationBatch,
    }
  }
  if (
    method === "DELETE" &&
    path === `/generation/batches/${generationBatch.batch_id}` &&
    options.enableBatchSubmission
  ) {
    return { body: cancelledGenerationBatch }
  }
  if (
    method === "POST" &&
    path === `/generation/batches/${generationBatch.batch_id}/items/3/retry` &&
    options.enableBatchSubmission
  ) {
    return { body: completedGenerationBatch }
  }
  if (method === "GET" && path === "/drafting/prompt-templates") {
    return { body: promptTemplates }
  }
  if (method === "GET" && path === "/settings/llm/model-catalog") {
    return {
      body: {
        configured: true,
        default_provider_id: "aihubmix",
        providers: [
          {
            id: "openai",
            label: "OpenAI 直连",
            provider_type: "openai",
            configured: true,
            default_model: "gpt-4.1",
            models: [
              { id: "gpt-4.1", label: "gpt-4.1" },
              { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
            ],
          },
          {
            id: "aihubmix",
            label: "AiHubMix 主账号",
            provider_type: "aihubmix",
            configured: true,
            default_model: "deepseek-v4",
            models: [{ id: "deepseek-v4", label: "deepseek-v4" }],
          },
        ],
      },
    }
  }
  if (method === "GET" && path === "/settings/llm/provider-presets") {
    return {
      body: {
        providers: [
          {
            id: "aihubmix",
            label: "AiHubMix",
            base_url: "https://aihubmix.com/v1",
          },
          {
            id: "openai",
            label: "OpenAI",
            base_url: "https://api.openai.com/v1",
          },
          {
            id: "deepseek",
            label: "DeepSeek",
            base_url: "https://api.deepseek.com",
          },
          {
            id: "minimax",
            label: "MiniMax",
            base_url: "https://api.minimaxi.com/v1",
          },
          {
            id: "kimi",
            label: "Kimi / Moonshot AI",
            base_url: "https://api.moonshot.cn/v1",
          },
          {
            id: "anthropic",
            label: "Anthropic / Claude",
            base_url: "https://api.anthropic.com/v1/",
          },
          {
            id: "xai",
            label: "xAI / Grok",
            base_url: "https://api.x.ai/v1",
          },
          {
            id: "custom_openai",
            label: "自定义 OpenAI 兼容服务",
            base_url: "",
          },
        ],
      },
    }
  }
  if (method === "GET" && path === "/history/tasks") {
    const count = requestCounts.get(`${method} ${path}`) ?? 1
    if (
      options.historyState === "error" ||
      (options.historyState === "stale" && count > 2)
    ) {
      return { status: 503, body: { detail: "作品列表暂时不可用。" } }
    }
    const tasks = options.historyState === "empty" ? [] : historyTasks
    const requestedPage = Number(url.searchParams.get("page") ?? "1")
    return {
      body: {
        tasks,
        total: tasks.length,
        page: Number.isInteger(requestedPage) ? requestedPage : 1,
        page_size: 20,
        total_pages: options.historyPages ?? 1,
      },
    }
  }
  if (method === "GET" && /^\/history\/tasks\/[^/]+$/.test(path)) {
    const taskId = decodeURIComponent(path.split("/")[3] ?? "")
    const detail = historyDetailForOptions(taskId, options)
    return detail
      ? { body: detail }
      : { status: 404, body: { detail: "Task not found." } }
  }
  if (method === "GET" && path === "/history/statistics") {
    return { body: { total_tasks: 4, completed: 3, failed: 1 } }
  }
  if (method === "GET" && path === "/publish/platforms") {
    return { body: { platforms: [{ id: "youtube", label: "YouTube" }] } }
  }
  if (method === "GET" && path === "/publish/timezones") {
    return {
      body: {
        default_timezone: "Asia/Shanghai",
        timezones: ["Asia/Shanghai", "UTC"],
      },
    }
  }
  if (method === "GET" && /^\/publish\/tasks\/[^/]+\/record$/.test(path)) {
    const taskId = decodeURIComponent(path.split("/")[3] ?? "")
    const fixtureState = options.publishAttemptState
    const fixtureRecord = fixtureState
      ? {
          task_id: taskId,
          title: "猫咪尾巴语言",
          caption: "尾巴位置和摆动速度会表达情绪。",
          jobs: [
            {
              platform: "youtube",
              status: fixtureState === "scheduled" ? "queued" : fixtureState,
              buffer_post_id: "buffer-fixture-state",
              public_video_url:
                fixtureState === "published"
                  ? "https://example.invalid/published/state"
                  : null,
              due_at: "2026-07-12T09:00:00Z",
              error:
                fixtureState === "failed" ? "渠道暂时拒绝了这次发布。" : null,
              created_at: "2026-07-10T08:20:00Z",
              updated_at: "2026-07-10T09:01:00Z",
            },
          ],
          created_at: "2026-07-10T08:20:00Z",
          updated_at: "2026-07-10T09:01:00Z",
        }
      : null
    return {
      body: {
        task_id: taskId,
        record: fixtureRecord
          ? fixtureRecord
          : taskId === HISTORY_IMAGE_TASK_ID
            ? {
                task_id: taskId,
                title: "猫咪为什么喜欢猫薄荷",
                caption: "猫薄荷的反应来自遗传。",
                jobs: [
                  {
                    platform: "youtube",
                    status: "published",
                    buffer_post_id: "buffer-fixture-1",
                    public_video_url: "https://example.invalid/published/1",
                    due_at: "2026-07-10T09:00:00Z",
                    error: null,
                    created_at: "2026-07-10T08:20:00Z",
                    updated_at: "2026-07-10T09:01:00Z",
                  },
                ],
                created_at: "2026-07-10T08:20:00Z",
                updated_at: "2026-07-10T09:01:00Z",
              }
            : null,
      },
    }
  }
  if (method === "GET" && path === "/settings/config") {
    const count = requestCounts.get(`${method} ${path}`) ?? 1
    if (
      options.settingsState === "error" ||
      (options.settingsState === "stale" && count > 2)
    ) {
      return { status: 503, body: { detail: "设置服务暂时不可用。" } }
    }
    return { body: { configured: true, config: settings } }
  }
  if (
    method === "GET" &&
    (path === "/settings/image-providers" ||
      path === "/resources/image-providers")
  ) {
    if (!options.imageProvidersReady) {
      return { body: imageProviders }
    }
    return {
      body: {
        ...imageProviders,
        providers: imageProviders.providers.map((provider) =>
          provider.id === "aliyun_bailian"
            ? { ...provider, enabled: true, configured: true }
            : provider
        ),
      },
    }
  }
  if (method === "GET" && path === "/settings/diagnostics") {
    if (options.settingsDiagnosticsState === "error") {
      return { status: 503, body: { detail: "设置诊断服务暂时不可用。" } }
    }
    return {
      body: {
        ok: true,
        checks: [
          {
            id: "llm",
            label: "AI 文案服务",
            ok: true,
            severity: "info",
            message: "已配置模型与服务地址。",
          },
          {
            id: "generation",
            label: "生成引擎",
            ok: true,
            severity: "info",
            message: "本地与云端生成资源可用。",
          },
          {
            id: "publish",
            label: "发布与存储",
            ok: true,
            severity: "info",
            message: "发布渠道与对象存储已就绪。",
          },
        ],
      },
    }
  }
  if (method === "POST" && path === "/settings/llm/models") {
    return {
      body: { models: ["pixelle-test-model", "pixelle-fast-model"] },
    }
  }
  if (method === "GET" && path === "/settings/runninghub/workflows") {
    return { body: { workflows: [] } }
  }
  if (method === "GET" && path === "/resources/bgm") {
    if (options.productionState === "resource-error") {
      return { status: 503, body: { detail: "资源服务暂时不可用。" } }
    }
    return { body: { bgm_files: [] } }
  }
  if (method === "GET" && path === "/resources/templates") {
    if (options.productionState === "resource-error") {
      return { status: 503, body: { detail: "资源服务暂时不可用。" } }
    }
    return { body: { templates: [frameTemplate] } }
  }
  if (
    method === "GET" &&
    (path === "/resources/workflows/media" ||
      path === "/resources/workflows/tts")
  ) {
    if (options.productionState === "resource-error") {
      return { status: 503, body: { detail: "资源服务暂时不可用。" } }
    }
    return {
      body: {
        workflows:
          path === "/resources/workflows/media"
            ? [
                {
                  name: "image_flux.json",
                  display_name: "Flux · RunningHub",
                  source: "runninghub",
                  path: "workflows/runninghub/image_flux.json",
                  key: "runninghub/image_flux.json",
                  workflow_id: "workflow-flux",
                },
                {
                  name: "image_local.json",
                  display_name: "本机图片",
                  source: "selfhost",
                  path: "workflows/selfhost/image_local.json",
                  key: "selfhost/image_local.json",
                  workflow_id: null,
                },
                {
                  name: "video_wan.json",
                  display_name: "Wan 视频 · RunningHub",
                  source: "runninghub",
                  path: "workflows/runninghub/video_wan.json",
                  key: "runninghub/video_wan.json",
                  workflow_id: "workflow-video",
                },
              ]
            : [
                {
                  name: "tts_edge.json",
                  display_name: "Edge TTS · RunningHub",
                  source: "runninghub",
                  path: "workflows/runninghub/tts_edge.json",
                  key: "runninghub/tts_edge.json",
                  workflow_id: "workflow-tts",
                },
              ],
      },
    }
  }
  if (method === "GET" && path === "/frame/template/params") {
    return {
      body: {
        success: true,
        message: "ok",
        template: url.searchParams.get("template") ?? frameTemplate.key,
        media_width: 1080,
        media_height: 1920,
        params: {},
      },
    }
  }
  if (method === "GET" && path === "/help/faq") {
    if (options.helpState === "error") {
      return { status: 503, body: { detail: "帮助内容暂时不可用。" } }
    }
    return {
      body: {
        language: "zh_CN",
        content: "",
        sections:
          options.helpState === "empty"
            ? []
            : [
                {
                  question: "如何开始一次标准视频生产？",
                  answer:
                    "## 从已确认的内容开始\n\n1. 在工作台确认选题与文案\n2. 选择 `图文口播视频` 模板\n3. 核对本次覆盖项后提交\n\n```text\n项目默认 → 模板默认 → 本次覆盖\n```",
                },
                {
                  question: "任务失败后应该从哪里恢复？",
                  answer: `前往[工作台](#/board)打开具体任务查看失败层级，并只重试失败任务。\n\n![图集产物示例](${STATIC_IMAGE_URLS[0]})`,
                },
              ],
      },
    }
  }

  return null
}

async function fulfillJson(route: Route, fixture: ApiFixture) {
  await route.fulfill({
    status: fixture.status ?? 200,
    contentType: "application/json",
    headers: {
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(fixture.body),
  })
}

function visualCardSvg(pathname: string) {
  const variant = pathname.includes("science")
    ? {
        accent: "#256f64",
        background: "#e6f2ee",
        eyebrow: "WHY IT WORKS",
        title: "SCENT +\nGENETICS",
        marker: "02",
      }
    : pathname.includes("guide")
      ? {
          accent: "#9a5a39",
          background: "#f5ebe3",
          eyebrow: "A GENTLE GUIDE",
          title: "SAFE, SHORT\nSESSIONS",
          marker: "03",
        }
      : {
          accent: "#176e62",
          background: "#edf5f2",
          eyebrow: "PETWOODS NOTES",
          title: "CATNIP,\nEXPLAINED",
          marker: "01",
        }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200" viewBox="0 0 900 1200">
  <rect width="900" height="1200" fill="${variant.background}"/>
  <circle cx="710" cy="258" r="250" fill="${variant.accent}" opacity=".12"/>
  <circle cx="764" cy="312" r="138" fill="${variant.accent}" opacity=".16"/>
  <path d="M80 810 C240 650 360 690 452 520 C538 362 690 360 834 420 L834 1040 L80 1040 Z" fill="${variant.accent}" opacity=".13"/>
  <path d="M140 965 C224 820 344 844 420 708 C502 562 630 570 760 628" fill="none" stroke="${variant.accent}" stroke-width="16" stroke-linecap="round"/>
  <g fill="${variant.accent}">
    <ellipse cx="269" cy="813" rx="66" ry="28" transform="rotate(-32 269 813)"/>
    <ellipse cx="434" cy="700" rx="72" ry="30" transform="rotate(26 434 700)"/>
    <ellipse cx="584" cy="620" rx="74" ry="31" transform="rotate(-24 584 620)"/>
  </g>
  <text x="76" y="92" fill="${variant.accent}" font-family="Arial, sans-serif" font-size="28" font-weight="700" letter-spacing="5">${variant.eyebrow}</text>
  <text x="76" y="210" fill="#14201e" font-family="Arial, sans-serif" font-size="100" font-weight="700" letter-spacing="-3">${variant.title
    .split("\n")
    .map(
      (line, index) =>
        `<tspan x="76" dy="${index === 0 ? 0 : 108}">${line}</tspan>`
    )
    .join("")}</text>
  <line x1="76" y1="488" x2="824" y2="488" stroke="${variant.accent}" stroke-width="3"/>
  <text x="76" y="1120" fill="#14201e" font-family="Arial, sans-serif" font-size="25" letter-spacing="2">CALM, EVIDENCE-LED CARE</text>
  <text x="824" y="1120" text-anchor="end" fill="${variant.accent}" font-family="Arial, sans-serif" font-size="34" font-weight="700">${variant.marker}</text>
</svg>`
}

export async function installApiFixtures(
  page: Page,
  options: ApiFixtureOptions = {}
) {
  const unhandled: string[] = []
  const requestCounts = new Map<string, number>()
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const apiPath = url.pathname.replace(/^\/api/, "")
    const requestKey = `${method} ${apiPath}`
    requestCounts.set(requestKey, (requestCounts.get(requestKey) ?? 0) + 1)

    if (
      options.captureJsonRequests &&
      ((method === "POST" &&
        (apiPath === "/production-tasks" ||
          apiPath === "/generation/batches" ||
          /^\/content-items\/[^/]+\/(?:confirm|revise-review)$/.test(
            apiPath
          ))) ||
        (method === "PATCH" && /^\/content-items\/[^/]+$/.test(apiPath)) ||
        (method === "PUT" &&
          /^\/generation\/templates\/[^/]+\/generation-config$/.test(apiPath)))
    ) {
      options.captureJsonRequests.push({
        method,
        path: apiPath,
        body: request.postDataJSON(),
      })
    }

    if (
      options.submissionDelayMs &&
      method === "POST" &&
      apiPath === "/production-tasks"
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.submissionDelayMs)
      )
    }

    if (shouldDelayFixture(apiPath, method, options)) {
      await new Promise((resolve) =>
        setTimeout(resolve, options.delayMs ?? 1_500)
      )
    }

    if (method === "GET" && url.pathname === "/api/files/visual-video.mp4") {
      await route.fulfill({
        status: 200,
        contentType: "video/mp4",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: "",
      })
      return
    }
    if (
      method === "GET" &&
      /^\/api\/files\/visual-card-(?:cover|science|guide)\.svg$/.test(
        url.pathname
      )
    ) {
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: visualCardSvg(url.pathname),
      })
      return
    }
    const fixture = responseFor(request.url(), method, options, requestCounts)
    if (fixture) {
      await fulfillJson(route, fixture)
      return
    }

    unhandled.push(`${method} ${url.pathname}${url.search}`)
    await fulfillJson(route, {
      status: 501,
      body: { detail: "E2E fixture is missing for this request." },
    })
  })
  return unhandled
}

function shouldDelayFixture(
  path: string,
  method: string,
  options: ApiFixtureOptions
) {
  if (method !== "GET") return false
  if (options.projectState === "loading" && path === "/projects") return true
  if (options.contentState === "loading" && path === "/production-tasks") {
    return true
  }
  if (
    options.contentDetailState === "loading" &&
    (/^\/content-items\/[^/]+$/.test(path) ||
      /^\/content-items\/[^/]+\/pending-review$/.test(path))
  ) {
    return true
  }
  if (options.taskState === "loading" && path === "/generation/batches") {
    return true
  }
  if (options.historyState === "loading" && path === "/history/tasks") {
    return true
  }
  if (
    options.productionState === "loading" &&
    path === "/generation/templates"
  ) {
    return true
  }
  if (options.helpState === "loading" && path === "/help/faq") return true
  return options.settingsState === "loading" && path === "/settings/config"
}

export const fixtureIds = {
  actionTemplate: ACTION_TEMPLATE_ID,
  assetTemplate: ASSET_TEMPLATE_ID,
  contentItem: CONTENT_ITEM_ID,
  historyImageTask: HISTORY_IMAGE_TASK_ID,
  historyTextTask: HISTORY_TEXT_TASK_ID,
  historyVideoTask: HISTORY_VIDEO_TASK_ID,
  humanTemplate: HUMAN_TEMPLATE_ID,
  imageTemplate: IMAGE_TEMPLATE_ID,
  i2vTemplate: I2V_TEMPLATE_ID,
  project: PROJECT_ID,
  specialTemplate: I2V_TEMPLATE_ID,
  textTemplate: TEXT_TEMPLATE_ID,
  topicTemplate: TOPIC_TEMPLATE_ID,
  videoTemplate: VIDEO_TEMPLATE_ID,
  submittedTask: SUBMITTED_TASK_ID,
}
