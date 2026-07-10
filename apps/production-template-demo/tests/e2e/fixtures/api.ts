import type { Page, Route } from "playwright/test"

const PROJECT_ID = "project-1"
const CONTENT_ITEM_ID = "content-1"
const VIDEO_TEMPLATE_ID = "template-video"

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
  productionTemplate("template-image", "小红书图文", "image_post"),
  productionTemplate("template-text", "长文", "long_form"),
  productionTemplate("template-i2v", "图生视频", "i2v", "image_to_video"),
  productionTemplate(
    "template-action",
    "动作迁移",
    "action_transfer",
    "action_transfer"
  ),
  productionTemplate(
    "template-human",
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
    task_ids: [],
    batch_ids: [],
  },
  metrics: {},
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
    api_key: "",
    base_url: "https://example.invalid/v1",
    model: "test-model",
  },
  comfyui: {
    comfyui_url: "http://127.0.0.1:8188",
    comfyui_api_key: "",
    runninghub_api_key: "",
    runninghub_concurrent_limit: 1,
    runninghub_instance_type: "",
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
      api_key: "",
      channels: {},
    },
    cos: {
      region: "",
      bucket: "",
      secret_id: "",
      secret_key: "",
      public_base_url: "",
      endpoint_url: "",
    },
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
  if (method === "GET" && path === "/generation/batches") {
    return { body: { batches: [] } }
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
        tasks: [],
        total: 0,
        page: 1,
        page_size: 20,
        total_pages: 0,
      },
    }
  }
  if (method === "GET" && path === "/history/statistics") {
    return { body: { total_tasks: 0, completed: 0, failed: 0 } }
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
  if (method === "GET" && path === "/settings/config") {
    return { body: { configured: false, config: settings } }
  }
  if (method === "GET" && path === "/settings/diagnostics") {
    return { body: { ok: true, checks: [] } }
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

export async function installApiFixtures(page: Page) {
  const unhandled: string[] = []
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const method = request.method()
    const fixture = responseFor(request.url(), method)
    if (fixture) {
      await fulfillJson(route, fixture)
      return
    }

    const url = new URL(request.url())
    unhandled.push(`${method} ${url.pathname}${url.search}`)
    await fulfillJson(route, {
      status: 501,
      body: { detail: "E2E fixture is missing for this request." },
    })
  })
  return unhandled
}

export const fixtureIds = {
  contentItem: CONTENT_ITEM_ID,
  project: PROJECT_ID,
  specialTemplate: "template-i2v",
  videoTemplate: VIDEO_TEMPLATE_ID,
}
