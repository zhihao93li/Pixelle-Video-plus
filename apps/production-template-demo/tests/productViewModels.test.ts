import assert from "node:assert/strict"
import test from "node:test"

import {
  createGenerationDraft,
  resolveGenerationDraft,
  updateGenerationDraft,
} from "../src/lib/productViewModels.ts"

test("generation draft only marks effective overrides as dirty", () => {
  const defaults = { voice: "default", speed: 1, music: false }
  const initial = createGenerationDraft(defaults)
  const changed = updateGenerationDraft(initial, { speed: 1.1, music: true })

  assert.deepEqual(changed.overrides, { speed: 1.1, music: true })
  assert.deepEqual(changed.dirtyKeys, ["speed", "music"])
  assert.deepEqual(resolveGenerationDraft(changed), {
    voice: "default",
    speed: 1.1,
    music: true,
  })
})

test("generation draft removes an override when a value returns to default", () => {
  const initial = createGenerationDraft({ speed: 1, voice: "default" })
  const changed = updateGenerationDraft(initial, { speed: 1.2 })
  const restored = updateGenerationDraft(changed, { speed: 1 })

  assert.deepEqual(restored.overrides, {})
  assert.deepEqual(restored.dirtyKeys, [])
})
