import assert from "node:assert/strict"
import test from "node:test"

import type { ProductionTemplate } from "../src/lib/generationApi.ts"
import {
  buildSpecialTaskInput,
  digitalVoiceDefaults,
  digitalVoiceOverrides,
  resolveSpecialTemplate,
  validateSpecialSubmission,
} from "../src/lib/specialPipelineSurface.ts"

function specialTemplate(
  patch: Partial<ProductionTemplate> & Pick<ProductionTemplate, "id">
): ProductionTemplate {
  return {
    id: patch.id,
    version: "v1",
    display_name: patch.id,
    description: "Special template",
    project: null,
    channel: null,
    use_case: "image_to_video",
    runtime_label: "runtime",
    estimated_turnaround: "2 minutes",
    failure_guidance: "retry",
    requires_user_assets: true,
    advanced_controls_hidden: true,
    template_tags: [],
    input_requirements: ["assets", "prompt"],
    quality_tier: "daily",
    pipeline_id: "i2v",
    drafting: null,
    fixed_params: {},
    required_capabilities: ["media", "persistence"],
    user_selectable_runtime: false,
    user_selectable_providers: [],
    enabled: true,
    allowed_user_params: [],
    passthrough_input_fields: [],
    ...patch,
  }
}

test("special route resolves the exact recipe identity", () => {
  const builtin = specialTemplate({ id: "pixelle_i2v_basic_v1" })
  const custom = specialTemplate({ id: "my_i2v", is_custom: true })

  const exact = resolveSpecialTemplate(
    [builtin, custom],
    "image_to_video",
    "my_i2v"
  )
  assert.equal(exact.kind, "ready")
  if (exact.kind === "ready") {
    assert.equal(exact.template.id, "my_i2v")
  }
})

test("special route never silently falls back for invalid recipe identity", () => {
  const i2v = specialTemplate({ id: "i2v" })
  const action = specialTemplate({
    id: "action",
    use_case: "action_transfer",
    pipeline_id: "action_transfer",
  })
  const disabled = specialTemplate({ id: "disabled", enabled: false })

  assert.equal(
    resolveSpecialTemplate([i2v], "image_to_video", "missing").kind,
    "not_found"
  )
  assert.equal(
    resolveSpecialTemplate([action], "image_to_video", "action").kind,
    "mode_mismatch"
  )
  assert.equal(
    resolveSpecialTemplate([disabled], "image_to_video", "disabled").kind,
    "unavailable"
  )
})

test("I2V batch requires an enabled recipe, images, and a prompt", () => {
  const base = {
    mode: "image_to_video" as const,
    digitalMode: "customize" as const,
    templateEnabled: true,
    imageCount: 3,
    referenceVideoCount: 0,
    characterCount: 0,
    goodsCount: 0,
    prompt: "slow camera push",
    script: "",
    goodsTitle: "",
  }

  assert.deepEqual(validateSpecialSubmission(base), { ok: true })
  assert.equal(validateSpecialSubmission({ ...base, prompt: "" }).ok, false)
  assert.equal(
    validateSpecialSubmission({ ...base, templateEnabled: false }).ok,
    false
  )
  assert.equal(validateSpecialSubmission({ ...base, imageCount: 0 }).ok, false)
})

test("action transfer and both digital-human modes enforce their real inputs", () => {
  const common = {
    templateEnabled: true,
    imageCount: 1,
    referenceVideoCount: 1,
    characterCount: 1,
    goodsCount: 0,
    prompt: "keep facial identity",
    script: "Presenter copy",
    goodsTitle: "",
  }

  assert.equal(
    validateSpecialSubmission({
      ...common,
      mode: "action_transfer",
      digitalMode: "customize",
    }).ok,
    true
  )
  assert.equal(
    validateSpecialSubmission({
      ...common,
      mode: "digital_human",
      digitalMode: "customize",
      imageCount: 0,
      referenceVideoCount: 0,
      prompt: "",
    }).ok,
    true
  )
  assert.equal(
    validateSpecialSubmission({
      ...common,
      mode: "digital_human",
      digitalMode: "digital",
      imageCount: 0,
      referenceVideoCount: 0,
      prompt: "",
      script: "",
    }).ok,
    false
  )
  assert.equal(
    validateSpecialSubmission({
      ...common,
      mode: "digital_human",
      digitalMode: "digital",
      imageCount: 0,
      referenceVideoCount: 0,
      prompt: "",
      goodsCount: 1,
      script: "",
      goodsTitle: "Product",
    }).ok,
    true
  )
})

test("digital voice defaults only become task overrides after a real edit", () => {
  const template = specialTemplate({
    id: "digital",
    use_case: "digital_human",
    pipeline_id: "digital_human",
    fixed_params: {
      tts_inference_mode: "fish",
      tts_voice: "reference-1",
      tts_speed: 1.1,
    },
  })
  const defaults = digitalVoiceDefaults(template)

  assert.deepEqual(defaults, { voice: "reference-1", speed: 1.1 })
  assert.deepEqual(digitalVoiceOverrides(defaults, defaults), {})
  assert.deepEqual(
    digitalVoiceOverrides(defaults, { voice: "reference-2", speed: 1.2 }),
    { tts_voice: "reference-2", tts_speed: 1.2 }
  )
})

test("special task payloads keep single-file identity and omit unchanged voice defaults", () => {
  const action = buildSpecialTaskInput({
    mode: "action_transfer",
    digitalMode: "customize",
    imagePaths: ["/target-1.png", "/target-2.png"],
    referenceVideoPaths: ["/action-1.mp4", "/action-2.mp4"],
    characterPaths: [],
    goodsPaths: [],
    prompt: " keep identity ",
    title: " Action ",
    duration: 0,
    script: "",
    goodsTitle: "",
  })
  assert.deepEqual(action, {
    reference_video: "/action-1.mp4",
    assets: ["/target-1.png"],
    prompt: "keep identity",
    title: "Action",
  })

  const digital = buildSpecialTaskInput({
    mode: "digital_human",
    digitalMode: "customize",
    imagePaths: [],
    referenceVideoPaths: [],
    characterPaths: ["/character.png"],
    goodsPaths: ["/goods.png"],
    prompt: "",
    title: "",
    duration: 0,
    script: " hello ",
    goodsTitle: "",
  })
  assert.deepEqual(digital, {
    character_assets: ["/character.png"],
    script: "hello",
    mode: "customize",
  })
})
