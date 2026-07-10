import assert from "node:assert/strict"
import test from "node:test"

import type { ProductionTemplate } from "../src/lib/generationApi.ts"
import {
  productionStartRoute,
  productionSubmissionSummary,
} from "../src/lib/productionSurface.ts"
import { frameTemplateLabel } from "../src/lib/templateLabels.ts"

function template(
  patch: Partial<ProductionTemplate> = {}
): ProductionTemplate {
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
    pipeline_id: "standard",
    entry: "",
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
    ...patch,
  }
}

test("production routes preserve a special recipe identity", () => {
  const i2v = template({
    id: "template-i2v",
    pipeline_id: "i2v",
    product_entry: "image_to_video",
    input_requirements: ["assets", "prompt"],
    requires_user_assets: true,
  })

  assert.equal(
    productionStartRoute(i2v),
    "/create/special/image_to_video/template-i2v"
  )
})

test("production routes keep direct generation and review flows distinct", () => {
  assert.equal(
    productionStartRoute(template()),
    "/create/generate/template-standard"
  )
  assert.equal(
    productionStartRoute(
      template({ id: "review", product_entry: "script_review" })
    ),
    "/create/script-review"
  )
})

test("only compatible script recipes advertise batch submission", () => {
  assert.equal(productionSubmissionSummary(template()), "单条或文案批量")
  assert.equal(
    productionSubmissionSummary(
      template({
        pipeline_id: "asset_based",
        input_requirements: ["assets"],
        requires_user_assets: true,
      })
    ),
    "单条"
  )
})

test("frame template labels do not expose storage-like keys", () => {
  assert.equal(
    frameTemplateLabel("1080x1920/image_default.html"),
    "经典留白"
  )
  assert.equal(
    frameTemplateLabel("1920x1080/image_wide_darktech.html"),
    "暗黑科技"
  )
})
