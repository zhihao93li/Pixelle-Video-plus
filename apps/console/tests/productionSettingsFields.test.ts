import assert from "node:assert/strict"
import test from "node:test"

import type { PipelineManifest } from "../src/lib/generationApi.ts"
import { productionSettingSections } from "../src/lib/productionSettingsFields.ts"

function pipeline(id = "script_to_video"): PipelineManifest {
  const stages =
    id === "asset_based"
      ? [
          {
            id: "voice",
            name: "配音",
            description: "",
            setting_keys: ["voice_id", "tts_speed"],
            actor: "system" as const,
          },
          {
            id: "compose",
            name: "合成",
            description: "",
            setting_keys: ["bgm_path", "bgm_volume", "bgm_mode"],
            actor: "system" as const,
          },
        ]
      : [
          {
            id: "split_scenes",
            name: "分镜",
            description: "",
            setting_keys: ["split_template_name", "split_model"],
            actor: "system" as const,
          },
          {
            id: "generate_media",
            name: "每镜画面",
            description: "",
            setting_keys: [
              "image_provider",
              "image_model",
              "media_workflow",
              "template_params",
            ],
            actor: "system" as const,
          },
          {
            id: "compose_video",
            name: "合成",
            description: "",
            setting_keys: ["compose_runtime"],
            actor: "system" as const,
          },
        ]
  return {
    id,
    name: id,
    description: "",
    category: "content",
    product_family: "图文口播",
    input: {
      description: "",
      required_fields: [],
      optional_fields: [],
    },
    stages,
    outputs: [],
    quick_setting_keys: [],
    required_capabilities: [],
    access_scope: "public",
    launch_surfaces: ["react"],
  }
}

function fields(
  mode: "recipe" | "run",
  keys: string[],
  expertMode = false,
  pipelineId = "script_to_video"
) {
  return productionSettingSections(
    pipeline(pipelineId),
    mode,
    keys,
    expertMode
  ).flatMap((section) => section.fields)
}

test("recipe and run mode use different permission keys without filling gaps", () => {
  const keys = ["title", "image_provider", "image_model", "compose_runtime"]
  const recipe = fields("recipe", keys)
  const run = fields("run", keys)

  assert.equal(
    recipe.some((field) => field.key === "title"),
    false
  )
  assert.equal(
    recipe.find((field) => field.key === "compose_runtime")?.readOnly,
    false
  )
  assert.equal(
    run.some((field) => field.key === "title"),
    true
  )
  assert.equal(
    run.find((field) => field.key === "compose_runtime")?.readOnly,
    true
  )
  assert.equal(
    run.find((field) => field.key === "image_provider")?.control,
    "image_provider"
  )
  assert.equal(
    run.find((field) => field.key === "image_model")?.control,
    "image_model"
  )
})

test("image workflows stay available while expert-only workflows remain gated", () => {
  const normal = fields("run", [
    "media_workflow",
    "workflow_key",
    "future_parameter",
  ])
  const expert = fields(
    "run",
    ["media_workflow", "workflow_key", "future_parameter"],
    true
  )

  assert.equal(
    normal.find((field) => field.key === "media_workflow")?.control,
    "workflow"
  )
  assert.equal(
    normal.some((field) => field.key === "workflow_key"),
    false
  )
  assert.equal(
    expert.find((field) => field.key === "workflow_key")?.control,
    "workflow"
  )
  assert.equal(
    normal.find((field) => field.key === "future_parameter")?.readOnly,
    true
  )
})

test("asset production settings are projected through the same registry", () => {
  for (const mode of ["recipe", "run"] as const) {
    const asset = fields(
      mode,
      ["voice_id", "tts_speed", "bgm_path", "bgm_volume", "bgm_mode"],
      false,
      "asset_based"
    )
    assert.deepEqual(asset.map((field) => field.key).sort(), [
      "bgm_mode",
      "bgm_path",
      "bgm_volume",
      "tts_speed",
      "voice_id",
    ])
  }
})

test("frame template parameters are editable as template defaults and run overrides", () => {
  for (const mode of ["recipe", "run"] as const) {
    const visible = fields(mode, ["template_params"])
    assert.equal(
      visible.find((field) => field.key === "template_params")?.control,
      "template_params"
    )
  }
})

test("visible production sections are numbered without skipped drafting-only parts", () => {
  const sections = productionSettingSections(
    pipeline(),
    "recipe",
    ["split_template_name", "image_provider", "compose_runtime"],
    false
  )

  assert.deepEqual(
    sections.map((section) => [section.step, section.title]),
    [
      [1, "分镜"],
      [2, "每镜画面"],
      [3, "合成"],
    ]
  )
})

test("topic writing and scene planning use the same controls in recipe and run modes", () => {
  const topic = pipeline()
  topic.id = "topic_to_video"
  topic.stages = [
    {
      id: "generate_script",
      name: "写稿",
      description: "",
      setting_keys: [
        "script_template_name",
        "script_prompt",
        "script_provider_id",
        "script_model",
        "language_script_models",
      ],
      actor: "system",
    },
    ...topic.stages,
  ]
  const keys = [
    "script_template_name",
    "script_prompt",
    "script_provider_id",
    "script_model",
    "language_script_models",
    "split_template_name",
    "split_model",
  ]

  for (const mode of ["recipe", "run"] as const) {
    const visible = productionSettingSections(topic, mode, keys, false).flatMap(
      (section) => section.fields
    )
    assert.deepEqual(
      visible.map((field) => [field.key, field.control]),
      [
        ["script_template_name", "prompt_template"],
        ["script_model", "text"],
        ["language_script_models", "language_models"],
        ["split_template_name", "prompt_template"],
        ["split_model", "text"],
      ]
    )
    assert.equal(
      visible.some((field) => field.key === "n_scenes"),
      false
    )
  }
})

test("a new stage setting cannot disappear when the frontend has no editor yet", () => {
  const manifest = pipeline()
  manifest.stages[0]?.setting_keys.push("future_stage_setting")

  const visible = productionSettingSections(
    manifest,
    "run",
    ["split_template_name", "future_stage_setting"],
    false
  ).flatMap((section) => section.fields)

  assert.equal(
    visible.find((field) => field.key === "future_stage_setting")?.readOnly,
    true
  )
})
