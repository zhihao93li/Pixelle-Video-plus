import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"

import { ProductionSettingsEditor } from "@/components/shared/ProductionSettingsEditor"
import { AsyncState } from "@/components/shared/AsyncState"
import { InlineError } from "@/components/shared/feedback"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/toast"
import { readableError } from "@/lib/format"
import { productionSettingSections } from "@/lib/productionSettingsFields"
import {
  generateMediaPreview,
  getFrameTemplateParams,
  getTemplateGenerationConfig,
  renderFramePreview,
  synthesizeTtsPreview,
  updateTemplateGenerationConfig,
  uploadGenerationAssets,
  uploadResourceBgm,
  type ProductionTemplate,
  type TemplateGenerationConfig,
} from "@/lib/generationApi"
import { useProductionSettingsResources } from "@/lib/useProductionSettingsResources"

function sameRecord(
  left: Record<string, unknown>,
  right: Record<string, unknown>
) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return Array.from(keys).every(
    (key) =>
      JSON.stringify(left[key]) === JSON.stringify(right[key]) &&
      key in left === key in right
  )
}

export function RecipeGenerationSettings({
  template,
  expertMode,
  onDirtyChange,
  codexOnly = false,
}: {
  template: ProductionTemplate
  expertMode: boolean
  onDirtyChange: (dirty: boolean) => void
  codexOnly?: boolean
}) {
  const toast = useToast()
  const [config, setConfig] = useState<TemplateGenerationConfig | null>(null)
  const [draftOverrides, setDraftOverrides] = useState<Record<string, unknown>>(
    {}
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const resourceState = useProductionSettingsResources()

  useEffect(() => {
    let cancelled = false
    void getTemplateGenerationConfig(template.id)
      .then((next) => {
        if (cancelled) return
        setConfig(next)
        setDraftOverrides(next.overrides)
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(readableError(error))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken, template.id])

  const dirty = config ? !sameRecord(draftOverrides, config.overrides) : false
  const dirtyKeys = useMemo(() => {
    if (!config) return []
    const keys = new Set([
      ...Object.keys(draftOverrides),
      ...Object.keys(config.overrides),
    ])
    return Array.from(keys).filter(
      (key) =>
        JSON.stringify(draftOverrides[key]) !==
          JSON.stringify(config.overrides[key]) ||
        key in draftOverrides !== key in config.overrides
    )
  }, [config, draftOverrides])
  const changedLabels = useMemo(() => {
    if (!config) return []
    const pipeline = resourceState.resources.pipelines.find(
      (item) => item.id === template.pipeline_id
    )
    const labelByKey = new Map(
      productionSettingSections(
        pipeline,
        "recipe",
        config.overridable_keys,
        expertMode
      )
        .flatMap((section) => section.fields)
        .map((field) => [field.key, field.label])
    )
    return dirtyKeys.map((key) => labelByKey.get(key) ?? key)
  }, [
    config,
    dirtyKeys,
    expertMode,
    resourceState.resources.pipelines,
    template.pipeline_id,
  ])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const actions = useMemo(
    () => ({
      previewText: "这是一段用于预览画面与声音的示例文案。",
      renderFrame: renderFramePreview,
      synthesizeTts: synthesizeTtsPreview,
      generateMedia: generateMediaPreview,
      getTemplateParams: getFrameTemplateParams,
      uploadBgm: async (file: File) => (await uploadResourceBgm(file)).bgm_file,
      uploadAudio: async (file: File) => {
        const asset = (await uploadGenerationAssets([file])).assets[0]
        if (!asset || asset.kind !== "audio") {
          throw new Error("上传的文件不是可用的音频。")
        }
        return asset
      },
      onBgmUploaded: resourceState.addBgm,
    }),
    [resourceState.addBgm]
  )

  async function save() {
    if (!config) return
    setIsSaving(true)
    setSaveError(null)
    try {
      const next = await updateTemplateGenerationConfig(
        template.id,
        draftOverrides
      )
      setConfig(next)
      setDraftOverrides(next.overrides)
      toast({
        title: "生产设置已保存",
        description: codexOnly
          ? "Agent 下次使用这份模板时自动读取。"
          : "下次使用这份模板时自动生效。",
        variant: "success",
      })
    } catch (error) {
      setSaveError(readableError(error))
    } finally {
      setIsSaving(false)
    }
  }

  if (isLoading && !config) {
    return (
      <AsyncState
        description="正在同步这份模板的生成方式和默认参数。"
        state="loading"
        title="正在读取生产设置"
      />
    )
  }
  if (loadError && !config) {
    return (
      <AsyncState
        action={
          <Button
            onClick={() => {
              setIsLoading(true)
              setLoadError(null)
              setReloadToken((value) => value + 1)
            }}
            size="sm"
            variant="outline"
          >
            重试
          </Button>
        }
        description={loadError}
        state="error"
        title="生产设置读取失败"
      />
    )
  }
  if (!config) return null

  const values = { ...config.base_params, ...draftOverrides }

  return (
    <div className="flex flex-col gap-4">
      <ProductionSettingsEditor
        actions={actions}
        dirtyKeys={dirtyKeys}
        expertMode={expertMode}
        inheritedValues={config.base_params}
        keys={config.overridable_keys}
        mode="recipe"
        onChange={(key, value) => {
          setSaveError(null)
          setDraftOverrides((current) => ({ ...current, [key]: value }))
        }}
        onChangeMany={(changes) => {
          setSaveError(null)
          setDraftOverrides((current) => ({ ...current, ...changes }))
        }}
        onReset={(key) => {
          setSaveError(null)
          setDraftOverrides((current) => {
            const next = { ...current }
            delete next[key]
            return next
          })
        }}
        onResetMany={(keys) => {
          setSaveError(null)
          setDraftOverrides((current) => {
            const next = { ...current }
            keys.forEach((key) => delete next[key])
            return next
          })
        }}
        onResourcesReload={resourceState.reload}
        resources={resourceState.resources}
        resourcesError={resourceState.error}
        savedOverrides={config.overrides}
        template={template}
        values={values}
      />

      {saveError ? (
        <InlineError message={saveError} title="生产设置保存失败" />
      ) : null}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
        <div className="text-xs text-muted-foreground">
          {dirty
            ? `将修改 ${changedLabels.length} 项：${changedLabels.join("、")}`
            : "生产设置已同步"}
        </div>
        <div className="flex items-center gap-2">
          {dirty ? (
            <Button
              disabled={isSaving}
              onClick={() => setDraftOverrides(config.overrides)}
              size="sm"
              variant="ghost"
            >
              放弃更改
            </Button>
          ) : null}
          <Button
            disabled={isSaving || !dirty}
            onClick={() => void save()}
            size="sm"
          >
            {isSaving ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : null}
            保存生产设置
          </Button>
        </div>
      </div>
    </div>
  )
}
