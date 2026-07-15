import assert from "node:assert/strict"
import test from "node:test"

import type { ProductionTemplate } from "../src/lib/generationApi.ts"
import {
  assetDraftForTemplate,
  assetOverridesToInput,
  assetParamPatch,
  assetSettingsToParams,
  longFormParamPatch,
  longFormSettingsToParams,
  standardDraftForTemplate,
  standardParamPatch,
  standardSettingsToParams,
  standardOverridesToInput,
} from "../src/lib/productionDrafts.ts"
import {
  resolveGenerationDraft,
  updateGenerationDraft,
} from "../src/lib/productViewModels.ts"

function template(patch: Partial<ProductionTemplate> = {}): ProductionTemplate {
  return {
    id: "template-standard",
    version: "1",
    display_name: "标准视频",
    description: "",
    project: null,
    channel: null,
    use_case: "",
    runtime_label: "",
    estimated_turnaround: "",
    failure_guidance: "",
    requires_user_assets: false,
    advanced_controls_hidden: false,
    template_tags: [],
    input_requirements: ["script"],
    quality_tier: "basic",
    pipeline_id: "script_to_video",
    fixed_params: {},
    required_capabilities: [],
    user_selectable_runtime: false,
    user_selectable_providers: [],
    enabled: true,
    allowed_user_params: [],
    passthrough_input_fields: [],
    ...patch,
  }
}

test("standard draft starts from the recipe effective fixed params", () => {
  const draft = standardDraftForTemplate(
    template({
      fixed_params: {
        split_template_name: "Narrative Scene Planner",
        split_model: "scene-model",
        frame_template: "1080x1440/custom.html",
        bgm_volume: 0.12,
        tts_voice: "recipe-voice",
        tts_speed: 1.15,
        template_params: { density: "compact" },
      },
    })
  )

  assert.deepEqual(draft.overrides, {})
  assert.deepEqual(draft.dirtyKeys, [])
  assert.deepEqual(
    {
      splitTemplateName: draft.defaults.splitTemplateName,
      splitModel: draft.defaults.splitModel,
      frameTemplate: draft.defaults.frameTemplate,
      bgmVolume: draft.defaults.bgmVolume,
      ttsVoice: draft.defaults.ttsVoice,
      ttsSpeed: draft.defaults.ttsSpeed,
      templateParams: draft.defaults.templateParams,
    },
    {
      splitTemplateName: "Narrative Scene Planner",
      splitModel: "scene-model",
      frameTemplate: "1080x1440/custom.html",
      bgmVolume: 0.12,
      ttsVoice: "recipe-voice",
      ttsSpeed: 1.15,
      templateParams: { density: "compact" },
    }
  )
})

test("unchanged recipe defaults do not enter the standard task input", () => {
  const recipe = template({
    fixed_params: { split_model: "scene-model", tts_speed: 1.15 },
    allowed_user_params: ["split_model", "tts_speed"],
  })
  const draft = standardDraftForTemplate(recipe)

  assert.deepEqual(standardOverridesToInput(recipe, draft.overrides), {})

  const changed = updateGenerationDraft(draft, { ttsSpeed: 1.3 })
  assert.deepEqual(standardOverridesToInput(recipe, changed.overrides), {
    tts_speed: 1.3,
  })

  const restored = updateGenerationDraft(changed, { ttsSpeed: 1.15 })
  assert.deepEqual(standardOverridesToInput(recipe, restored.overrides), {})
})

test("explicitly clearing an inherited setting is encoded as null", () => {
  const recipe = template({
    fixed_params: { bgm_path: "/music/recipe.mp3" },
    allowed_user_params: ["bgm_path"],
  })
  const changed = updateGenerationDraft(standardDraftForTemplate(recipe), {
    bgmPath: "",
  })

  assert.deepEqual(standardOverridesToInput(recipe, changed.overrides), {
    bgm_path: null,
  })
})

test("asset draft keeps recipe volume and does not invent voice or speed overrides", () => {
  const recipe = template({
    pipeline_id: "asset_based",
    input_requirements: ["assets"],
    requires_user_assets: true,
    fixed_params: { bgm_volume: 0.18, bgm_mode: "once" },
    allowed_user_params: [
      "bgm_path",
      "bgm_volume",
      "bgm_mode",
      "voice_id",
      "tts_speed",
    ],
  })
  const draft = assetDraftForTemplate(recipe)

  assert.deepEqual(resolveGenerationDraft(draft), {
    bgmPath: "",
    bgmVolume: 0.18,
    bgmMode: "once",
    voiceId: "",
    ttsSpeed: 1,
  })
  assert.deepEqual(assetOverridesToInput(recipe, draft.overrides), {})
})

test("image provider and model flow through the standard snake-case adapter", () => {
  const recipe = template({
    fixed_params: {
      image_provider: "comfy_workflow",
      image_model: "",
    },
    allowed_user_params: ["image_provider", "image_model"],
  })
  const draft = standardDraftForTemplate(recipe)
  const params = standardSettingsToParams(draft.defaults)
  assert.equal(params.image_provider, "comfy_workflow")
  assert.equal(params.image_model, "")
  assert.deepEqual(standardParamPatch("image_provider", "aliyun_bailian"), {
    imageProvider: "aliyun_bailian",
  })

  const changed = updateGenerationDraft(draft, {
    imageProvider: "aliyun_bailian",
    imageModel: "wanx2.1-t2i-turbo",
  })
  assert.deepEqual(standardOverridesToInput(recipe, changed.overrides), {
    image_provider: "aliyun_bailian",
    image_model: "wanx2.1-t2i-turbo",
  })
})

test("asset and long-form adapters round-trip registered API keys", () => {
  const assetSettings = {
    bgmPath: "music/demo.mp3",
    bgmVolume: 0.25,
    bgmMode: "once" as const,
    voiceId: "voice-a",
    ttsSpeed: 1.2,
  }
  assert.equal(assetSettingsToParams(assetSettings).voice_id, "voice-a")
  assert.deepEqual(assetParamPatch("bgm_volume", 0.4), { bgmVolume: 0.4 })

  const longSettings = {
    wordCount: 2400,
    longFormPrompt: "{script}",
    llmModel: "model-a",
  }
  assert.equal(longFormSettingsToParams(longSettings).word_count, 2400)
  assert.deepEqual(longFormParamPatch("llm_model", "model-b"), {
    llmModel: "model-b",
  })
})
