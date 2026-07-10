import assert from "node:assert/strict"
import test from "node:test"

import type {
  GenerationResult,
  GenerationTask,
  ProductionTemplate,
} from "../src/lib/generationApi.ts"
import { productionRunViewModel } from "../src/lib/productionRunAdapters.ts"

function template(): ProductionTemplate {
  return {
    id: "recipe-1",
    version: "1",
    display_name: "图文口播视频",
    description: "",
    project: null,
    channel: null,
    use_case: "",
    runtime_label: "",
    estimated_turnaround: "",
    failure_guidance: "请检查设置后重试。",
    requires_user_assets: false,
    advanced_controls_hidden: false,
    template_tags: [],
    input_requirements: ["script"],
    quality_tier: "basic",
    pipeline_id: "standard",
    entry: "script",
    fixed_params: {},
    required_capabilities: [],
    user_selectable_runtime: false,
    user_selectable_providers: [],
    enabled: true,
    retired: false,
    migration_status: "ready",
    product_entry: "generate",
    streamlit_source: null,
    migration_notes: "",
    allowed_user_params: [],
    passthrough_input_fields: [],
  }
}

function task(patch: Partial<GenerationTask> = {}): GenerationTask {
  return {
    task_id: "task-1",
    pipeline_id: "standard",
    entry: "script",
    status: "running",
    progress: {
      stage: "compose",
      percentage: 45,
      message: "正在合成",
      current: null,
      total: null,
      detail: {},
    },
    error: null,
    created_at: "2026-07-11T00:00:00Z",
    updated_at: "2026-07-11T00:01:00Z",
    ...patch,
  }
}

test("single run adapter owns status and cancel semantics", () => {
  const run = productionRunViewModel({
    isSubmitting: false,
    result: null,
    task: task(),
    template: template(),
  })

  assert.equal(run?.state.kind, "known")
  assert.equal(run?.state.kind === "known" ? run.state.value : null, "running")
  assert.equal(run?.canCancel, true)
  assert.equal(run?.progress, 45)
})

test("completed video result becomes the shared artifact view model", () => {
  const result: GenerationResult = {
    task_id: "task-1",
    pipeline_id: "standard",
    entry: "script",
    status: "completed",
    artifact_type: "video",
    artifacts: [],
    primary_video: {
      kind: "video",
      path: "/tmp/result.mp4",
      url: "http://127.0.0.1:8000/api/files/result.mp4",
      media_type: "video/mp4",
      role: "primary",
      metadata: {},
    },
    duration: 30,
    file_size: 1024,
    storyboard_path: null,
    metadata: { title: "猫咪饮水" },
  }
  const run = productionRunViewModel({
    isSubmitting: false,
    result,
    task: task({
      status: "completed",
      progress: { ...task().progress, percentage: 100 },
    }),
    template: template(),
  })

  assert.equal(run?.artifact?.kind, "video")
  assert.equal(run?.artifact?.title, "猫咪饮水")
  assert.equal(run?.canCancel, false)
})
