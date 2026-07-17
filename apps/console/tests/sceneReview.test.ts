import assert from "node:assert/strict"
import test from "node:test"

import { mergeSceneIntoPrevious } from "../src/lib/sceneReview.ts"

test("deleting a scene merges all editable content into its predecessor", () => {
  const merged = mergeSceneIntoPrevious(
    [
      {
        scene_id: "scene-1",
        order: 1,
        narration: "第一段。",
        image_prompt: "画面一",
        duration: 2,
      },
      {
        scene_id: "scene-2",
        order: 2,
        narration: "第二段。",
        image_prompt: "画面二",
        duration: 3,
      },
      {
        scene_id: "scene-3",
        order: 3,
        narration: "第三段。",
        image_prompt: "画面三",
      },
    ],
    1
  )

  assert.deepEqual(merged, [
    {
      scene_id: "scene-1",
      order: 1,
      narration: "第一段。第二段。",
      image_prompt: "画面一画面二",
      duration: 5,
    },
    {
      scene_id: "scene-3",
      order: 2,
      narration: "第三段。",
      image_prompt: "画面三",
    },
  ])
})

test("the first scene cannot be deleted because it has no predecessor", () => {
  const scenes = [
    {
      scene_id: "scene-1",
      order: 1,
      narration: "第一段。",
      image_prompt: "画面一",
    },
  ]
  assert.equal(mergeSceneIntoPrevious(scenes, 0), scenes)
})
