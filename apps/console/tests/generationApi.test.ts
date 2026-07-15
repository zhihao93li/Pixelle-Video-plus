import assert from "node:assert/strict"
import test from "node:test"

import {
  addRunninghubWorkflow,
  cancelGenerationTask,
  checkPublishConfiguration,
  createGenerationTemplateTask,
  fetchBufferChannels,
  generateMediaPreview,
  getFrameTemplateParams,
  getHelpFaq,
  getHistoryTaskDetail,
  getPublishRecord,
  getSettingsConfig,
  getSettingsDiagnostics,
  listResourceBgm,
  listImageProviderResources,
  listResourceMediaWorkflows,
  listResourceTemplates,
  listResourceTtsWorkflows,
  listRunninghubWorkflows,
  listHistoryTasks,
  listPublishTimezones,
  listPromptTemplates,
  loadLlmModels,
  publishTask,
  renderFramePreview,
  resetSettingsConfig,
  setTemplateEnabled,
  synthesizeTtsPreview,
  testComfyuiConnection,
  testLlmConnection,
  uploadGenerationAssets,
  uploadResourceBgm,
  updateSettingsConfig,
  templatesForManagement,
  type ProductionTemplate,
} from "../src/lib/generationApi.ts"

type FetchCall = {
  url: string
  init?: RequestInit
}

test("management template view combines launchable and Codex-only recipes", () => {
  const launchable = { id: "standard" } as ProductionTemplate
  const codexOnly = { id: "codex" } as ProductionTemplate
  const combined = templatesForManagement({
    default_template: "standard",
    templates: [launchable],
    agent_templates: [codexOnly],
  })

  assert.deepEqual(
    combined.map((template) => template.id),
    ["standard", "codex"]
  )
})

test("recipe image provider discovery uses the redacted resource endpoint", async () => {
  const calls = installFetchMock({
    default_provider: "comfy_workflow",
    providers: [],
  })

  await listImageProviderResources()

  assert.equal(calls[0].url, "/api/resources/image-providers")
})

test("prompt template discovery uses the drafting endpoint", async () => {
  const calls = installFetchMock({ templates: [] })

  await listPromptTemplates()

  assert.equal(calls[0].url, "/api/drafting/prompt-templates")
})

function installFetchMock(responseBody: unknown, status = 200) {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit
  ) => {
    calls.push({ url: String(url), init })
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status >= 200 && status < 300 ? "OK" : "Error",
      text: async () => JSON.stringify(responseBody),
    } as Response
  }) as typeof fetch
  return calls
}

test("history list API sends pagination and filter query parameters", async () => {
  const calls = installFetchMock({
    tasks: [],
    total: 0,
    page: 2,
    page_size: 10,
  })

  await listHistoryTasks({
    page: 2,
    pageSize: 10,
    status: "completed",
    sortBy: "completed_at",
    sortOrder: "asc",
  })

  assert.equal(
    calls[0].url,
    "/api/history/tasks?page=2&page_size=10&status=completed&sort_by=completed_at&sort_order=asc"
  )
})

test("history detail and publish record APIs use task-scoped routes", async () => {
  const calls = installFetchMock({ task_id: "task-1", record: null })

  await getHistoryTaskDetail("task-1")
  await getPublishRecord("task-1")

  assert.equal(calls[0].url, "/api/history/tasks/task-1")
  assert.equal(calls[1].url, "/api/publish/tasks/task-1/record")
})

test("publish APIs send selected platforms and copy without provider choices", async () => {
  const calls = installFetchMock({ checks: [] })

  await listPublishTimezones()
  await checkPublishConfiguration(["youtube", "instagram"])
  await publishTask("task-1", {
    platforms: ["youtube"],
    caption: "Caption #petcare",
    title: "Title",
    dueAt: "2026-07-04T09:00:00+08:00",
  })

  assert.equal(calls[0].url, "/api/publish/timezones")
  assert.equal(calls[1].url, "/api/publish/check")
  assert.equal(
    calls[1].init?.body,
    JSON.stringify({ platforms: ["youtube", "instagram"] })
  )
  assert.equal(calls[2].url, "/api/publish/tasks/task-1")
  assert.equal(
    calls[2].init?.body,
    JSON.stringify({
      platforms: ["youtube"],
      caption: "Caption #petcare",
      title: "Title",
      due_at: "2026-07-04T09:00:00+08:00",
    })
  )
})

test("resource APIs read BGM templates and workflows", async () => {
  const calls = installFetchMock({
    bgm_files: [],
    templates: [],
    workflows: [],
  })

  await listResourceBgm()
  await listResourceTemplates()
  await listResourceMediaWorkflows()
  await listResourceTtsWorkflows()

  assert.equal(calls[0].url, "/api/resources/bgm")
  assert.equal(calls[1].url, "/api/resources/templates")
  assert.equal(calls[2].url, "/api/resources/workflows/media")
  assert.equal(calls[3].url, "/api/resources/workflows/tts")
})

test("preview APIs call existing TTS and frame endpoints", async () => {
  const calls = installFetchMock({
    success: true,
    audio_path: "/tmp/output/tts-preview.mp3",
    duration: 2.4,
    frame_path: "/tmp/output/frame-preview.png",
    width: 1080,
    height: 1920,
    template: "1080x1920/image_default.html",
    media_width: 1080,
    media_height: 1440,
    params: {},
  })

  await synthesizeTtsPreview({
    text: "Preview copy",
    inferenceMode: "fish",
    referenceId: "voice-1",
    speed: 1.1,
    fishModel: "s2-pro",
  })
  await renderFramePreview({
    template: "1080x1920/image_default.html",
    title: "Preview title",
    text: "Preview copy",
    templateParams: { accent_color: "#ff0000" },
  })
  await generateMediaPreview({
    prompt: "warm pet care image",
    workflow: "runninghub/image_flux.json",
    mediaType: "image",
    width: 1080,
    height: 1440,
  })
  await getFrameTemplateParams("1080x1920/image_default.html")

  assert.equal(calls[0].url, "/api/tts/synthesize")
  assert.equal(
    calls[0].init?.body,
    JSON.stringify({
      text: "Preview copy",
      inference_mode: "fish",
      reference_id: "voice-1",
      speed: 1.1,
      fish_model: "s2-pro",
    })
  )
  assert.equal(calls[1].url, "/api/frame/render")
  assert.equal(
    calls[1].init?.body,
    JSON.stringify({
      template: "1080x1920/image_default.html",
      title: "Preview title",
      text: "Preview copy",
      template_params: { accent_color: "#ff0000" },
    })
  )
  assert.equal(calls[2].url, "/api/media/generate")
  assert.equal(
    calls[2].init?.body,
    JSON.stringify({
      prompt: "warm pet care image",
      workflow: "runninghub/image_flux.json",
      media_type: "image",
      width: 1080,
      height: 1440,
    })
  )
  assert.equal(
    calls[3].url,
    "/api/frame/template/params?template=1080x1920%2Fimage_default.html"
  )
})

test("settings config APIs read and save shared app configuration", async () => {
  const calls = installFetchMock({ configured: true, config: {} })

  await getSettingsConfig()
  await updateSettingsConfig({
    llm: {
      api_key: "llm-key",
      base_url: "https://aihubmix.com/v1",
      model: "deepseek-v4-flash",
    },
    publish: {
      buffer: {
        api_key: "buffer-key",
        channels: { youtube: "yt-channel" },
      },
    },
  })
  await resetSettingsConfig()

  assert.equal(calls[0].url, "/api/settings/config")
  assert.equal(calls[1].url, "/api/settings/config")
  assert.equal(calls[1].init?.method, "PUT")
  assert.equal(
    calls[1].init?.body,
    JSON.stringify({
      llm: {
        api_key: "llm-key",
        base_url: "https://aihubmix.com/v1",
        model: "deepseek-v4-flash",
      },
      publish: {
        buffer: {
          api_key: "buffer-key",
          channels: { youtube: "yt-channel" },
        },
      },
    })
  )
  assert.equal(calls[2].url, "/api/settings/config/reset")
  assert.equal(calls[2].init?.method, "POST")
})

test("settings diagnostics API reads redacted readiness checks", async () => {
  const calls = installFetchMock({ ok: true, checks: [] })

  await getSettingsDiagnostics()

  assert.equal(calls[0].url, "/api/settings/diagnostics")
})

test("settings action APIs call real backend utilities", async () => {
  const calls = installFetchMock({
    models: [],
    ok: true,
    message: "ok",
    model_count: 0,
    workflows: [],
    channels: [],
    detected_channels: {},
  })

  await loadLlmModels("llm-key", "https://aihubmix.com/v1")
  await testLlmConnection("llm-key", "https://aihubmix.com/v1")
  await testComfyuiConnection("http://127.0.0.1:8188")
  await listRunninghubWorkflows()
  await addRunninghubWorkflow({
    kind: "video",
    name: "wan custom",
    workflowId: "1985909483975188481",
    overwrite: true,
  })
  await fetchBufferChannels("buffer-key")
  await getHelpFaq("zh_CN")

  assert.equal(calls[0].url, "/api/settings/llm/models")
  assert.equal(
    calls[0].init?.body,
    JSON.stringify({ api_key: "llm-key", base_url: "https://aihubmix.com/v1" })
  )
  assert.equal(calls[1].url, "/api/settings/llm/test")
  assert.equal(calls[2].url, "/api/settings/comfyui/test")
  assert.equal(
    calls[2].init?.body,
    JSON.stringify({ comfyui_url: "http://127.0.0.1:8188" })
  )
  assert.equal(calls[3].url, "/api/settings/runninghub/workflows")
  assert.equal(calls[4].url, "/api/settings/runninghub/workflows")
  assert.equal(
    calls[4].init?.body,
    JSON.stringify({
      kind: "video",
      name: "wan custom",
      workflow_id: "1985909483975188481",
      overwrite: true,
    })
  )
  assert.equal(calls[5].url, "/api/settings/buffer/channels")
  assert.equal(calls[5].init?.body, JSON.stringify({ api_key: "buffer-key" }))
  assert.equal(calls[6].url, "/api/help/faq?language=zh_CN")
})

test("asset upload API sends multipart form data without JSON content type", async () => {
  const calls = installFetchMock({ count: 1, assets: [] })
  const file = new File(["image-bytes"], "cat.jpg", { type: "image/jpeg" })
  const bgmFile = new File(["audio-bytes"], "fresh.mp3", { type: "audio/mpeg" })

  await uploadGenerationAssets([file])
  await uploadResourceBgm(bgmFile)

  assert.equal(calls[0].url, "/api/generation/assets")
  assert.equal(calls[0].init?.method, "POST")
  assert.ok(calls[0].init?.body instanceof FormData)
  assert.equal(
    (calls[0].init?.headers as Record<string, string> | undefined)?.[
      "Content-Type"
    ],
    undefined
  )
  assert.equal(calls[1].url, "/api/resources/bgm/upload")
  assert.equal(calls[1].init?.method, "POST")
  assert.ok(calls[1].init?.body instanceof FormData)
  assert.equal(
    (calls[1].init?.headers as Record<string, string> | undefined)?.[
      "Content-Type"
    ],
    undefined
  )
})

test("generic production template task API sends asset template input and metadata", async () => {
  const calls = installFetchMock({
    success: true,
    generation_task_id: "task-1",
  })

  await createGenerationTemplateTask(
    "pipeline_asset_based_base_v1",
    "asset_based",
    {
      assets: ["/tmp/cat.jpg"],
      video_title: "猫咪日常",
      intent: "用用户素材包装成小红书短视频",
      duration: 30,
    },
    "project-1"
  )

  assert.equal(calls[0].url, "/api/production-tasks")
  const body = JSON.parse(String(calls[0].init?.body))
  assert.equal(body.project_id, "project-1")
  assert.equal(body.pipeline_id, "asset_based")
  assert.equal(body.recipe_id, "pipeline_asset_based_base_v1")
  assert.deepEqual(body.input, {
    assets: ["/tmp/cat.jpg"],
    video_title: "猫咪日常",
    intent: "用用户素材包装成小红书短视频",
    duration: 30,
  })
  assert.equal(body.source, "react")
  assert.equal(body.client_name, "react-console")
  assert.match(body.request_id, /^production:/)
})

test("special template task API preserves recipe input and current project identity", async () => {
  const calls = installFetchMock({
    success: true,
    generation_task_id: "task-special",
  })

  await createGenerationTemplateTask(
    "my_digital_human",
    "digital_human",
    {
      character_assets: ["/tmp/character.png"],
      script: "Hello",
      mode: "customize",
    },
    "project-42"
  )

  assert.equal(calls[0].url, "/api/production-tasks")
  const body = JSON.parse(String(calls[0].init?.body))
  assert.equal(body.project_id, "project-42")
  assert.equal(body.pipeline_id, "digital_human")
  assert.equal(body.recipe_id, "my_digital_human")
  assert.deepEqual(body.input, {
    character_assets: ["/tmp/character.png"],
    script: "Hello",
    mode: "customize",
  })
})

test("generation task cancel API uses task-scoped delete route", async () => {
  const calls = installFetchMock({ task_id: "task-1", status: "cancelled" })

  await cancelGenerationTask("task-1")

  assert.equal(calls[0].url, "/api/generation/tasks/task-1")
  assert.equal(calls[0].init?.method, "DELETE")
})

test("template enabled API PUTs the toggle to the enabled route", async () => {
  const calls = installFetchMock({
    id: "pipeline_asset_based_base_v1",
    enabled: false,
  })

  await setTemplateEnabled("pipeline_asset_based_base_v1", false)

  assert.equal(
    calls[0].url,
    "/api/generation/templates/pipeline_asset_based_base_v1/enabled"
  )
  assert.equal(calls[0].init?.method, "PUT")
  assert.equal(calls[0].init?.body, JSON.stringify({ enabled: false }))
})
