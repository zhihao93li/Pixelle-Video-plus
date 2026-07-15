import assert from "node:assert/strict"
import test from "node:test"

import { resolveRoute } from "../src/lib/router.ts"

test("route manifest is the only page-width contract", () => {
  assert.equal(resolveRoute("/create").layout, "wide")
  assert.equal(resolveRoute("/tasks").id, "not-found")
  assert.equal(resolveRoute("/library").layout, "wide")
  assert.equal(resolveRoute("/settings").layout, "standard")
  assert.equal(
    resolveRoute("/create/generate/recipe-video").layout,
    "workspace"
  )
  assert.equal(
    resolveRoute("/create/special/image_to_video/recipe-i2v").layout,
    "workspace"
  )
})

test("removed compatibility routes do not resolve to another product page", () => {
  assert.equal(resolveRoute("/batch").id, "not-found")
  assert.equal(resolveRoute("/create/batch").id, "not-found")
  assert.equal(resolveRoute("/create/special/image_to_video").id, "not-found")
})
