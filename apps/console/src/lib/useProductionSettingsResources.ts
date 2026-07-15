import { useCallback, useEffect, useState } from "react"

import { readableError } from "./format.ts"
import {
  listImageProviderResources,
  listPipelines,
  listResourceBgm,
  listResourceMediaWorkflows,
  listResourceTemplates,
  listResourceTtsWorkflows,
  listPromptTemplates,
  getLlmModelCatalog,
  type ImageProviderSetting,
  type PipelineManifest,
  type ResourceBgm,
  type ResourceTemplate,
  type ResourceWorkflow,
  type PromptTemplate,
  type LlmModelProvider,
} from "./generationApi.ts"

export type ProductionSettingsResources = {
  bgm: ResourceBgm[]
  frameTemplates: ResourceTemplate[]
  imageProviders: ImageProviderSetting[]
  mediaWorkflows: ResourceWorkflow[]
  pipelines: PipelineManifest[]
  llmProviders: LlmModelProvider[]
  scriptTemplates: PromptTemplate[]
  splitTemplates: PromptTemplate[]
  ttsWorkflows: ResourceWorkflow[]
}

const emptyResources: ProductionSettingsResources = {
  bgm: [],
  frameTemplates: [],
  imageProviders: [],
  mediaWorkflows: [],
  pipelines: [],
  llmProviders: [],
  scriptTemplates: [],
  splitTemplates: [],
  ttsWorkflows: [],
}

export function useProductionSettingsResources() {
  const [resources, setResources] = useState(emptyResources)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    void Promise.allSettled([
      listResourceBgm(),
      listResourceTemplates(),
      listResourceMediaWorkflows(),
      listResourceTtsWorkflows(),
      listImageProviderResources(),
      listPipelines(),
      listPromptTemplates(),
      getLlmModelCatalog(),
    ]).then((results) => {
      if (cancelled) return
      const [bgm, frames, media, tts, providers, pipelines, prompts, models] = results
      setResources({
        bgm: bgm.status === "fulfilled" ? bgm.value.bgm_files : [],
        frameTemplates:
          frames.status === "fulfilled" ? frames.value.templates : [],
        mediaWorkflows:
          media.status === "fulfilled" ? media.value.workflows : [],
        ttsWorkflows: tts.status === "fulfilled" ? tts.value.workflows : [],
        imageProviders:
          providers.status === "fulfilled" ? providers.value.providers : [],
        pipelines:
          pipelines.status === "fulfilled" ? pipelines.value.pipelines : [],
        llmProviders:
          models.status === "fulfilled" ? models.value.providers : [],
        scriptTemplates:
          prompts.status === "fulfilled" ? prompts.value.script_templates : [],
        splitTemplates:
          prompts.status === "fulfilled" ? prompts.value.split_templates : [],
      })
      const failures = results.flatMap((result) =>
        result.status === "rejected" ? [readableError(result.reason)] : []
      )
      setError(failures.length > 0 ? failures.join("；") : null)
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const addBgm = useCallback((bgm: ResourceBgm) => {
    setResources((current) => ({
      ...current,
      bgm: [bgm, ...current.bgm.filter((item) => item.path !== bgm.path)],
    }))
  }, [])

  const reload = useCallback(() => {
    setIsLoading(true)
    setError(null)
    setReloadToken((value) => value + 1)
  }, [])

  return { addBgm, error, isLoading, reload, resources }
}
