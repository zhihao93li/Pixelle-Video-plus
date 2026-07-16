import { useEffect, useMemo, useState } from "react"
import { ImageIcon, Loader2, Volume2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { AdvancedGroup } from "@/components/shared/AdvancedGroup"
import { Fact, InlineError, TechDetails } from "@/components/shared/feedback"
import { FrameTemplatePicker } from "@/components/shared/FrameTemplatePicker"
import { RecipeSelect } from "@/components/shared/RecipeSelect"
import { SourceChip } from "@/components/shared/SourceChip"
import { isNonVideoPipeline, templateArtifactType } from "@/lib/artifactKind"
import { useCurrentProject } from "@/lib/currentProject"
import { useExpertMode } from "@/lib/expertMode"
import { readableError } from "@/lib/format"
import { navigate } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { frameTemplateLabel } from "@/lib/templateLabels"
import {
  fileUrlFromPath,
  listResourceBgm,
  listResourceTemplates,
  listTemplates,
  renderFramePreview,
  synthesizeTtsPreview,
  type FramePreviewResponse,
  type ProductionTemplate,
  type ResourceBgm,
  type ResourceTemplate,
  type TtsPreviewResponse,
} from "@/lib/generationApi"

/**
 * 生产提交面板：全站唯一的生产配置入口（看板/内容详情/审核第三步共用）。
 * 产品原则：模板管默认，表单管这一次——本组件默认只做「选模板」，
 * 参数覆盖仅在专家模式下显式展开。
 */

export type ProductionOverrides = Record<string, string | number>

const OVERRIDE_LABELS: Array<{
  key: string
  label: string
}> = [
  { key: "frame_template", label: "画面模板" },
  { key: "tts_voice", label: "声音" },
  { key: "tts_speed", label: "语速" },
  { key: "bgm_path", label: "背景音乐" },
  { key: "bgm_volume", label: "BGM 音量" },
]

function summaryChips(template: ProductionTemplate) {
  const params = template.fixed_params
  const chips: string[] = []
  const frame = String(params.frame_template ?? "")
  if (frame) {
    chips.push(`画面 ${frameTemplateLabel(frame)}`)
  }
  const voice = String(params.tts_voice ?? "")
  const ttsMode = String(params.tts_inference_mode ?? "")
  if (voice) {
    chips.push(`声音 ${voice.replace("zh-CN-", "").replace("Neural", "")}`)
  } else if (ttsMode) {
    chips.push(`TTS ${ttsMode}`)
  }
  if (params.bgm_volume != null) {
    chips.push(`BGM ${Math.round(Number(params.bgm_volume) * 100)}%`)
  }
  const splitMode = String(params.split_mode ?? "")
  if (splitMode) {
    const labels: Record<string, string> = {
      paragraph: "按段落拆分",
      line: "按行拆分",
      sentence: "按句子拆分",
    }
    chips.push(labels[splitMode] ?? splitMode)
  }
  return chips
}

export function ProductionSubmitPanel({
  requiredInput,
  templateId,
  onTemplateChange,
  overrides,
  onOverridesChange,
  lockedSummary,
  projectId,
  templateSelectionDisabled = false,
}: {
  /** 该流程的内容输入类型，用于过滤兼容模板 */
  requiredInput: "script" | "topic"
  templateId: string
  onTemplateChange: (templateId: string) => void
  overrides: ProductionOverrides
  onOverridesChange: (overrides: ProductionOverrides) => void
  /** 流程强制项说明（如审核流固定按行拆分、每语言 Fish TTS） */
  lockedSummary?: string
  /** 当前项目：默认模板 = 项目默认 > 全局 */
  projectId?: string
  /** 审核稿已由模板起草后，提交步骤必须锁定同一模板。 */
  templateSelectionDisabled?: boolean
}) {
  const expertMode = useExpertMode()
  const { project } = useCurrentProject()
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(
    null
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [frameTemplates, setFrameTemplates] = useState<ResourceTemplate[]>([])
  const [bgmOptions, setBgmOptions] = useState<ResourceBgm[]>([])
  const [previewText, setPreviewText] = useState(
    "这是一段用于预览画面与声音的示例文案。"
  )
  const [framePreview, setFramePreview] = useState<FramePreviewResponse | null>(
    null
  )
  const [framePreviewError, setFramePreviewError] = useState<string | null>(
    null
  )
  const [isPreviewingFrame, setIsPreviewingFrame] = useState(false)
  const [ttsPreview, setTtsPreview] = useState<TtsPreviewResponse | null>(null)
  const [ttsPreviewError, setTtsPreviewError] = useState<string | null>(null)
  const [isPreviewingTts, setIsPreviewingTts] = useState(false)

  const compatible = useMemo(
    () =>
      templates.filter(
        (template) =>
          template.enabled &&
          template.input_requirements.includes(requiredInput)
      ),
    [templates, requiredInput]
  )
  const selected =
    compatible.find((template) => template.id === templateId) ?? null
  // 非视频模板（图文/长文）：预览画面/试听声音、画面/BGM/TTS 覆盖项全部无意义，隐藏
  const selectedIsNonVideo = isNonVideoPipeline(selected?.pipeline_id)

  // 来源判定：选中 === 项目默认模板 → 项目默认；=== 内置默认 → 内置默认；否则用户显式选择，无 chip。
  const projectDefaultTemplate =
    project?.project_id === projectId
      ? (project?.default_production_template_id ?? null)
      : null
  const templateSource: { source: "project" | "builtin"; to?: string } | null =
    projectDefaultTemplate && templateId === projectDefaultTemplate
      ? { source: "project", to: settingsLink({ kind: "projects" }) }
      : !projectDefaultTemplate &&
          templateId &&
          templateId === defaultTemplateId
        ? { source: "builtin" }
        : null

  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      setLoadError(null)
      try {
        const response = await listTemplates(projectId)
        if (cancelled) {
          return
        }
        setTemplates(response.templates)
        setDefaultTemplateId(response.default_template)
        const usable = response.templates.filter(
          (template) =>
            template.enabled &&
            template.input_requirements.includes(requiredInput)
        )
        if (usable.some((template) => template.id === templateId)) {
          return
        }
        const defaultTemplate = usable.find(
          (template) => template.id === response.default_template
        )
        if (!templateId && defaultTemplate) {
          onTemplateChange(defaultTemplate.id)
          return
        }
        setLoadError(
          templateId
            ? "当前生产模板不存在或不支持这个输入类型，请重新选择。"
            : "当前项目没有可用于这个输入类型的默认生产模板。"
        )
      } catch (error) {
        if (!cancelled) {
          setLoadError(readableError(error))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requiredInput, projectId])

  useEffect(() => {
    if (!expertMode) {
      return
    }
    let cancelled = false
    void Promise.allSettled([listResourceTemplates(), listResourceBgm()]).then(
      ([templatesResult, bgmResult]) => {
        if (cancelled) {
          return
        }
        if (templatesResult.status === "fulfilled") {
          setFrameTemplates(templatesResult.value.templates)
        }
        if (bgmResult.status === "fulfilled") {
          setBgmOptions(bgmResult.value.bgm_files)
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [expertMode])

  // 模板或覆盖变化时重置预览（渲染期调整，避免 effect 内 setState）
  const previewKey = `${templateId}:${JSON.stringify(overrides)}`
  const [lastPreviewKey, setLastPreviewKey] = useState(previewKey)
  if (previewKey !== lastPreviewKey) {
    setLastPreviewKey(previewKey)
    setFramePreview(null)
    setFramePreviewError(null)
    setTtsPreview(null)
    setTtsPreviewError(null)
  }

  const effectiveParams = useMemo(
    () => ({ ...(selected?.fixed_params ?? {}), ...overrides }),
    [selected, overrides]
  )

  async function previewFrame() {
    setIsPreviewingFrame(true)
    setFramePreview(null)
    setFramePreviewError(null)
    try {
      const response = await renderFramePreview({
        template: String(
          effectiveParams.frame_template ?? "1080x1920/image_default.html"
        ),
        text: previewText.trim() || "预览示例文案",
        templateParams:
          (effectiveParams.template_params as Record<string, unknown>) ??
          undefined,
      })
      setFramePreview(response)
    } catch (error) {
      setFramePreviewError(readableError(error))
    } finally {
      setIsPreviewingFrame(false)
    }
  }

  async function previewTts() {
    setIsPreviewingTts(true)
    setTtsPreview(null)
    setTtsPreviewError(null)
    try {
      const mode = String(effectiveParams.tts_inference_mode ?? "") as
        "local" | "comfyui" | "fish" | ""
      const voice = String(effectiveParams.tts_voice ?? "").trim()
      const response = await synthesizeTtsPreview({
        text: previewText.trim() || "预览示例文案",
        inferenceMode: mode || undefined,
        workflow: String(effectiveParams.tts_workflow ?? "") || undefined,
        voiceId: mode === "fish" ? undefined : voice || undefined,
        referenceId: mode === "fish" ? voice || undefined : undefined,
        speed: Number(effectiveParams.tts_speed ?? 1),
      })
      setTtsPreview(response)
    } catch (error) {
      setTtsPreviewError(readableError(error))
    } finally {
      setIsPreviewingTts(false)
    }
  }

  function patchOverride(key: string, value: string | number | null) {
    const next = { ...overrides }
    if (value === null || value === "") {
      delete next[key]
    } else {
      next[key] = value
    }
    onOverridesChange(next)
  }

  const overrideCount = Object.keys(overrides).length

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-background p-4">
      <div>
        <div className="text-sm font-medium">生产提交</div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          选择生产模板；画面、声音、音乐等继承模板默认。
        </p>
      </div>

      {loadError && <InlineError title="生产模板不可用" message={loadError} />}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取生产模板
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              生产模板
              {templateSource && (
                <SourceChip
                  source={templateSource.source}
                  to={templateSource.to}
                />
              )}
            </span>
            <RecipeSelect
              disabled={templateSelectionDisabled}
              onChange={(template) => {
                setLoadError(null)
                onTemplateChange(template.id)
              }}
              placeholder="选择生产模板"
              templates={compatible}
              value={templateId}
            />
          </label>

          {selected && (
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  模板默认（只读）
                </span>
                <button
                  className="text-xs text-primary transition-colors hover:underline"
                  onClick={() => navigate(`/create/recipes/${templateId}`)}
                  type="button"
                >
                  调整默认模板
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {summaryChips(selected).map((chip) => (
                  <Badge key={chip} variant="secondary">
                    {chip}
                  </Badge>
                ))}
                <Badge variant="outline">
                  预计 {selected.estimated_turnaround}
                </Badge>
              </div>
              {lockedSummary && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {lockedSummary}
                </p>
              )}
            </div>
          )}

          {selected && !selectedIsNonVideo && (
            <AdvancedGroup
              description="用示例文案看画面与声音的默认效果"
              id="production-preview"
              title="默认效果预览"
            >
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">预览文案</span>
                <Input
                  onChange={(event) => setPreviewText(event.target.value)}
                  value={previewText}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={isPreviewingFrame}
                  onClick={() => void previewFrame()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isPreviewingFrame ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <ImageIcon data-icon="inline-start" />
                  )}
                  预览画面
                </Button>
                <Button
                  disabled={isPreviewingTts}
                  onClick={() => void previewTts()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isPreviewingTts ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <Volume2 data-icon="inline-start" />
                  )}
                  试听声音
                </Button>
              </div>

              {framePreviewError && (
                <InlineError title="画面预览失败" message={framePreviewError} />
              )}
              {framePreview && (
                <div className="flex flex-col gap-3">
                  {fileUrlFromPath(framePreview.frame_path) ? (
                    <img
                      alt="画面模板预览"
                      className="aspect-[9/16] max-h-[360px] rounded-lg border bg-background object-contain"
                      src={
                        fileUrlFromPath(framePreview.frame_path) ?? undefined
                      }
                    />
                  ) : (
                    <InlineError
                      title="画面不可预览"
                      message="帧图已渲染，但当前无法在浏览器中显示。"
                    />
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact
                      label="渲染尺寸"
                      value={`${framePreview.width} x ${framePreview.height}`}
                    />
                  </div>
                  <TechDetails
                    items={[
                      { label: "帧图路径", value: framePreview.frame_path },
                    ]}
                  />
                </div>
              )}

              {ttsPreviewError && (
                <InlineError title="试听失败" message={ttsPreviewError} />
              )}
              {ttsPreview && (
                <div className="flex flex-col gap-3">
                  {fileUrlFromPath(ttsPreview.audio_path) ? (
                    <audio
                      className="w-full"
                      controls
                      src={fileUrlFromPath(ttsPreview.audio_path) ?? undefined}
                    />
                  ) : (
                    <InlineError
                      title="音频不可播放"
                      message="音频已合成，但当前无法在浏览器中播放。"
                    />
                  )}
                  <TechDetails
                    items={[
                      { label: "音频路径", value: ttsPreview.audio_path },
                    ]}
                  />
                </div>
              )}
            </AdvancedGroup>
          )}

          {expertMode && !selectedIsNonVideo && (
            <AdvancedGroup
              description={
                overrideCount > 0 ? `已覆盖 ${overrideCount} 项` : "默认不覆盖"
              }
              id="production-overrides"
              title="本次覆盖（专家）"
            >
              <p className="text-xs leading-5 text-muted-foreground">
                仅影响本次提交；留空表示沿用模板默认。要长期生效请改模板默认配置。
              </p>
              <div className="grid gap-4 lg:grid-cols-2">
                {/* 首卡使用模板默认；选中后用空串撤销本次覆盖。 */}
                <div className="flex flex-col gap-1.5 text-sm lg:col-span-2">
                  <span className="text-xs text-muted-foreground">
                    {OVERRIDE_LABELS[0].label}
                  </span>
                  <FrameTemplatePicker
                    allowDefault
                    defaultLabel="使用模板默认"
                    onChange={(key) =>
                      patchOverride("frame_template", key === "" ? null : key)
                    }
                    templates={frameTemplates}
                    value={String(overrides.frame_template || "")}
                  />
                </div>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {OVERRIDE_LABELS[3].label}
                  </span>
                  <Select
                    onValueChange={(value) =>
                      patchOverride(
                        "bgm_path",
                        value === "__default__" ? null : value
                      )
                    }
                    value={String(overrides.bgm_path ?? "__default__")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">使用模板默认</SelectItem>
                      {bgmOptions.map((item) => (
                        <SelectItem key={item.path} value={item.path}>
                          {item.name} · {item.source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">
                    TTS 模式
                  </span>
                  <Select
                    onValueChange={(value) =>
                      patchOverride(
                        "tts_inference_mode",
                        value === "__default__" ? null : value
                      )
                    }
                    value={String(
                      overrides.tts_inference_mode ?? "__default__"
                    )}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">使用模板默认</SelectItem>
                      <SelectItem value="local">
                        Microsoft Edge 在线语音
                      </SelectItem>
                      <SelectItem value="comfyui">ComfyUI workflow</SelectItem>
                      <SelectItem value="fish">Fish Audio</SelectItem>
                    </SelectContent>
                  </Select>
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">
                    声音（留空用默认）
                  </span>
                  <Input
                    onChange={(event) =>
                      patchOverride(
                        "tts_voice",
                        event.target.value.trim() || null
                      )
                    }
                    placeholder="voice 或 reference_id"
                    value={String(overrides.tts_voice ?? "")}
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">
                    语速
                    {overrides.tts_speed != null
                      ? ` · ${Number(overrides.tts_speed).toFixed(1)}x`
                      : " · 模板默认"}
                  </span>
                  <Slider
                    aria-label="语速"
                    max={2}
                    min={0.5}
                    onValueChange={([value]) =>
                      patchOverride("tts_speed", value ?? null)
                    }
                    step={0.1}
                    value={[Number(overrides.tts_speed ?? 1)]}
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">
                    BGM 音量
                    {overrides.bgm_volume != null
                      ? ` · ${Math.round(Number(overrides.bgm_volume) * 100)}%`
                      : " · 模板默认"}
                  </span>
                  <Slider
                    aria-label="BGM 音量"
                    max={1}
                    min={0}
                    onValueChange={([value]) =>
                      patchOverride("bgm_volume", value ?? null)
                    }
                    step={0.05}
                    value={[Number(overrides.bgm_volume ?? 0.2)]}
                  />
                </label>
              </div>
            </AdvancedGroup>
          )}

          {/* 长文专属的字数与模型本次覆盖。 */}
          {expertMode &&
            selected &&
            templateArtifactType(selected.pipeline_id) === "text" &&
            (selected.allowed_user_params.includes("word_count") ||
              selected.allowed_user_params.includes("llm_model")) && (
              <AdvancedGroup
                description={
                  overrideCount > 0
                    ? `已覆盖 ${overrideCount} 项`
                    : "默认不覆盖"
                }
                id="production-overrides"
                title="本次覆盖（专家）"
              >
                <p className="text-xs leading-5 text-muted-foreground">
                  仅影响本次提交；留空表示沿用模板默认。要长期生效请改模板默认。
                </p>
                <div className="grid gap-4 lg:grid-cols-2">
                  {selected.allowed_user_params.includes("word_count") && (
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="text-xs text-muted-foreground">
                        目标字数（留空用默认）
                      </span>
                      <Input
                        inputMode="numeric"
                        onChange={(event) => {
                          const raw = event.target.value.trim()
                          const parsed = Number(raw)
                          patchOverride(
                            "word_count",
                            raw && Number.isFinite(parsed)
                              ? Math.round(parsed)
                              : null
                          )
                        }}
                        placeholder="200 – 20000"
                        value={
                          overrides.word_count != null
                            ? String(overrides.word_count)
                            : ""
                        }
                      />
                    </label>
                  )}
                  {selected.allowed_user_params.includes("llm_model") && (
                    <label className="flex flex-col gap-1.5 text-sm">
                      <span className="text-xs text-muted-foreground">
                        写作模型（留空用默认）
                      </span>
                      <Input
                        onChange={(event) =>
                          patchOverride(
                            "llm_model",
                            event.target.value.trim() || null
                          )
                        }
                        placeholder="留空用系统默认模型"
                        value={String(overrides.llm_model ?? "")}
                      />
                    </label>
                  )}
                </div>
              </AdvancedGroup>
            )}
        </>
      )}
    </div>
  )
}
