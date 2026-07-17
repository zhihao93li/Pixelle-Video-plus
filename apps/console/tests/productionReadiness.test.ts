import assert from "node:assert/strict"
import test from "node:test"

import {
  appSetupReadiness,
  pipelineReadiness,
} from "../src/lib/productionReadiness.ts"
import type {
  PipelineManifest,
  SettingsDiagnosticCheck,
} from "../src/lib/generationApi.ts"

const checks: SettingsDiagnosticCheck[] = [
  { id: "llm_config", label: "LLM", ok: true, severity: "error", message: "ok" },
  { id: "ffmpeg", label: "FFmpeg", ok: true, severity: "error", message: "ok" },
  {
    id: "runninghub_config",
    label: "RunningHub",
    ok: false,
    severity: "error",
    message: "missing",
  },
  {
    id: "comfyui_config",
    label: "ComfyUI",
    ok: true,
    severity: "warning",
    message: "ok",
  },
  {
    id: "aliyun_bailian_image",
    label: "Aliyun",
    ok: false,
    severity: "info",
    message: "missing",
  },
]

const pipeline: PipelineManifest = {
  id: "script_to_video",
  name: "video",
  description: "",
  category: "",
  product_family: "",
  input: { description: "", required_fields: [], optional_fields: [] },
  stages: [],
  quick_setting_keys: [],
  outputs: [],
  required_capabilities: ["llm", "media", "ffmpeg"],
  access_scope: "public",
  launch_surfaces: ["react"],
}

test("first-use checklist reflects real diagnostics instead of static completion", () => {
  const readiness = appSetupReadiness(checks, true)
  assert.equal(readiness.find((item) => item.id === "content_space")?.ok, true)
  assert.equal(readiness.find((item) => item.id === "image_generation")?.ok, true)
})

test("pipeline readiness follows the selected image provider", () => {
  const workflow = pipelineReadiness(pipeline, checks, "comfy_workflow")
  assert.equal(workflow.every((item) => item.ok), true)

  const aliyun = pipelineReadiness(pipeline, checks, "aliyun_bailian")
  assert.equal(
    aliyun.find((item) => item.id === "aliyun_bailian_image")?.ok,
    false
  )
})
