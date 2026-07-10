import type { Page, Route } from "playwright/test"

const PROJECT_ID = "project-1"
const CONTENT_ITEM_ID = "content-1"
const VIDEO_TEMPLATE_ID = "template-video"
const IMAGE_TEMPLATE_ID = "template-image"
const TEXT_TEMPLATE_ID = "template-text"
const I2V_TEMPLATE_ID = "template-i2v"
const ACTION_TEMPLATE_ID = "template-action"
const HUMAN_TEMPLATE_ID = "template-human"
const HISTORY_IMAGE_TASK_ID = "history-image-set-1"
const HISTORY_TEXT_TASK_ID = "history-text-1"
const HISTORY_FAILED_TASK_ID = "history-failed-1"
const STATIC_IMAGE_URLS = [
  "http://127.0.0.1:8000/api/files/visual-card-cover.svg",
  "http://127.0.0.1:8000/api/files/visual-card-science.svg",
  "http://127.0.0.1:8000/api/files/visual-card-guide.svg",
] as const

const project = {
  project_id: PROJECT_ID,
  name: "PetWoods 内容计划",
  description: "用于正式路由验收的本地项目。",
  status: "active",
  default_drafting_profile_id: "drafting-profile-1",
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
  const requiresAssets = ["i2v", "action_transfer", "digital_human"].includes(
    pipelineId
  )
  return {
    id,
    version: "1.0.0",
    display_name: displayName,
    description: `${displayName}测试配方`,
    project: PROJECT_ID,
    channel: "xiaohongshu",
    use_case: productEntry,
    runtime_label: "标准生成",
    estimated_turnaround: "约 2 分钟",
    failure_guidance: "请检查输入后重试。",
    requires_user_assets: requiresAssets,
    advanced_controls_hidden: true,
    template_tags: ["测试"],
    input_requirements: requiresAssets ? ["assets"] : ["script"],
    quality_tier: "standard",
    pipeline_id: pipelineId,
    entry: requiresAssets ? "assets" : "script",
    fixed_params:
      pipelineId === "standard"
        ? {
            split_mode: "paragraph",
            frame_template: "1080x1920/image_default.html",
            tts_inference_mode: "local",
            tts_voice: "zh-CN-YunjianNeural",
          }
        : {},
    required_capabilities: [],
    user_selectable_runtime: false,
    user_selectable_providers: [],
    enabled: true,
    retired: false,
    migration_status: "ready",
    product_entry: productEntry,
    streamlit_source: null,
    migration_notes: "",
    allowed_user_params: [
      "split_mode",
      "frame_template",
      "tts_inference_mode",
      "tts_voice",
      "workflow_key",
    ],
    passthrough_input_fields: [],
  }
}

const templates = [
  productionTemplate(VIDEO_TEMPLATE_ID, "图文口播视频", "standard"),
  productionTemplate(IMAGE_TEMPLATE_ID, "小红书图文", "image_post"),
  productionTemplate(TEXT_TEMPLATE_ID, "长文", "long_form"),
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
      narrations: ["猫薄荷会让一部分猫咪短暂兴奋。"],
    },
  },
  asset_paths: [],
  links: {
    task_ids: [HISTORY_IMAGE_TASK_ID],
    batch_ids: [],
  },
  metrics: { likes: 128, favorites: 46, comments: 12 },
  automation: {},
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

const settings = {
  project_name: "Pixelle",
  llm: {
    api_key: "test-api-key",
    base_url: "https://api.example.invalid/v1",
    model: "pixelle-test-model",
  },
  comfyui: {
    comfyui_url: "http://127.0.0.1:8188",
    comfyui_api_key: "test-comfyui-key",
    runninghub_api_key: "test-runninghub-key",
    runninghub_concurrent_limit: 2,
    runninghub_instance_type: "standard",
    runninghub_timeout: 300,
    tts: {
      inference_mode: "local",
      fish_audio: {
        api_key: "",
        base_url: "https://example.invalid",
        model: "s1",
        reference_id: "",
      },
    },
  },
  publish: {
    buffer: {
      api_key: "test-buffer-key",
      channels: { youtube: "youtube-test-channel" },
    },
    cos: {
      region: "ap-shanghai",
      bucket: "pixelle-test",
      secret_id: "test-secret-id",
      secret_key: "test-secret-key",
      public_base_url: "https://cdn.example.invalid",
      endpoint_url: "https://cos.example.invalid",
    },
  },
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

const historyTasks = [
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

const draftingProfile = {
  profile_id: "drafting-profile-1",
  name: "项目默认起草配方",
  script_template_name: "default-script",
  split_template_name: "default-split",
  script_model: "test-model",
  split_model: "test-model",
  languages: ["Chinese"],
  language_script_models: {},
  project_id: PROJECT_ID,
  created_at: "2026-07-10T08:00:00Z",
  updated_at: "2026-07-10T08:00:00Z",
}

const scriptReviewTemplates = {
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

function responseFor(requestUrl: string, method: string): ApiFixture | null {
  const url = new URL(requestUrl)
  const path = url.pathname.replace(/^\/api/, "")

  if (method === "GET" && path === "/projects") {
    return { body: { default_project_id: PROJECT_ID, projects: [project] } }
  }
  if (method === "GET" && path === "/content-items") {
    return { body: [contentItem] }
  }
  if (method === "GET" && path === `/content-items/${CONTENT_ITEM_ID}`) {
    return { body: contentItem }
  }
  if (method === "GET" && path === "/generation/templates") {
    return {
      body: {
        default_template: VIDEO_TEMPLATE_ID,
        templates,
      },
    }
  }
  if (
    method === "GET" &&
    /^\/generation\/templates\/[^/]+\/generation-config$/.test(path)
  ) {
    const templateId = path.split("/")[3]
    const template = templates.find((item) => item.id === templateId)
    return {
      body: {
        template_id: templateId,
        overridable_keys: template?.allowed_user_params ?? [],
        overrides: {},
        effective_params: template?.fixed_params ?? {},
      },
    }
  }
  if (
    method === "GET" &&
    path === `/generation/tasks/${HISTORY_IMAGE_TASK_ID}/result`
  ) {
    return {
      body: {
        task_id: HISTORY_IMAGE_TASK_ID,
        pipeline_id: "image_post",
        entry: "script",
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
  if (method === "GET" && path === "/generation/batches") {
    return { body: { batches: [generationBatch] } }
  }
  if (method === "GET" && path === "/generation/script-review/templates") {
    return { body: scriptReviewTemplates }
  }
  if (method === "GET" && path === "/generation/script-review/draft-sets") {
    return { body: { draft_sets: [] } }
  }
  if (method === "GET" && path === "/drafting/profiles") {
    return {
      body: {
        default_profile_id: draftingProfile.profile_id,
        profiles: [draftingProfile],
      },
    }
  }
  if (method === "GET" && path === "/history/tasks") {
    return {
      body: {
        tasks: historyTasks,
        total: historyTasks.length,
        page: 1,
        page_size: 20,
        total_pages: 1,
      },
    }
  }
  if (method === "GET" && /^\/history\/tasks\/[^/]+$/.test(path)) {
    const taskId = decodeURIComponent(path.split("/")[3] ?? "")
    const detail = historyDetails[taskId]
    return detail
      ? { body: detail }
      : { status: 404, body: { detail: "Task not found." } }
  }
  if (method === "GET" && path === "/history/statistics") {
    return { body: { total_tasks: 3, completed: 2, failed: 1 } }
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
    return {
      body: {
        task_id: taskId,
        record:
          taskId === HISTORY_IMAGE_TASK_ID
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
    return { body: { configured: true, config: settings } }
  }
  if (method === "GET" && path === "/settings/diagnostics") {
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
    return { body: { bgm_files: [] } }
  }
  if (method === "GET" && path === "/resources/templates") {
    return { body: { templates: [frameTemplate] } }
  }
  if (
    method === "GET" &&
    (path === "/resources/workflows/media" ||
      path === "/resources/workflows/tts")
  ) {
    return { body: { workflows: [] } }
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
    return {
      body: {
        language: "zh_CN",
        content: "",
        sections: [
          {
            question: "如何开始一次标准视频生产？",
            answer:
              "## 从已确认的内容开始\n\n1. 在工作台确认选题与文案\n2. 选择 `图文口播视频` 配方\n3. 核对本次覆盖项后提交\n\n```text\n项目默认 → 配方默认 → 本次覆盖\n```",
          },
          {
            question: "任务失败后应该从哪里恢复？",
            answer: `前往[任务](#/tasks)查看失败层级，批量生产可仅重试失败项。\n\n![图集产物示例](${STATIC_IMAGE_URLS[0]})`,
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

export async function installApiFixtures(page: Page) {
  const unhandled: string[] = []
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
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
    const fixture = responseFor(request.url(), method)
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

export const fixtureIds = {
  actionTemplate: ACTION_TEMPLATE_ID,
  contentItem: CONTENT_ITEM_ID,
  historyImageTask: HISTORY_IMAGE_TASK_ID,
  humanTemplate: HUMAN_TEMPLATE_ID,
  imageTemplate: IMAGE_TEMPLATE_ID,
  i2vTemplate: I2V_TEMPLATE_ID,
  project: PROJECT_ID,
  specialTemplate: I2V_TEMPLATE_ID,
  textTemplate: TEXT_TEMPLATE_ID,
  videoTemplate: VIDEO_TEMPLATE_ID,
}
