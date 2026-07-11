import assert from "node:assert/strict"
import test from "node:test"

import {
  buildAssetItems,
  buildProgressRuntimeItems,
  buildQualitySummary,
} from "../src/lib/resultSummary.ts"

test("quality summary marks failed checks as not publishable", () => {
  const summary = buildQualitySummary({
    status: "failed",
    summary: "Video has no audio stream.",
    checks: [
      { id: "file_exists", status: "passed", message: "Video file exists." },
      { id: "audio_present", status: "failed", message: "Video has no audio stream." },
    ],
  })

  assert.equal(summary.label, "不可发布")
  assert.equal(summary.tone, "failed")
  assert.deepEqual(summary.failures, ["Video has no audio stream."])
})

test("quality summary marks warning checks as requiring review", () => {
  const summary = buildQualitySummary({
    status: "warning",
    summary: "Black-frame sampling was skipped.",
    checks: [
      { id: "black_frame_sample", status: "warning", message: "ffmpeg is not available." },
    ],
  })

  assert.equal(summary.label, "需检查")
  assert.equal(summary.tone, "warning")
  assert.deepEqual(summary.warnings, ["ffmpeg is not available."])
})

test("asset items keep the user-facing roles visible", () => {
  const assets = buildAssetItems({
    assets: [
      { role: "final_video", kind: "video", path: "output/task/final.mp4", status: "available" },
      { role: "narration_audio", kind: "audio", path: "output/task/01.mp3", status: "available" },
      { role: "primary_visual", kind: "image", path: "output/task/01.png", status: "missing" },
      { role: "subtitle_text", kind: "subtitle", text: "Scene one.", status: "available" },
    ],
  })

  assert.deepEqual(
    assets.map((asset) => asset.label),
    ["成片视频", "旁白音频", "主要画面", "字幕文案"]
  )
  assert.equal(assets[2].statusLabel, "缺失")
})

test("progress runtime items summarize provider detail without exposing choices", () => {
  const items = buildProgressRuntimeItems({
    provider: "runninghub",
    workflow: "runninghub/image_flux.json",
    media_type: "image",
    runninghub_timeout: 600,
    provider_task_id: "rh-task-1",
    provider_status: "QUEUED",
    ignored: "",
  })

  assert.deepEqual(items, [
    { label: "媒体服务", value: "runninghub" },
    { label: "工作流", value: "runninghub/image_flux.json" },
    { label: "类型", value: "image" },
    { label: "超时", value: "600 秒" },
    { label: "服务任务", value: "rh-task-1" },
    { label: "服务状态", value: "QUEUED" },
  ])
})
