import assert from "node:assert/strict"
import test from "node:test"

import {
  adaptPublishStatus,
  adaptRunStatus,
  createGenerationDraft,
  resolveGenerationDraft,
  runStatusIsActive,
  runStatusIsCancellable,
  statusIs,
  updateGenerationDraft,
} from "../src/lib/productViewModels.ts"

test("run status adapter distinguishes known aliases from unknown backend states", () => {
  assert.deepEqual(adaptRunStatus(" submitted "), {
    kind: "known",
    value: "queued",
    rawStatus: "submitted",
  })
  assert.deepEqual(adaptRunStatus("PROCESSING"), {
    kind: "known",
    value: "running",
    rawStatus: "processing",
  })
  assert.deepEqual(adaptRunStatus("partial_failed"), {
    kind: "known",
    value: "failed",
    rawStatus: "partial_failed",
  })
  assert.deepEqual(adaptRunStatus("provider_new_state"), {
    kind: "unknown",
    rawStatus: "provider_new_state",
  })
  assert.deepEqual(adaptRunStatus(null), {
    kind: "unknown",
    rawStatus: null,
  })
})

test("publish status adapter does not turn unknown states into idle", () => {
  assert.deepEqual(adaptPublishStatus("queued"), {
    kind: "known",
    value: "scheduled",
    rawStatus: "queued",
  })
  assert.deepEqual(adaptPublishStatus("success"), {
    kind: "known",
    value: "published",
    rawStatus: "success",
  })
  assert.deepEqual(adaptPublishStatus("platform_reviewing"), {
    kind: "unknown",
    rawStatus: "platform_reviewing",
  })
})

test("status checks only match typed known states", () => {
  assert.equal(statusIs(adaptRunStatus("completed"), "completed"), true)
  assert.equal(
    statusIs(adaptRunStatus("provider_new_state"), "completed"),
    false
  )
  assert.equal(runStatusIsActive(adaptRunStatus("running")), true)
  assert.equal(runStatusIsActive(adaptRunStatus("provider_new_state")), false)
  assert.equal(runStatusIsCancellable(adaptRunStatus("running")), true)
  assert.equal(runStatusIsCancellable(adaptRunStatus("cancelling")), false)
})

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

test("generation draft compares nested template parameters by value", () => {
  const initial = createGenerationDraft({
    templateParams: { density: "medium", watermark: false },
  })
  const sameValue = updateGenerationDraft(initial, {
    templateParams: { density: "medium", watermark: false },
  })
  const changed = updateGenerationDraft(initial, {
    templateParams: { density: "high", watermark: false },
  })

  assert.deepEqual(sameValue.dirtyKeys, [])
  assert.deepEqual(changed.dirtyKeys, ["templateParams"])
})
