import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ImageIcon,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  UploadCloud,
  Volume2,
} from "lucide-react"

import { AsyncState } from "@/components/shared/AsyncState"
import { FrameTemplatePicker } from "@/components/shared/FrameTemplatePicker"
import { SearchableSelect } from "@/components/shared/SearchableSelect"
import { InlineError } from "@/components/shared/feedback"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
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
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import {
  settingSourceNote,
  type ProductionSettingMode,
  type ProductionSettingSource,
} from "@/lib/configStages"
import { readableError } from "@/lib/format"
import {
  fileUrlFromPath,
  createPromptTemplate,
  resourceFileUrl,
  type FramePreviewInput,
  type FramePreviewResponse,
  type MediaPreviewInput,
  type MediaPreviewResponse,
  type ProductionTemplate,
  type ResourceBgm,
  type TemplateParamsResponse,
  type TtsPreviewInput,
  type TtsPreviewResponse,
  type UploadedGenerationAsset,
} from "@/lib/generationApi"
import {
  productionSettingSections,
  type ProductionSettingField,
  type ProductionSettingSection,
} from "@/lib/productionSettingsFields"
import type { ProductionSettingsResources } from "@/lib/useProductionSettingsResources"
import { navigate, routeHref } from "@/lib/router"
import { cn } from "@/lib/utils"

export type ProductionSettingsActions = {
  generateMedia?: (input: MediaPreviewInput) => Promise<MediaPreviewResponse>
  getTemplateParams?: (template: string) => Promise<TemplateParamsResponse>
  onBgmUploaded?: (bgm: ResourceBgm) => void
  previewText: string
  renderFrame?: (input: FramePreviewInput) => Promise<FramePreviewResponse>
  synthesizeTts?: (input: TtsPreviewInput) => Promise<TtsPreviewResponse>
  uploadAudio?: (file: File) => Promise<UploadedGenerationAsset>
  uploadBgm?: (file: File) => Promise<ResourceBgm>
}

export type ProductionSettingsEditorProps = {
  actions?: ProductionSettingsActions
  dirtyKeys: string[]
  expertMode: boolean
  inheritedValues: Record<string, unknown>
  keys: string[]
  mode: ProductionSettingMode
  onChange: (key: string, value: unknown) => void
  onChangeMany?: (changes: Record<string, unknown>) => void
  onReset: (key: string) => void
  onResetAll?: () => void
  onResetMany?: (keys: string[]) => void
  onResourcesReload?: () => void
  presentation?: "full" | "quick"
  resources: ProductionSettingsResources
  resourcesError?: string | null
  savedOverrides: Record<string, unknown>
  summary?: string
  template: ProductionTemplate
  values: Record<string, unknown>
}

const NONE_VALUE = "__pixelle_none__"

function valueText(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function normalizeTemplateParam(type: string, value: unknown): unknown {
  if (type === "bool") return value === true || value === "true"
  if (type === "number") {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : 0
  }
  return String(value ?? "")
}

function templateParamDefaults(response: TemplateParamsResponse) {
  return Object.fromEntries(
    Object.entries(response.params).map(([key, config]) => [
      key,
      normalizeTemplateParam(config.type, config.default),
    ])
  )
}

function workflowLabel(source: string) {
  if (source === "runninghub") return "RunningHub 云端"
  if (source === "selfhost") return "本机 ComfyUI"
  return source
}

function isImageWorkflow(name: string) {
  return name.toLowerCase().startsWith("image_")
}

function fieldSource(
  mode: ProductionSettingMode,
  key: string,
  dirty: boolean,
  savedOverrides: Record<string, unknown>
): ProductionSettingSource {
  if (mode === "run") return dirty ? "run" : "recipe"
  return dirty || key in savedOverrides ? "recipe" : "factory"
}

const WIDE_FIELD_CONTROLS = new Set<ProductionSettingField["control"]>([
  "audio",
  "bgm",
  "frame_template",
  "language_models",
  "prompt_template",
  "readonly",
  "template_params",
  "textarea",
])

function fieldUsesFullGrid(field: ProductionSettingField) {
  return (
    WIDE_FIELD_CONTROLS.has(field.control) ||
    ["llm_model", "script_model", "split_model", "title"].includes(field.key)
  )
}

export function ProductionSettingsEditor({
  actions,
  dirtyKeys,
  expertMode,
  inheritedValues,
  keys,
  mode,
  onChange,
  onChangeMany,
  onReset,
  onResetAll,
  onResetMany,
  onResourcesReload,
  presentation = "full",
  resources,
  resourcesError,
  savedOverrides,
  summary,
  template,
  values,
}: ProductionSettingsEditorProps) {
  const dirty = useMemo(() => new Set(dirtyKeys), [dirtyKeys])
  const pipeline = resources.pipelines.find(
    (item) => item.id === template.pipeline_id
  )
  const sections = useMemo(
    () => productionSettingSections(pipeline, mode, keys, expertMode),
    [expertMode, keys, mode, pipeline]
  )
  const [templateParams, setTemplateParams] =
    useState<TemplateParamsResponse | null>(null)
  const [templateParamsError, setTemplateParamsError] = useState<string | null>(
    null
  )
  const [framePreview, setFramePreview] = useState<FramePreviewResponse | null>(
    null
  )
  const [ttsPreview, setTtsPreview] = useState<TtsPreviewResponse | null>(null)
  const [mediaPreview, setMediaPreview] = useState<MediaPreviewResponse | null>(
    null
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [audioName, setAudioName] = useState("")
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null)
  const [promptSaveName, setPromptSaveName] = useState("")
  const [detailsOpen, setDetailsOpen] = useState(false)
  const preferredSectionId =
    sections.find((section) => section.step != null && section.step > 0)?.id ??
    sections[0]?.id ??
    null
  const [openSectionId, setOpenSectionId] = useState<string | null>(
    preferredSectionId
  )
  const effectiveOpenSectionId = sections.some(
    (section) => section.id === openSectionId
  )
    ? openSectionId
    : preferredSectionId

  const frameTemplate = valueText(values.frame_template)
  const loadTemplateParams = actions?.getTemplateParams
  useEffect(() => {
    if (!frameTemplate || !loadTemplateParams) return
    let cancelled = false
    void loadTemplateParams(frameTemplate)
      .then((response) => {
        if (!cancelled) setTemplateParams(response)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTemplateParams(null)
          setTemplateParamsError(readableError(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [frameTemplate, loadTemplateParams])

  function setValue(key: string, value: unknown) {
    setFramePreview(null)
    setTtsPreview(null)
    setMediaPreview(null)
    setActionError(null)
    if (key === "frame_template") {
      setTemplateParams(null)
      setTemplateParamsError(null)
    }
    onChange(key, value)
  }

  function setValues(changes: Record<string, unknown>) {
    setFramePreview(null)
    setTtsPreview(null)
    setMediaPreview(null)
    setActionError(null)
    if (onChangeMany) onChangeMany(changes)
    else Object.entries(changes).forEach(([key, value]) => onChange(key, value))
  }

  function resetValue(key: string) {
    setFramePreview(null)
    setTtsPreview(null)
    setMediaPreview(null)
    setActionError(null)
    if (key === "frame_template") {
      setTemplateParams(null)
      setTemplateParamsError(null)
    }
    onReset(key)
  }

  async function previewFrame() {
    if (!actions?.renderFrame) return
    setBusyAction("frame")
    setActionError(null)
    setFramePreview(null)
    try {
      setFramePreview(
        await actions.renderFrame({
          template:
            valueText(values.frame_template) || "1080x1920/image_default.html",
          title: valueText(values.title),
          text: actions.previewText || "预览示例文案",
          templateParams:
            (values.template_params as Record<string, unknown> | undefined) ??
            undefined,
        })
      )
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setBusyAction(null)
    }
  }

  async function previewTts() {
    if (!actions?.synthesizeTts) return
    setBusyAction("tts")
    setActionError(null)
    setTtsPreview(null)
    try {
      const inferenceMode = valueText(values.tts_inference_mode) as
        "local" | "comfyui" | "fish" | ""
      const voice = valueText(values.tts_voice || values.voice_id).trim()
      setTtsPreview(
        await actions.synthesizeTts({
          text: actions.previewText || "预览示例文案",
          inferenceMode: inferenceMode || undefined,
          workflow: valueText(values.tts_workflow) || undefined,
          voiceId: inferenceMode === "fish" ? undefined : voice || undefined,
          referenceId:
            inferenceMode === "fish" ? voice || undefined : undefined,
          speed: Number(values.tts_speed ?? 1),
          refAudio: valueText(values.ref_audio) || undefined,
        })
      )
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setBusyAction(null)
    }
  }

  async function previewMedia() {
    if (!actions?.generateMedia) return
    setBusyAction("media")
    setActionError(null)
    setMediaPreview(null)
    try {
      const prompt = [
        valueText(values.prompt_prefix),
        valueText(values.image_prompt_visual_context),
        actions.previewText,
      ]
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ")
      setMediaPreview(
        await actions.generateMedia({
          prompt,
          workflow: valueText(values.media_workflow) || undefined,
          mediaType: "image",
          width: Number(values.media_width ?? 1080),
          height: Number(values.media_height ?? 1440),
        })
      )
    } catch (error) {
      setActionError(readableError(error))
    } finally {
      setBusyAction(null)
    }
  }

  function renderStatus(field: ProductionSettingField) {
    const pending = dirty.has(field.key)
    const source = fieldSource(mode, field.key, pending, savedOverrides)
    const label = settingSourceNote(mode, source, pending)
    const resettable = pending || field.key in savedOverrides
    const showSource = pending || (mode === "recipe" && source === "recipe")
    if (!showSource && !resettable) return null
    return (
      <div className="flex items-center gap-1.5">
        {showSource ? (
          <Badge variant={pending ? "warning" : "secondary"}>{label}</Badge>
        ) : null}
        {resettable && !field.readOnly ? (
          <Button
            aria-label={`恢复${field.label}的继承值`}
            onClick={() => resetValue(field.key)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <RotateCcw />
          </Button>
        ) : null}
      </div>
    )
  }

  function renderWorkflow(field: ProductionSettingField) {
    const workflows =
      field.key === "tts_workflow"
        ? resources.ttsWorkflows
        : field.key === "media_workflow"
          ? resources.mediaWorkflows.filter((workflow) =>
              isImageWorkflow(workflow.name)
            )
          : resources.mediaWorkflows
    const current = valueText(values[field.key])
    if (workflows.length === 0) {
      return (
        <Input
          id={`production-setting-${field.key}`}
          onChange={(event) => setValue(field.key, event.target.value)}
          placeholder="暂未读取到 Workflow，可直接填写 key"
          value={current}
        />
      )
    }
    return (
      <Select
        onValueChange={(value) => setValue(field.key, value)}
        value={current}
      >
        <SelectTrigger id={`production-setting-${field.key}`}>
          <SelectValue placeholder="选择 Workflow" />
        </SelectTrigger>
        <SelectContent>
          {Array.from(new Set(workflows.map((item) => item.source))).map(
            (source) => (
              <SelectGroup key={source}>
                <SelectLabel>{workflowLabel(source)}</SelectLabel>
                {workflows
                  .filter((item) => item.source === source)
                  .map((workflow) => (
                    <SelectItem key={workflow.key} value={workflow.key}>
                      {workflow.display_name || workflow.name}
                    </SelectItem>
                  ))}
              </SelectGroup>
            )
          )}
        </SelectContent>
      </Select>
    )
  }

  function renderImageProvider(field: ProductionSettingField) {
    const current = valueText(values[field.key]) || "comfy_workflow"
    return (
      <Select
        onValueChange={(provider) => {
          if (provider === current) return
          setValues(
            provider === "comfy_workflow"
              ? { image_provider: provider, image_model: "" }
              : {
                  image_provider: provider,
                  image_model: "",
                  media_workflow: "",
                }
          )
        }}
        value={current}
      >
        <SelectTrigger id={`production-setting-${field.key}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="comfy_workflow">
            RunningHub / ComfyUI Workflow
          </SelectItem>
          {resources.imageProviders.map((provider) => (
            <SelectItem
              disabled={!provider.enabled || !provider.configured}
              key={provider.id}
              value={provider.id}
            >
              {provider.id === "aliyun_bailian" ? "阿里云百炼" : "火山方舟"}
              {!provider.enabled || !provider.configured ? "（未就绪）" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  function renderImageModel(field: ProductionSettingField) {
    const provider = valueText(values.image_provider) || "comfy_workflow"
    const selected = resources.imageProviders.find(
      (item) => item.id === provider
    )
    const current =
      valueText(values[field.key]) || selected?.default_model || ""
    return (
      <Select
        onValueChange={(value) => setValue(field.key, value)}
        value={current}
      >
        <SelectTrigger id={`production-setting-${field.key}`}>
          <SelectValue placeholder="选择模型" />
        </SelectTrigger>
        <SelectContent>
          {(selected?.models ?? []).map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  function renderPromptTemplate(field: ProductionSettingField) {
    const kind = field.key === "script_template_name" ? "script" : "split"
    const contentKey = kind === "script" ? "script_prompt" : "split_prompt"
    const templates =
      kind === "script" ? resources.scriptTemplates : resources.splitTemplates
    const current = valueText(values[field.key])
    const selected = templates.find((item) => item.name === current)
    const content = valueText(values[contentKey]) || selected?.content || ""
    const hasOverride = Boolean(valueText(values[contentKey]).trim())
    const expanded = expandedPrompt === field.key
    const labels: Record<string, string> = {
      "Short Oral Script": "简短口播文案",
      "Copy-Safe Scene Split": "忠实原文分镜",
    }
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 @sm/setting-control:flex-row">
          <Select
            onValueChange={(value) => {
              setValues({ [field.key]: value, [contentKey]: "" })
            }}
            value={current}
          >
            <SelectTrigger
              className="min-w-0 flex-1"
              id={`production-setting-${field.key}`}
            >
              <SelectValue placeholder="选择提示词" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((item) => (
                <SelectItem key={item.name} value={item.name}>
                  {labels[item.name] || item.name}
                  {item.source === "builtin" ? "（内置）" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="shrink-0"
            disabled={!current}
            onClick={() => setExpandedPrompt(expanded ? null : field.key)}
            type="button"
            variant="outline"
          >
            {expanded ? "收起编辑" : "展开编辑"}
          </Button>
        </div>
        {hasOverride ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs">
            <Badge variant="secondary">自定义正文 · 不跟随提示词库</Badge>
            <Button
              className="h-auto px-0 py-0"
              onClick={() => setValue(contentKey, "")}
              type="button"
              variant="link"
            >
              恢复跟随模板
            </Button>
          </div>
        ) : null}
        {expanded ? (
          <div className="rounded-lg border bg-muted/10 p-3">
            <Textarea
              aria-label={`${field.label}正文`}
              className="min-h-56 resize-y font-mono text-xs"
              onChange={(event) => setValue(contentKey, event.target.value)}
              value={content}
            />
            <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="flex min-w-0 flex-col gap-1.5">
                <FieldLabel
                  className="text-xs"
                  htmlFor={`production-setting-${field.key}-save-name`}
                >
                  保存为新提示词
                </FieldLabel>
                <Input
                  autoComplete="off"
                  id={`production-setting-${field.key}-save-name`}
                  name={`${field.key}_save_name`}
                  onChange={(event) => setPromptSaveName(event.target.value)}
                  placeholder="例如：宠物科普口播…"
                  value={promptSaveName}
                />
              </div>
              <Button
                disabled={!promptSaveName.trim() || !content.trim()}
                onClick={() => {
                  setBusyAction(`save-prompt-${field.key}`)
                  setActionError(null)
                  void createPromptTemplate({
                    kind,
                    name: promptSaveName,
                    content,
                  })
                    .then((response) => {
                      setValue(field.key, response.name)
                      setValue(contentKey, "")
                      setPromptSaveName("")
                      onResourcesReload?.()
                    })
                    .catch((error: unknown) =>
                      setActionError(readableError(error))
                    )
                    .finally(() => setBusyAction(null))
                }}
                type="button"
                variant="outline"
              >
                保存到提示词库
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              直接修改只影响当前{mode === "run" ? "生产" : "模板"}
              ；保存到提示词库后可在其他模板复用。
            </p>
          </div>
        ) : null}
      </div>
    )
  }

  function renderLlmModel(field: ProductionSettingField) {
    const current = valueText(values[field.key])
    const providerKey =
      field.key === "script_model"
        ? "script_provider_id"
        : field.key === "split_model"
          ? "split_provider_id"
          : "llm_provider_id"
    const providerId = valueText(values[providerKey])
    const effectiveProviderId = providerId || resources.llmDefaultProviderId
    const provider = resources.llmProviders.find(
      (item) => item.id === effectiveProviderId
    )
    const effectiveModel = current || provider?.default_model || ""
    const modelOptions = provider
      ? [
          ...(provider.default_model &&
          !provider.models.some((model) => model.id === provider.default_model)
            ? [{ id: provider.default_model, label: provider.default_model }]
            : []),
          ...provider.models,
        ]
      : []
    if (resources.llmProviders.length === 0) {
      return (
        <Input
          id={`production-setting-${field.key}`}
          onChange={(event) => setValue(field.key, event.target.value)}
          placeholder="模型目录不可用，可手动填写模型标识"
          value={current}
        />
      )
    }
    return (
      <div className="flex flex-col gap-2">
        <div className="grid gap-2 @lg/setting-control:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">LLM 服务</span>
            <Select
              onValueChange={(value) => {
                const selectedProvider = resources.llmProviders.find(
                  (item) => item.id === value
                )
                setValues({
                  [providerKey]: value,
                  [field.key]: selectedProvider?.default_model || "",
                })
              }}
              value={effectiveProviderId}
            >
              <SelectTrigger aria-label={`${field.label} LLM 服务`}>
                <SelectValue placeholder="选择 LLM 服务" />
              </SelectTrigger>
              <SelectContent>
                {resources.llmProviders.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">模型</span>
            <SearchableSelect
              disabled={!effectiveProviderId}
              id={`production-setting-${field.key}`}
              onValueChange={(value) =>
                setValues({
                  [providerKey]: effectiveProviderId,
                  [field.key]: value,
                })
              }
              options={modelOptions.map((model) => ({
                label: model.label,
                value: model.id,
              }))}
              placeholder={
                effectiveProviderId ? "尚未配置默认模型" : "先选择 LLM 服务"
              }
              value={effectiveModel}
            />
          </div>
        </div>
        {provider?.error ? (
          <p className="text-xs text-destructive">
            模型目录读取失败：{provider.error}
          </p>
        ) : null}
      </div>
    )
  }

  function renderLanguageModels(field: ProductionSettingField) {
    const current = values[field.key]
    const mapping =
      current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)
        : {}
    const rows = Object.entries(mapping).map(([language, raw]) => {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const selection = raw as Record<string, unknown>
        return {
          language,
          provider_id: valueText(selection.provider_id),
          model: valueText(selection.model),
        }
      }
      return { language, provider_id: "", model: valueText(raw) }
    })
    function updateRows(nextRows: typeof rows) {
      setValue(
        field.key,
        Object.fromEntries(
          nextRows
            .filter((row) => row.language.trim())
            .map((row) => [
              row.language.trim(),
              { provider_id: row.provider_id, model: row.model },
            ])
        )
      )
    }
    return (
      <div className="flex flex-col gap-2">
        {rows.map((row, index) => {
          const provider = resources.llmProviders.find(
            (item) => item.id === row.provider_id
          )
          return (
            <div
              className="grid gap-2 @3xl/setting-control:grid-cols-[9rem_14rem_minmax(0,1fr)_auto]"
              key={`${row.language}-${index}`}
            >
              <Input
                aria-label={`第 ${index + 1} 行语言`}
                onChange={(event) =>
                  updateRows(
                    rows.map((item, rowIndex) =>
                      rowIndex === index
                        ? { ...item, language: event.target.value }
                        : item
                    )
                  )
                }
                placeholder="语言"
                value={row.language}
              />
              <Select
                onValueChange={(providerId) =>
                  updateRows(
                    rows.map((item, rowIndex) =>
                      rowIndex === index
                        ? { ...item, provider_id: providerId, model: "" }
                        : item
                    )
                  )
                }
                value={row.provider_id}
              >
                <SelectTrigger aria-label={`第 ${index + 1} 行 LLM 服务`}>
                  <SelectValue placeholder="选择服务" />
                </SelectTrigger>
                <SelectContent>
                  {resources.llmProviders.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <SearchableSelect
                ariaLabel={`第 ${index + 1} 行模型`}
                disabled={!row.provider_id}
                onValueChange={(model) =>
                  updateRows(
                    rows.map((item, rowIndex) =>
                      rowIndex === index ? { ...item, model } : item
                    )
                  )
                }
                options={(provider?.models ?? []).map((model) => ({
                  label: model.label,
                  value: model.id,
                }))}
                placeholder={row.provider_id ? "选择模型" : "先选择 LLM 服务"}
                value={row.model}
              />
              <Button
                aria-label={`删除第 ${index + 1} 行`}
                onClick={() =>
                  updateRows(rows.filter((_, rowIndex) => rowIndex !== index))
                }
                type="button"
                variant="ghost"
              >
                删除
              </Button>
            </div>
          )
        })}
        <Button
          className="self-start"
          onClick={() =>
            updateRows([
              ...rows,
              { language: "新语言", provider_id: "", model: "" },
            ])
          }
          type="button"
          variant="outline"
        >
          添加语言
        </Button>
      </div>
    )
  }

  function renderTemplateParams(field: ProductionSettingField) {
    if (templateParamsError) {
      return (
        <InlineError message={templateParamsError} title="排版参数读取失败" />
      )
    }
    if (!templateParams) {
      return (
        <div className="text-sm text-muted-foreground">正在读取模板参数…</div>
      )
    }
    const current = {
      ...templateParamDefaults(templateParams),
      ...((values[field.key] as Record<string, unknown> | undefined) ?? {}),
    }
    const entries = Object.entries(templateParams.params)
    if (entries.length === 0) {
      return (
        <div className="text-sm text-muted-foreground">
          当前模板没有额外排版参数。
        </div>
      )
    }
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {entries.map(([key, config]) => (
          <label
            className="flex flex-col gap-1.5 text-xs text-muted-foreground"
            key={key}
          >
            {config.label || key}
            {config.type === "bool" ? (
              <input
                checked={Boolean(current[key])}
                className="size-4"
                onChange={(event) =>
                  setValue(field.key, {
                    ...current,
                    [key]: event.target.checked,
                  })
                }
                type="checkbox"
              />
            ) : (
              <Input
                onChange={(event) =>
                  setValue(field.key, {
                    ...current,
                    [key]: normalizeTemplateParam(
                      config.type,
                      event.target.value
                    ),
                  })
                }
                type={
                  config.type === "number"
                    ? "number"
                    : config.type === "color"
                      ? "color"
                      : "text"
                }
                value={valueText(current[key])}
              />
            )}
          </label>
        ))}
      </div>
    )
  }

  function renderBgm(field: ProductionSettingField) {
    const current = valueText(values[field.key])
    return (
      <div className="flex flex-col gap-3">
        <Select
          onValueChange={(value) =>
            setValue(field.key, value === NONE_VALUE ? "" : value)
          }
          value={current || NONE_VALUE}
        >
          <SelectTrigger id={`production-setting-${field.key}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>不指定背景音乐</SelectItem>
            {resources.bgm.map((bgm) => (
              <SelectItem key={bgm.path} value={bgm.path}>
                {bgm.name} · {bgm.source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {actions?.uploadBgm ? (
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-primary hover:underline">
            <UploadCloud className="size-4" />
            上传新的背景音乐
            <input
              accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (!file || !actions.uploadBgm) return
                setBusyAction("bgm-upload")
                setActionError(null)
                void actions
                  .uploadBgm(file)
                  .then((bgm) => {
                    actions.onBgmUploaded?.(bgm)
                    setValue(field.key, bgm.path)
                  })
                  .catch((error: unknown) =>
                    setActionError(readableError(error))
                  )
                  .finally(() => setBusyAction(null))
              }}
              type="file"
            />
          </label>
        ) : null}
        {current && resourceFileUrl(current) ? (
          <audio
            className="w-full"
            controls
            src={resourceFileUrl(current) ?? undefined}
          />
        ) : null}
      </div>
    )
  }

  function renderAudio(field: ProductionSettingField) {
    const inherited = valueText(inheritedValues[field.key])
    return (
      <div className="flex flex-col gap-2">
        <Input
          accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg"
          disabled={!actions?.uploadAudio || busyAction === "audio-upload"}
          id={`production-setting-${field.key}`}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (!file || !actions?.uploadAudio) return
            setBusyAction("audio-upload")
            setActionError(null)
            void actions
              .uploadAudio(file)
              .then((asset) => {
                setAudioName(asset.original_filename)
                setValue(field.key, asset.path)
              })
              .catch((error: unknown) => setActionError(readableError(error)))
              .finally(() => setBusyAction(null))
          }}
          type="file"
        />
        <div className="text-xs text-muted-foreground">
          {audioName ||
            (values[field.key]
              ? "已选择参考音频"
              : inherited
                ? "沿用模板参考音频"
                : "未选择参考音频")}
        </div>
      </div>
    )
  }

  function renderControl(field: ProductionSettingField) {
    const current = values[field.key]
    if (field.control === "readonly") {
      return (
        <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
          <div>{valueText(current) || "未设置"}</div>
          {field.key === "compose_runtime" && mode === "run" ? (
            <Button
              className="mt-2 px-0"
              onClick={() => navigate(`/create/recipes/${template.id}`)}
              size="sm"
              type="button"
              variant="link"
            >
              前往模板修改长期默认
            </Button>
          ) : null}
        </div>
      )
    }
    if (field.control === "frame_template") {
      return (
        <FrameTemplatePicker
          onChange={(value) => setValue(field.key, value)}
          templates={resources.frameTemplates}
          value={valueText(current)}
        />
      )
    }
    if (field.control === "template_params") return renderTemplateParams(field)
    if (field.control === "prompt_template") return renderPromptTemplate(field)
    if (["script_model", "split_model", "llm_model"].includes(field.key)) {
      return renderLlmModel(field)
    }
    if (field.control === "language_models") return renderLanguageModels(field)
    if (field.control === "image_provider") return renderImageProvider(field)
    if (field.control === "image_model") return renderImageModel(field)
    if (field.control === "workflow") return renderWorkflow(field)
    if (field.control === "bgm") return renderBgm(field)
    if (field.control === "audio") return renderAudio(field)
    if (field.control === "textarea") {
      return (
        <Textarea
          className="min-h-28 resize-y"
          id={`production-setting-${field.key}`}
          onChange={(event) => setValue(field.key, event.target.value)}
          value={valueText(current)}
        />
      )
    }
    if (field.control === "select") {
      const followsSystemTts = field.key === "tts_inference_mode"
      return (
        <Select
          onValueChange={(value) =>
            setValue(
              field.key,
              followsSystemTts && value === "__system__" ? "" : value
            )
          }
          value={
            followsSystemTts
              ? valueText(current) || "__system__"
              : valueText(current)
          }
        >
          <SelectTrigger id={`production-setting-${field.key}`}>
            <SelectValue placeholder="选择" />
          </SelectTrigger>
          <SelectContent>
            {followsSystemTts ? (
              <SelectItem value="__system__">跟随系统默认</SelectItem>
            ) : null}
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }
    if (field.control === "slider") {
      const isSpeed = field.key === "tts_speed"
      const numeric = Number(current ?? (isSpeed ? 1 : 0.2))
      return (
        <Slider
          aria-label={field.label}
          id={`production-setting-${field.key}`}
          max={isSpeed ? 2 : 1}
          min={isSpeed ? 0.5 : 0}
          onValueChange={([value]) => setValue(field.key, value ?? numeric)}
          step={isSpeed ? 0.1 : 0.05}
          value={[numeric]}
        />
      )
    }
    return (
      <Input
        id={`production-setting-${field.key}`}
        onChange={(event) =>
          setValue(
            field.key,
            field.control === "number"
              ? Number(event.target.value || 0)
              : event.target.value
          )
        }
        type={field.control === "number" ? "number" : "text"}
        value={valueText(current)}
      />
    )
  }

  function renderField(field: ProductionSettingField) {
    const imageProvider = valueText(values.image_provider) || "comfy_workflow"
    if (field.key === "media_workflow" && imageProvider !== "comfy_workflow") {
      return null
    }
    if (field.key === "image_model" && imageProvider === "comfy_workflow") {
      return null
    }
    return (
      <Field
        className={cn(
          "min-w-0 gap-2",
          fieldUsesFullGrid(field) && "@xl/setting-grid:col-span-2"
        )}
        data-slot="production-setting-row"
        data-setting-key={field.key}
        key={field.key}
      >
        <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-2">
          <FieldLabel htmlFor={`production-setting-${field.key}`}>
            {field.label}
            {field.control === "slider"
              ? field.key === "tts_speed"
                ? ` · ${Number(values[field.key] ?? 1).toFixed(1)}x`
                : ` · ${Math.round(Number(values[field.key] ?? 0.2) * 100)}%`
              : ""}
          </FieldLabel>
          {renderStatus(field)}
        </div>
        <div className="@container/setting-control min-w-0">
          {renderControl(field)}
        </div>
        {field.hint ? (
          <FieldDescription className="text-xs leading-5">
            {field.hint}
          </FieldDescription>
        ) : null}
      </Field>
    )
  }

  function sectionChangeCount(section: ProductionSettingSection) {
    return section.fields.filter(
      (field) => dirty.has(field.key) || field.key in savedOverrides
    ).length
  }

  function renderSection(section: ProductionSettingSection) {
    const isOpen = effectiveOpenSectionId === section.id
    const changedCount = sectionChangeCount(section)
    const sectionDomId = `${quickPresentation ? "run" : "recipe"}-setting-section-${section.id}`
    const contentId = `${sectionDomId}-content`
    const canResetSection = changedCount > 0
    const Heading = quickPresentation ? "h3" : "h2"
    const inheritedLabel = mode === "run" ? "沿用模板" : "沿用出厂设置"
    const headingLabel = `${section.step != null ? `${section.step}. ` : ""}${section.title}`

    return (
      <section
        className={cn(
          "scroll-mt-28 overflow-hidden rounded-lg border bg-card text-card-foreground",
          isOpen && "border-primary/30 shadow-sm",
          changedCount > 0 && "border-warning/50"
        )}
        data-open={isOpen}
        data-slot="production-setting-section"
        id={sectionDomId}
        key={section.id}
      >
        <Heading className="contents">
          <button
            aria-label={headingLabel}
            aria-controls={contentId}
            aria-expanded={isOpen}
            className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            onClick={() => setOpenSectionId(section.id)}
            type="button"
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-8 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground",
                isOpen && "bg-primary/10 text-primary",
                changedCount > 0 && "bg-warning/10 text-warning"
              )}
            >
              {section.step ?? <SlidersHorizontal className="size-3.5" />}
            </span>
            <span className="min-w-0">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-semibold">{section.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {section.description}
                </span>
              </span>
              <span
                className={cn(
                  "mt-1 block text-xs text-muted-foreground",
                  changedCount > 0 && "font-medium text-warning"
                )}
              >
                {changedCount > 0
                  ? `${mode === "run" ? "已调整" : "已自定义"} ${changedCount} 项`
                  : inheritedLabel}
              </span>
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                isOpen && "rotate-180"
              )}
            />
          </button>
        </Heading>
        <div hidden={!isOpen} id={contentId}>
          <div className="border-t px-4 py-5 sm:px-5">
            {onResetMany && canResetSection ? (
              <div className="mb-4 flex justify-end">
                <Button
                  onClick={() =>
                    onResetMany(section.fields.map((field) => field.key))
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <RotateCcw />
                  恢复此阶段
                </Button>
              </div>
            ) : null}
            <div className="@container/setting-grid">
              <div className="grid grid-cols-1 gap-x-6 gap-y-5 @xl/setting-grid:grid-cols-2">
                {section.fields.map((field) => renderField(field))}
              </div>
            </div>
          </div>
        </div>
      </section>
    )
  }

  const hasFrame = keys.includes("frame_template") && actions?.renderFrame
  const hasTts =
    keys.some((key) =>
      ["tts_inference_mode", "tts_voice", "voice_id"].includes(key)
    ) && actions?.synthesizeTts
  const hasMedia =
    valueText(values.image_provider || "comfy_workflow") === "comfy_workflow" &&
    keys.includes("media_workflow") &&
    actions?.generateMedia
  const ttsUrl = fileUrlFromPath(ttsPreview?.audio_path)
  const frameUrl = fileUrlFromPath(framePreview?.frame_path)
  const mediaUrl = fileUrlFromPath(mediaPreview?.media_path)
  const quickPresentation = presentation === "quick" && mode === "run"
  const changedLabels = sections
    .flatMap((section) => section.fields)
    .filter((field) => dirty.has(field.key))
    .map((field) => field.label)
  const settingsSummary =
    summary ??
    (changedLabels.length > 0
      ? `本次覆盖 ${changedLabels.length} 项：${changedLabels.join("、")}`
      : "全部沿用模板默认")
  const hasDetailedSettings =
    sections.length > 0 || Boolean(hasFrame || hasTts || hasMedia)

  return (
    <div className="flex flex-col gap-5" data-slot="production-settings-editor">
      {resourcesError ? (
        <AsyncState
          description={`${resourcesError}。已读取到的值仍可编辑。`}
          state="stale"
          title="部分资源未同步"
        />
      ) : null}

      {quickPresentation ? (
        <section
          className="border-t pt-5"
          data-slot="quick-production-settings"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="size-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">本次设置</h2>
                <Badge
                  variant={changedLabels.length > 0 ? "warning" : "secondary"}
                >
                  {changedLabels.length > 0
                    ? `已调整 ${changedLabels.length} 项`
                    : "使用模板默认"}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                当前沿用「{template.display_name}」；展开后只调整这一条任务。
              </p>
              <p
                className="mt-1 text-xs leading-5 text-muted-foreground"
                data-slot="quick-settings-summary"
              >
                {settingsSummary}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {changedLabels.length > 0 ? (
                <Button
                  disabled={!onResetAll}
                  onClick={onResetAll}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <RotateCcw />
                  恢复模板默认
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline">
                <a href={routeHref(`/create/recipes/${template.id}`)}>
                  管理长期模板
                </a>
              </Button>
              {hasDetailedSettings ? (
                <Button
                  aria-expanded={detailsOpen}
                  onClick={() => {
                    if (!detailsOpen) setOpenSectionId(preferredSectionId)
                    setDetailsOpen((current) => !current)
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <ChevronDown
                    className={cn(
                      "transition-transform duration-150 motion-reduce:transition-none",
                      detailsOpen && "rotate-180"
                    )}
                  />
                  {detailsOpen ? "收起本次设置" : "展开本次设置"}
                </Button>
              ) : null}
            </div>
          </div>

          {detailsOpen && sections.length > 0 ? (
            <div aria-label="本次设置阶段" className="mt-4 flex flex-col gap-2">
              {sections.map((section) => renderSection(section))}
            </div>
          ) : !hasDetailedSettings ? (
            <p className="mt-4 rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
              当前生产方式没有可调整的本次设置。
            </p>
          ) : null}
        </section>
      ) : null}

      {!quickPresentation && sections.length > 0 ? (
        <div aria-label="模板生产阶段" className="flex flex-col gap-2">
          {sections.map((section) => renderSection(section))}
        </div>
      ) : null}

      {(!quickPresentation || detailsOpen) &&
      (hasFrame || hasTts || hasMedia) ? (
        <WorkspacePanel
          description="用同一组当前值检查画面、声音和媒体生成效果；预览不会保存配置。"
          title="效果预览"
          variant={quickPresentation ? "plain" : "surface"}
        >
          <div className="flex flex-wrap gap-2">
            {hasFrame ? (
              <Button
                disabled={busyAction != null}
                onClick={() => void previewFrame()}
                type="button"
                variant="outline"
              >
                {busyAction === "frame" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ImageIcon />
                )}
                预览画面
              </Button>
            ) : null}
            {hasTts ? (
              <Button
                disabled={busyAction != null}
                onClick={() => void previewTts()}
                type="button"
                variant="outline"
              >
                {busyAction === "tts" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Volume2 />
                )}
                试听声音
              </Button>
            ) : null}
            {hasMedia ? (
              <Button
                disabled={busyAction != null}
                onClick={() => void previewMedia()}
                type="button"
                variant="outline"
              >
                {busyAction === "media" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <UploadCloud />
                )}
                试生成图片
              </Button>
            ) : null}
          </div>
          {actionError ? (
            <InlineError message={actionError} title="预览失败" />
          ) : null}
          {frameUrl ? (
            <img
              alt="当前设置的画面预览"
              className="mt-4 max-h-96 rounded-lg border object-contain"
              src={frameUrl}
            />
          ) : null}
          {ttsUrl ? (
            <audio className="mt-4 w-full" controls src={ttsUrl} />
          ) : null}
          {mediaUrl ? (
            <img
              alt="当前设置生成的图片预览"
              className="mt-4 max-h-96 rounded-lg border object-contain"
              src={mediaUrl}
            />
          ) : null}
        </WorkspacePanel>
      ) : null}
    </div>
  )
}
