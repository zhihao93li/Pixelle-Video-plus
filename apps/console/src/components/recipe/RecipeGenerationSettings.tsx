import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Loader2, RotateCcw } from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { FrameTemplatePicker } from "@/components/shared/FrameTemplatePicker"
import { InlineError } from "@/components/shared/feedback"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { readableError } from "@/lib/format"
import {
  getTemplateGenerationConfig,
  listResourceMediaWorkflows,
  listResourceTemplates,
  listResourceTtsWorkflows,
  updateTemplateGenerationConfig,
  type ResourceTemplate,
  type ResourceWorkflow,
  type TemplateGenerationConfig,
} from "@/lib/generationApi"
import {
  PART_EDIT_HINTS,
  PART_EDIT_OPTIONS,
  PART_KEY_LABELS,
  PART_LONG_TEXT_KEYS,
  PART_NUMBER_KEYS,
} from "@/lib/pipelineParts"

const CONTENT_KEYS = [
  "split_mode",
  "long_form_prompt",
  "word_count",
  "llm_model",
]
const VISUAL_KEYS = [
  "media_workflow",
  "workflow_key",
  "source",
  "prompt_prefix",
  "image_prompt_visual_context",
  "image_prompt_generation_rules",
]
const VOICE_KEYS = [
  "tts_inference_mode",
  "tts_workflow",
  "tts_voice",
  "tts_speed",
]
const OUTPUT_KEYS = [
  "frame_template",
  "media_width",
  "media_height",
  "bgm_path",
  "bgm_volume",
  "bgm_mode",
  "compose_runtime",
]

const GROUPED_KEYS = new Set([
  ...CONTENT_KEYS,
  ...VISUAL_KEYS,
  ...VOICE_KEYS,
  ...OUTPUT_KEYS,
])
const DEFAULT_PROVIDER = "__recipe_default__"

function sameRecord(
  left: Record<string, unknown>,
  right: Record<string, unknown>
) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) return false
    if (key in left !== key in right) return false
  }
  return true
}

function providerLabel(source: string) {
  if (source === "runninghub") return "RunningHub 云端"
  if (source === "selfhost") return "本机 ComfyUI"
  return source
}

export function RecipeGenerationSettings({
  templateId,
  expertMode,
  onDirtyChange,
}: {
  templateId: string
  expertMode: boolean
  onDirtyChange: (dirty: boolean) => void
}) {
  const toast = useToast()
  const [config, setConfig] = useState<TemplateGenerationConfig | null>(null)
  const [draftOverrides, setDraftOverrides] = useState<Record<string, unknown>>(
    {}
  )
  const [frameTemplates, setFrameTemplates] = useState<ResourceTemplate[]>([])
  const [mediaWorkflows, setMediaWorkflows] = useState<ResourceWorkflow[]>([])
  const [ttsWorkflows, setTtsWorkflows] = useState<ResourceWorkflow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [resourceWarning, setResourceWarning] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const resourceErrors: string[] = []
    void Promise.all([
      getTemplateGenerationConfig(templateId),
      listResourceTemplates().catch((error: unknown) => {
        resourceErrors.push(`画面模板：${readableError(error)}`)
        return { templates: [] }
      }),
      listResourceMediaWorkflows().catch((error: unknown) => {
        resourceErrors.push(`画面生成方式：${readableError(error)}`)
        return { workflows: [] }
      }),
      listResourceTtsWorkflows().catch((error: unknown) => {
        resourceErrors.push(`配音生成方式：${readableError(error)}`)
        return { workflows: [] }
      }),
    ])
      .then(([nextConfig, frames, media, tts]) => {
        if (cancelled) return
        setConfig(nextConfig)
        setDraftOverrides(nextConfig.overrides)
        setFrameTemplates(frames.templates)
        setMediaWorkflows(media.workflows)
        setTtsWorkflows(tts.workflows)
        setResourceWarning(
          resourceErrors.length > 0 ? resourceErrors.join("；") : null
        )
        setLoadError(null)
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
  }, [reloadToken, templateId])

  const dirty = config ? !sameRecord(draftOverrides, config.overrides) : false
  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => {
    return () => onDirtyChange(false)
  }, [onDirtyChange])

  const allowed = useMemo(
    () => new Set(config?.overridable_keys ?? []),
    [config?.overridable_keys]
  )

  function currentValue(key: string): unknown {
    if (key in draftOverrides) return draftOverrides[key]
    return config?.base_params?.[key] ?? ""
  }

  function keyDirty(key: string) {
    if (!config) return false
    return (
      JSON.stringify(draftOverrides[key]) !==
        JSON.stringify(config.overrides[key]) ||
      key in draftOverrides !== key in config.overrides
    )
  }

  function updateValue(key: string, value: string) {
    setSaveError(null)
    setDraftOverrides((current) => {
      const next = { ...current }
      const normalized = value.trim()
      if (!normalized) {
        delete next[key]
      } else {
        const parsed = PART_NUMBER_KEYS.has(key) ? Number(normalized) : value
        if (
          JSON.stringify(parsed) === JSON.stringify(config?.base_params?.[key])
        ) {
          delete next[key]
        } else {
          next[key] = parsed
        }
      }
      return next
    })
  }

  function restoreKey(key: string) {
    setDraftOverrides((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  async function save() {
    setIsSaving(true)
    setSaveError(null)
    try {
      const next = await updateTemplateGenerationConfig(
        templateId,
        draftOverrides
      )
      setConfig(next)
      setDraftOverrides(next.overrides)
      toast({
        title: "生产设置已保存",
        description: "下次使用这份配方时自动生效。",
        variant: "success",
      })
    } catch (error) {
      setSaveError(readableError(error))
    } finally {
      setIsSaving(false)
    }
  }

  function statusForKey(key: string) {
    if (keyDirty(key)) return <Badge variant="warning">未保存</Badge>
    if (config && key in config.overrides)
      return <Badge variant="info">已调整</Badge>
    return null
  }

  function fieldLabel(key: string) {
    return PART_KEY_LABELS[key] ?? key
  }

  function renderField(key: string) {
    if (!allowed.has(key)) return null
    const options = PART_EDIT_OPTIONS[key]
    const value = currentValue(key)
    const isLongText = PART_LONG_TEXT_KEYS.has(key)
    const isFramePicker = key === "frame_template" && frameTemplates.length > 0
    const inputValue = value == null ? "" : String(value)
    const step =
      key === "tts_speed" ? "0.1" : key === "bgm_volume" ? "0.05" : "1"

    return (
      <div
        className={isLongText || isFramePicker ? "sm:col-span-2" : undefined}
        key={key}
      >
        <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
          <label
            className="text-xs text-muted-foreground"
            htmlFor={`recipe-setting-${key}`}
          >
            {fieldLabel(key)}
          </label>
          <div className="flex items-center gap-1.5">
            {statusForKey(key)}
            {key in draftOverrides ? (
              <Button
                aria-label={`恢复${fieldLabel(key)}的配方内置值`}
                onClick={() => restoreKey(key)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <RotateCcw />
              </Button>
            ) : null}
          </div>
        </div>
        {options ? (
          <Select
            onValueChange={(next) => updateValue(key, next)}
            value={inputValue}
          >
            <SelectTrigger className="w-full" id={`recipe-setting-${key}`}>
              <SelectValue placeholder="使用配方内置值" />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : isFramePicker ? (
          <FrameTemplatePicker
            onChange={(next) => updateValue(key, next)}
            templates={frameTemplates}
            value={inputValue}
          />
        ) : isLongText ? (
          <Textarea
            className="min-h-32 font-mono text-xs leading-5"
            id={`recipe-setting-${key}`}
            onChange={(event) => updateValue(key, event.target.value)}
            value={inputValue}
          />
        ) : (
          <Input
            id={`recipe-setting-${key}`}
            onChange={(event) => updateValue(key, event.target.value)}
            step={PART_NUMBER_KEYS.has(key) ? step : undefined}
            type={PART_NUMBER_KEYS.has(key) ? "number" : "text"}
            value={inputValue}
          />
        )}
        {PART_EDIT_HINTS[key] ? (
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            {PART_EDIT_HINTS[key]}
          </p>
        ) : null}
      </div>
    )
  }

  function renderWorkflowField(
    key: "media_workflow" | "tts_workflow" | "workflow_key",
    label: string,
    workflows: ResourceWorkflow[]
  ) {
    if (!allowed.has(key)) return null
    const current = String(currentValue(key) ?? "")
    const currentProvider = current.includes("/")
      ? current.split("/", 1)[0]
      : DEFAULT_PROVIDER
    const providers = Array.from(new Set(workflows.map((item) => item.source)))
    const providerWorkflows = workflows.filter(
      (item) => item.source === currentProvider
    )
    const currentExists = workflows.some((item) => item.key === current)

    return (
      <div className="sm:col-span-2" key={key}>
        <div className="mb-1.5 flex min-h-5 items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{label}</span>
          <div className="flex items-center gap-1.5">
            {statusForKey(key)}
            {key in draftOverrides ? (
              <Button
                aria-label={`恢复${label}的配方内置值`}
                onClick={() => restoreKey(key)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <RotateCcw />
              </Button>
            ) : null}
          </div>
        </div>
        {workflows.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              onValueChange={(provider) => {
                if (provider === DEFAULT_PROVIDER) {
                  restoreKey(key)
                  return
                }
                const first = workflows.find((item) => item.source === provider)
                if (first) updateValue(key, first.key)
              }}
              value={currentProvider}
            >
              <SelectTrigger
                aria-label={`${label} Provider`}
                className="w-full"
              >
                <SelectValue placeholder="选择 Provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_PROVIDER}>使用系统默认</SelectItem>
                {providers.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {providerLabel(provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentProvider !== DEFAULT_PROVIDER ? (
              <Select
                onValueChange={(next) => updateValue(key, next)}
                value={current}
              >
                <SelectTrigger
                  aria-label={`${label} Workflow`}
                  className="w-full"
                >
                  <SelectValue placeholder="选择 Workflow" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{providerLabel(currentProvider)}</SelectLabel>
                    {!currentExists && current ? (
                      <SelectItem value={current}>{current}</SelectItem>
                    ) : null}
                    {providerWorkflows.map((workflow) => (
                      <SelectItem key={workflow.key} value={workflow.key}>
                        {workflow.name.replace(/\.json$/i, "")}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex min-h-9 items-center rounded-lg border bg-muted/20 px-3 text-xs text-muted-foreground">
                Provider 与 Workflow 均继承系统默认
              </div>
            )}
          </div>
        ) : (
          <Input
            aria-label={label}
            onChange={(event) => updateValue(key, event.target.value)}
            placeholder="暂未读取到 Workflow，可直接填写 key"
            value={current}
          />
        )}
      </div>
    )
  }

  function section(
    title: string,
    description: string,
    content: ReactNode,
    visible: boolean
  ) {
    if (!visible) return null
    return (
      <WorkspacePanel description={description} title={title}>
        <div className="grid gap-4 sm:grid-cols-2">{content}</div>
      </WorkspacePanel>
    )
  }

  if (isLoading && !config) {
    return (
      <AsyncState
        description="正在同步这份配方的生成方式和默认参数。"
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

  const contentKeys = CONTENT_KEYS.filter((key) => allowed.has(key))
  const visualKeys = VISUAL_KEYS.filter((key) => allowed.has(key))
  const voiceKeys = VOICE_KEYS.filter((key) => allowed.has(key))
  const outputKeys = OUTPUT_KEYS.filter((key) => allowed.has(key))
  const expertKeys = config.overridable_keys.filter(
    (key) => !GROUPED_KEYS.has(key)
  )
  const ttsMode = String(currentValue("tts_inference_mode") || "")
  const hasWorkflowDrivenVisual =
    allowed.has("media_workflow") || allowed.has("workflow_key")

  return (
    <>
      {resourceWarning ? (
        <AsyncState
          description={`${resourceWarning}。仍可直接填写已有值。`}
          state="stale"
          title="部分可选资源未同步"
        />
      ) : null}

      {section(
        "内容处理",
        "控制确认稿如何拆分、改写和进入后续生产，不重复管理写稿 Prompt。",
        <>{contentKeys.map(renderField)}</>,
        contentKeys.length > 0
      )}

      {section(
        "画面生成",
        "先选择执行 Provider，再选择该 Provider 下的 Workflow；画面风格与生成规则在同一区域设置。",
        <>
          {allowed.has("media_workflow")
            ? renderWorkflowField(
                "media_workflow",
                "画面生成方式",
                mediaWorkflows
              )
            : null}
          {allowed.has("workflow_key")
            ? renderWorkflowField("workflow_key", "生成方式", mediaWorkflows)
            : null}
          {!hasWorkflowDrivenVisual && allowed.has("source")
            ? renderField("source")
            : null}
          {visualKeys
            .filter(
              (key) =>
                !["media_workflow", "workflow_key", "source"].includes(key)
            )
            .map(renderField)}
        </>,
        visualKeys.length > 0
      )}

      {section(
        "配音",
        "配音引擎是第一层选择；只有使用 ComfyUI 时，才继续选择执行 Provider 和 Workflow。",
        <>
          {renderField("tts_inference_mode")}
          {ttsMode === "comfyui"
            ? renderWorkflowField(
                "tts_workflow",
                "ComfyUI 配音方式",
                ttsWorkflows
              )
            : null}
          {voiceKeys
            .filter(
              (key) => !["tts_inference_mode", "tts_workflow"].includes(key)
            )
            .map(renderField)}
        </>,
        voiceKeys.length > 0
      )}

      {section(
        "版式与输出",
        "设置成品尺寸、版式、音乐和最终合成方式。",
        <>{outputKeys.map(renderField)}</>,
        outputKeys.length > 0
      )}

      {expertMode
        ? section(
            "专家设置",
            "仅保留无法归入产品能力的原始参数；修改后会直接进入生产请求。",
            <>{expertKeys.map(renderField)}</>,
            expertKeys.length > 0
          )
        : null}

      {saveError ? (
        <InlineError message={saveError} title="生产设置保存失败" />
      ) : null}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur">
        <div className="text-xs text-muted-foreground">
          {dirty ? "有尚未保存的生产设置" : "生产设置已同步"}
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
    </>
  )
}
