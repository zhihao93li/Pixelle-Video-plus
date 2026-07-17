import type { SceneDraft } from "@/lib/generationApi"

export function mergeSceneIntoPrevious(
  scenes: SceneDraft[],
  index: number
): SceneDraft[] {
  if (index <= 0 || index >= scenes.length) return scenes
  const removed = scenes[index]
  const previous = scenes[index - 1]
  const joinText = (first: string, second: string) =>
    [first.trim(), second.trim()].filter(Boolean).join("")
  const mergedDuration = [previous.duration, removed.duration].some(
    (duration) => duration != null
  )
    ? (previous.duration ?? 0) + (removed.duration ?? 0)
    : null

  return scenes
    .filter((_, sceneIndex) => sceneIndex !== index)
    .map((scene, sceneIndex) => {
      const merged =
        sceneIndex === index - 1
          ? {
              ...scene,
              narration: joinText(previous.narration, removed.narration),
              image_prompt: joinText(
                previous.image_prompt,
                removed.image_prompt
              ),
              duration: mergedDuration,
            }
          : scene
      return { ...merged, order: sceneIndex + 1 }
    })
}
