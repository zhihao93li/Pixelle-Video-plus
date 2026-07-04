import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ImageIcon,
  Loader2,
  Play,
  RefreshCcw,
  Video,
  Volume2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  ApiError,
  createGenerationBatch,
  fileUrlFromPath,
  generateMediaPreview,
  getFrameTemplateParams,
  getGenerationBatch,
  listResourceBgm,
  listResourceMediaWorkflows,
  listResourceTemplates,
  listResourceTtsWorkflows,
  listGenerationBatches,
  renderFramePreview,
  retryGenerationBatchItem,
  resourceFileUrl,
  synthesizeTtsPreview,
  uploadGenerationAssets,
  uploadResourceBgm,
  type FramePreviewResponse,
  type GenerationBatch,
  type GenerationBatchItem,
  type MediaPreviewResponse,
  type ResourceBgm,
  type ResourceTemplate,
  type ResourceWorkflow,
  type TemplateParamConfig,
  type TemplateParamsResponse,
  type TtsPreviewResponse,
} from "@/lib/generationApi"
import { cn } from "@/lib/utils"

type BatchMode = "generate" | "fixed"
type SplitMode = "paragraph" | "line" | "sentence"
type TtsMode = "local" | "comfyui" | "fish"

type BatchResources = {
  bgm: ResourceBgm[]
  frameTemplates: ResourceTemplate[]
  mediaWorkflows: ResourceWorkflow[]
  ttsWorkflows: ResourceWorkflow[]
}

type BatchSharedSettings = {
  nScenes: number
  splitMode: SplitMode
  frameTemplate: string
  templateParams: Record<string, string | number | boolean>
  mediaWorkflow: string
  mediaWidth: number
  mediaHeight: number
  mediaDuration: number
  promptPrefix: string
  imagePromptVisualContext: string
  imagePromptGenerationRules: string
  bgmPath: string
  bgmVolume: number
  bgmMode: "loop" | "once"
  ttsInferenceMode: TtsMode
  ttsVoice: string
  ttsWorkflow: string
  ttsSpeed: number
  ttsRefAudioPath: string
  ttsRefAudioName: string
}

const TOPIC_BATCH_TEMPLATE_ID = "petwoods_xhs_topic_to_video_v1"
const SCRIPT_BATCH_TEMPLATE_ID = "petwoods_xhs_daily_v1"
const defaultBatchResources: BatchResources = {
  bgm: [],
  frameTemplates: [],
  mediaWorkflows: [],
  ttsWorkflows: [],
}

const defaultBatchSharedSettings: BatchSharedSettings = {
  nScenes: 5,
  splitMode: "paragraph",
  frameTemplate: "1080x1920/image_default.html",
  templateParams: {},
  mediaWorkflow: "",
  mediaWidth: 1080,
  mediaHeight: 1440,
  mediaDuration: 4,
  promptPrefix: "",
  imagePromptVisualContext: "",
  imagePromptGenerationRules: "",
  bgmPath: "",
  bgmVolume: 0.2,
  bgmMode: "loop",
  ttsInferenceMode: "local",
  ttsVoice: "zh-CN-YunjianNeural",
  ttsWorkflow: "",
  ttsSpeed: 1,
  ttsRefAudioPath: "",
  ttsRefAudioName: "",
}

export function BatchWorkspace() {
  const [mode, setMode] = useState<BatchMode>("generate")
  const [topicText, setTopicText] = useState("")
  const [scriptText, setScriptText] = useState("")
  const [titlePrefix, setTitlePrefix] = useState("")
  const [sharedSettings, setSharedSettings] = useState<BatchSharedSettings>(
    defaultBatchSharedSettings
  )
  const [resources, setResources] =
    useState<BatchResources>(defaultBatchResources)
  const [resourcesError, setResourcesError] = useState<string | null>(null)
  const [isLoadingResources, setIsLoadingResources] = useState(true)
  const [batch, setBatch] = useState<GenerationBatch | null>(null)
  const [recentBatches, setRecentBatches] = useState<GenerationBatch[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLoadingBatches, setIsLoadingBatches] = useState(true)
  const [retryingItemIndex, setRetryingItemIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const items = useMemo(
    () =>
      mode === "generate"
        ? parseTopicItems(topicText, titlePrefix, sharedSettings)
        : parseFixedScriptItems(scriptText, sharedSettings),
    [mode, scriptText, sharedSettings, titlePrefix, topicText]
  )
  const canSubmit = items.length > 0 && !isSubmitting

  const patchSharedSettings = useCallback((patch: Partial<BatchSharedSettings>) => {
    setSharedSettings((current) => ({ ...current, ...patch }))
  }, [])

  const addBgmResource = useCallback((bgm: ResourceBgm) => {
    setResources((current) => ({
      ...current,
      bgm: [
        bgm,
        ...current.bgm.filter((item) => item.path !== bgm.path),
      ],
    }))
  }, [])

  async function refreshBatches() {
    setIsLoadingBatches(true)
    setError(null)
    try {
      const response = await listGenerationBatches()
      setRecentBatches(response.batches)
      if (!batch && response.batches.length > 0) {
        setBatch(response.batches[0])
      }
    } catch (loadError) {
      setError(readableError(loadError))
    } finally {
      setIsLoadingBatches(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadResources() {
      setIsLoadingResources(true)
      setResourcesError(null)
      const [bgmResult, templateResult, mediaWorkflowResult, ttsWorkflowResult] =
        await Promise.allSettled([
          listResourceBgm(),
          listResourceTemplates(),
          listResourceMediaWorkflows(),
          listResourceTtsWorkflows(),
        ])

      if (cancelled) {
        return
      }

      setResources({
        bgm: bgmResult.status === "fulfilled" ? bgmResult.value.bgm_files : [],
        frameTemplates:
          templateResult.status === "fulfilled"
            ? templateResult.value.templates
            : [],
        mediaWorkflows:
          mediaWorkflowResult.status === "fulfilled"
            ? mediaWorkflowResult.value.workflows
            : [],
        ttsWorkflows:
          ttsWorkflowResult.status === "fulfilled"
            ? ttsWorkflowResult.value.workflows
            : [],
      })

      const resourceLoadResults: PromiseSettledResult<unknown>[] = [
        bgmResult,
        templateResult,
        mediaWorkflowResult,
        ttsWorkflowResult,
      ]
      const firstFailure = resourceLoadResults.find(isRejected)
      setResourcesError(firstFailure ? readableError(firstFailure.reason) : null)
      setIsLoadingResources(false)
    }

    void loadResources()

    listGenerationBatches()
      .then((response) => {
        if (cancelled) {
          return
        }
        setRecentBatches(response.batches)
        setBatch((current) => current ?? response.batches[0] ?? null)
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(readableError(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingBatches(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!batch || isTerminalBatchStatus(batch.status)) {
      return
    }
    const timer = window.setInterval(() => {
      void getGenerationBatch(batch.batch_id)
        .then(setBatch)
        .catch((pollError) => setError(readableError(pollError)))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [batch])

  async function submitBatch() {
    if (!canSubmit) {
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const response = await createGenerationBatch({
        templateId:
          mode === "generate" ? TOPIC_BATCH_TEMPLATE_ID : SCRIPT_BATCH_TEMPLATE_ID,
        items,
        metadata: {
        source: "react_batch_workspace",
        mode,
        shared_settings: buildBatchSharedInput(sharedSettings, mode),
      },
    })
      setBatch(response)
      setRecentBatches((current) => [
        response,
        ...current.filter((item) => item.batch_id !== response.batch_id),
      ])
    } catch (submitError) {
      setError(readableError(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function retryBatchItem(itemIndex: number) {
    if (!batch || retryingItemIndex !== null) {
      return
    }

    setRetryingItemIndex(itemIndex)
    setError(null)
    try {
      const response = await retryGenerationBatchItem(batch.batch_id, itemIndex)
      setBatch(response)
      setRecentBatches((current) => [
        response,
        ...current.filter((item) => item.batch_id !== response.batch_id),
      ])
    } catch (retryError) {
      setError(readableError(retryError))
    } finally {
      setRetryingItemIndex(null)
    }
  }

  return (
    <main className="mx-auto grid max-w-[1240px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_420px] lg:p-6">
      <section className="flex min-w-0 flex-col gap-5">
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <CardTitle>批量生产</CardTitle>
            <CardDescription>
              批量输入只决定每条视频的内容；底层模板和 provider 仍由生产模板固定。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => setMode("generate")}
                  type="button"
                  variant={mode === "generate" ? "default" : "outline"}
                >
                  批量选题
                </Button>
                <Button
                  onClick={() => setMode("fixed")}
                  type="button"
                  variant={mode === "fixed" ? "default" : "outline"}
                >
                  批量文案
                </Button>
              </div>

              {mode === "generate" ? (
                <>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">标题前缀</span>
                    <Input
                      onChange={(event) => setTitlePrefix(event.target.value)}
                      placeholder="PetWoods 日常"
                      value={titlePrefix}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">选题列表</span>
                    <Textarea
                      className="min-h-72 resize-y"
                      onChange={(event) => setTopicText(event.target.value)}
                      placeholder={"一行一个选题\n猫咪喝水太少怎么办\n幼猫第一次到家怎么适应"}
                      value={topicText}
                    />
                  </label>
                </>
              ) : (
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">文案列表</span>
                  <Textarea
                    className="min-h-96 resize-y"
                    onChange={(event) => setScriptText(event.target.value)}
                    placeholder={
                      "第一条标题\n第一条完整文案...\n\n---\n\n第二条标题\n第二条完整文案..."
                    }
                    value={scriptText}
                  />
                </label>
              )}

              <BatchSharedSettingsPanel
                isLoadingResources={isLoadingResources}
                mode={mode}
                onBgmUploaded={addBgmResource}
                onSettingsChange={patchSharedSettings}
                resources={resources}
                resourcesError={resourcesError}
                settings={sharedSettings}
              />

              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                已识别 {items.length} 条。提交后会创建真实 generation tasks，刷新页面后可通过 batch_id 继续查看。
              </div>

              {error && <InlineError title="批量操作失败" message={error} />}

              <div className="flex justify-end">
                <Button disabled={!canSubmit} onClick={() => void submitBatch()}>
                  {isSubmitting ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Play data-icon="inline-start" />
                  )}
                  创建批量任务
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <aside className="flex min-w-0 flex-col gap-5">
        <BatchStatusCard
          batch={batch}
          onRetryItem={retryBatchItem}
          retryingItemIndex={retryingItemIndex}
        />
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>最近批次</CardTitle>
                <CardDescription>从后端持久化 batch 文件读取。</CardDescription>
              </div>
              <Button
                disabled={isLoadingBatches}
                onClick={() => void refreshBatches()}
                size="icon-sm"
                variant="outline"
              >
                <RefreshCcw
                  className={cn(isLoadingBatches && "animate-spin")}
                />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentBatches.length === 0 ? (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                还没有批量任务。
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {recentBatches.slice(0, 8).map((recentBatch) => (
                  <button
                    className={cn(
                      "rounded-lg border bg-background p-3 text-left text-sm hover:bg-muted/40",
                      batch?.batch_id === recentBatch.batch_id &&
                        "border-primary bg-primary/5"
                    )}
                    key={recentBatch.batch_id}
                    onClick={() => setBatch(recentBatch)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-xs">
                        {recentBatch.batch_id}
                      </span>
                      <BatchStatusBadge status={recentBatch.status} />
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {recentBatch.total_count} 条，失败 {recentBatch.failed_count} 条
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </aside>
    </main>
  )
}

function BatchSharedSettingsPanel({
  isLoadingResources,
  mode,
  onBgmUploaded,
  onSettingsChange,
  resources,
  resourcesError,
  settings,
}: {
  isLoadingResources: boolean
  mode: BatchMode
  onBgmUploaded: (bgm: ResourceBgm) => void
  onSettingsChange: (patch: Partial<BatchSharedSettings>) => void
  resources: BatchResources
  resourcesError: string | null
  settings: BatchSharedSettings
}) {
  const [isUploadingBgm, setIsUploadingBgm] = useState(false)
  const [bgmUploadError, setBgmUploadError] = useState<string | null>(null)
  const [isUploadingRefAudio, setIsUploadingRefAudio] = useState(false)
  const [refAudioUploadError, setRefAudioUploadError] = useState<string | null>(null)
  const [templateParams, setTemplateParams] =
    useState<TemplateParamsResponse | null>(null)
  const [isLoadingTemplateParams, setIsLoadingTemplateParams] = useState(false)
  const [templateParamsError, setTemplateParamsError] = useState<string | null>(null)
  const [ttsPreviewText, setTtsPreviewText] =
    useState("大家好，这是一段测试语音。")
  const [ttsPreview, setTtsPreview] = useState<TtsPreviewResponse | null>(null)
  const [ttsPreviewError, setTtsPreviewError] = useState<string | null>(null)
  const [isPreviewingTts, setIsPreviewingTts] = useState(false)
  const [framePreviewTitle, setFramePreviewTitle] = useState("PetWoods 日常")
  const [framePreviewText, setFramePreviewText] =
    useState("今天分享一个让猫咪多喝水的小方法。")
  const [framePreviewImage, setFramePreviewImage] =
    useState("resources/example.png")
  const [framePreview, setFramePreview] =
    useState<FramePreviewResponse | null>(null)
  const [framePreviewError, setFramePreviewError] = useState<string | null>(null)
  const [isPreviewingFrame, setIsPreviewingFrame] = useState(false)
  const [mediaPreviewPrompt, setMediaPreviewPrompt] = useState("")
  const [mediaPreview, setMediaPreview] =
    useState<MediaPreviewResponse | null>(null)
  const [mediaPreviewError, setMediaPreviewError] = useState<string | null>(null)
  const [isPreviewingMedia, setIsPreviewingMedia] = useState(false)

  const bgmPreviewUrl = resourceFileUrl(settings.bgmPath)
  const ttsPreviewUrl = fileUrlFromPath(ttsPreview?.audio_path)
  const framePreviewUrl = fileUrlFromPath(framePreview?.frame_path)
  const mediaPreviewUrl = fileUrlFromPath(mediaPreview?.media_path)
  const mediaType = frameTemplateMediaType(settings.frameTemplate)
  const templateParamEntries = Object.entries(
    templateParams?.params ?? {}
  ) as Array<[string, TemplateParamConfig]>

  useEffect(() => {
    let cancelled = false

    async function loadTemplateParams() {
      setIsLoadingTemplateParams(true)
      setTemplateParamsError(null)
      try {
        const response = await getFrameTemplateParams(settings.frameTemplate)
        if (cancelled) {
          return
        }
        setTemplateParams(response)
        onSettingsChange({
          mediaWidth: response.media_width,
          mediaHeight: response.media_height,
          templateParams: buildTemplateParamDefaults(response.params),
        })
      } catch (error) {
        if (!cancelled) {
          setTemplateParams(null)
          setTemplateParamsError(readableError(error))
        }
      } finally {
        if (!cancelled) {
          setIsLoadingTemplateParams(false)
        }
      }
    }

    void loadTemplateParams()

    return () => {
      cancelled = true
    }
  }, [onSettingsChange, settings.frameTemplate])

  async function uploadBgm(file: File | null) {
    setBgmUploadError(null)
    if (!file) {
      return
    }
    setIsUploadingBgm(true)
    try {
      const response = await uploadResourceBgm(file)
      onBgmUploaded(response.bgm_file)
      onSettingsChange({ bgmPath: response.bgm_file.path })
    } catch (error) {
      setBgmUploadError(readableError(error))
    } finally {
      setIsUploadingBgm(false)
    }
  }

  async function uploadRefAudio(file: File | null) {
    setRefAudioUploadError(null)
    if (!file) {
      return
    }
    setIsUploadingRefAudio(true)
    try {
      const response = await uploadGenerationAssets([file])
      const asset = response.assets[0]
      if (!asset) {
        throw new Error("后端没有返回上传后的参考音频。")
      }
      onSettingsChange({
        ttsRefAudioPath: asset.path,
        ttsRefAudioName: asset.original_filename,
      })
    } catch (error) {
      setRefAudioUploadError(readableError(error))
    } finally {
      setIsUploadingRefAudio(false)
    }
  }

  async function previewTts() {
    if (!ttsPreviewText.trim()) {
      setTtsPreviewError("请输入要预览的文本。")
      return
    }
    setIsPreviewingTts(true)
    setTtsPreview(null)
    setTtsPreviewError(null)
    try {
      const response = await synthesizeTtsPreview({
        text: ttsPreviewText.trim(),
        inferenceMode: settings.ttsInferenceMode,
        workflow: settings.ttsWorkflow,
        voiceId:
          settings.ttsInferenceMode === "fish"
            ? undefined
            : settings.ttsVoice.trim(),
        referenceId:
          settings.ttsInferenceMode === "fish"
            ? settings.ttsVoice.trim()
            : undefined,
        speed: settings.ttsSpeed,
        refAudio:
          settings.ttsInferenceMode === "comfyui"
            ? settings.ttsRefAudioPath
            : undefined,
      })
      setTtsPreview(response)
    } catch (error) {
      setTtsPreviewError(readableError(error))
    } finally {
      setIsPreviewingTts(false)
    }
  }

  async function previewFrame() {
    if (!framePreviewText.trim()) {
      setFramePreviewError("请输入画面预览文案。")
      return
    }
    setIsPreviewingFrame(true)
    setFramePreview(null)
    setFramePreviewError(null)
    try {
      const response = await renderFramePreview({
        template: settings.frameTemplate,
        title: framePreviewTitle,
        text: framePreviewText,
        image: framePreviewImage,
        templateParams: settings.templateParams,
      })
      setFramePreview(response)
    } catch (error) {
      setFramePreviewError(readableError(error))
    } finally {
      setIsPreviewingFrame(false)
    }
  }

  async function previewMedia() {
    const prompt = mediaPreviewPrompt.trim()
    if (mediaType === "static") {
      setMediaPreviewError("当前模板是静态模板，不需要生成媒体素材。")
      return
    }
    if (!prompt) {
      setMediaPreviewError("请输入媒体预览提示词。")
      return
    }
    setIsPreviewingMedia(true)
    setMediaPreview(null)
    setMediaPreviewError(null)
    try {
      const response = await generateMediaPreview({
        prompt: buildMediaPrompt(prompt, settings.promptPrefix),
        workflow: settings.mediaWorkflow,
        mediaType: mediaType === "video" ? "video" : "image",
        width: settings.mediaWidth,
        height: settings.mediaHeight,
        duration: settings.mediaDuration,
      })
      setMediaPreview(response)
    } catch (error) {
      setMediaPreviewError(readableError(error))
    } finally {
      setIsPreviewingMedia(false)
    }
  }

  function updateTemplateParam(
    name: string,
    config: TemplateParamConfig,
    rawValue: string | boolean
  ) {
    let value: string | number | boolean = rawValue
    if (config.type === "number") {
      value = Number(rawValue || 0)
    } else if (config.type === "bool") {
      value = Boolean(rawValue)
    }
    onSettingsChange({
      templateParams: {
        ...settings.templateParams,
        [name]: value,
      },
    })
  }

  return (
    <details className="rounded-lg border bg-background">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        批量共享生成设置
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          每条视频共用这组模板、BGM、TTS 和媒体 workflow
        </span>
      </summary>
      <div className="border-t p-4">
        <div className="flex flex-col gap-4">
          {resourcesError && (
            <InlineError title="资源读取失败" message={resourcesError} />
          )}
          {isLoadingResources && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" data-icon="inline-start" />
              正在读取模板、BGM 和 workflow 资源
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {mode === "generate" ? (
              <Field>
                <FieldLabel htmlFor="batch-scenes">每条分镜数量</FieldLabel>
                <input
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  id="batch-scenes"
                  max={30}
                  min={3}
                  onChange={(event) =>
                    onSettingsChange({
                      nScenes: Number(event.target.value || 5),
                    })
                  }
                  type="number"
                  value={settings.nScenes}
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="batch-split-mode">文案拆分方式</FieldLabel>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  id="batch-split-mode"
                  onChange={(event) =>
                    onSettingsChange({
                      splitMode: event.target.value as SplitMode,
                    })
                  }
                  value={settings.splitMode}
                >
                  <option value="paragraph">按段落</option>
                  <option value="line">按行</option>
                  <option value="sentence">按句子</option>
                </select>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="batch-frame-template">画面模板</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-frame-template"
                onChange={(event) =>
                  onSettingsChange({ frameTemplate: event.target.value })
                }
                value={settings.frameTemplate}
              >
                <option value="1080x1920/image_default.html">
                  1080x1920/image_default.html
                </option>
                {resources.frameTemplates.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.key}
                  </option>
                ))}
              </select>
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-media-workflow">画面 workflow</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-media-workflow"
                onChange={(event) =>
                  onSettingsChange({ mediaWorkflow: event.target.value })
                }
                value={settings.mediaWorkflow}
              >
                <option value="">使用模板默认</option>
                {resources.mediaWorkflows.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.display_name}
                  </option>
                ))}
              </select>
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-tts-mode">TTS 模式</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-tts-mode"
                onChange={(event) =>
                  onSettingsChange({
                    ttsInferenceMode: event.target.value as TtsMode,
                  })
                }
                value={settings.ttsInferenceMode}
              >
                <option value="local">本地/Edge Voice</option>
                <option value="comfyui">ComfyUI workflow</option>
                <option value="fish">Fish Audio</option>
              </select>
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-tts-voice">声音或 Reference ID</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-tts-voice"
                onChange={(event) =>
                  onSettingsChange({ ttsVoice: event.target.value })
                }
                value={settings.ttsVoice}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-tts-workflow">TTS workflow</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-tts-workflow"
                onChange={(event) =>
                  onSettingsChange({ ttsWorkflow: event.target.value })
                }
                value={settings.ttsWorkflow}
              >
                <option value="">使用模板默认</option>
                {resources.ttsWorkflows.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.display_name}
                  </option>
                ))}
              </select>
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-tts-speed">语速</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-tts-speed"
                max={2}
                min={0.5}
                onChange={(event) =>
                  onSettingsChange({
                    ttsSpeed: Number(event.target.value || 1),
                  })
                }
                step={0.1}
                type="number"
                value={settings.ttsSpeed}
              />
            </Field>

            {settings.ttsInferenceMode === "comfyui" && (
              <Field className="lg:col-span-2">
                <FieldLabel htmlFor="batch-ref-audio">Reference audio</FieldLabel>
                <input
                  accept="audio/mpeg,audio/wav,audio/flac,audio/mp4,audio/aac,audio/ogg,.mp3,.wav,.flac,.m4a,.aac,.ogg"
                  className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
                  disabled={isUploadingRefAudio}
                  id="batch-ref-audio"
                  onChange={(event) =>
                    void uploadRefAudio(event.currentTarget.files?.[0] ?? null)
                  }
                  type="file"
                />
                <FieldDescription>
                  用于 ComfyUI voice cloning，上传后会传给批量任务。
                </FieldDescription>
                {isUploadingRefAudio && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                    正在上传参考音频
                  </div>
                )}
                {settings.ttsRefAudioPath && (
                  <div className="mt-2 break-all rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                    {settings.ttsRefAudioName || "reference audio"} ·{" "}
                    {settings.ttsRefAudioPath}
                  </div>
                )}
                {refAudioUploadError && (
                  <InlineError
                    title="参考音频上传失败"
                    message={refAudioUploadError}
                  />
                )}
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="batch-bgm">背景音乐</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-bgm"
                onChange={(event) =>
                  onSettingsChange({ bgmPath: event.target.value })
                }
                value={settings.bgmPath}
              >
                <option value="">不指定 BGM</option>
                {resources.bgm.map((item) => (
                  <option key={item.path} value={item.path}>
                    {item.name} · {item.source}
                  </option>
                ))}
              </select>
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-bgm-upload">上传 BGM</FieldLabel>
              <input
                accept="audio/mpeg,audio/wav,audio/flac,audio/mp4,audio/aac,audio/ogg,.mp3,.wav,.flac,.m4a,.aac,.ogg"
                className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
                disabled={isUploadingBgm}
                id="batch-bgm-upload"
                onChange={(event) =>
                  void uploadBgm(event.currentTarget.files?.[0] ?? null)
                }
                type="file"
              />
              <FieldDescription>
                上传后保存为可复用 BGM，并自动用于当前批次设置。
              </FieldDescription>
              {isUploadingBgm && (
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  正在上传 BGM
                </div>
              )}
              {bgmUploadError && (
                <InlineError title="BGM 上传失败" message={bgmUploadError} />
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-bgm-volume">BGM 音量</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-bgm-volume"
                max={1}
                min={0}
                onChange={(event) =>
                  onSettingsChange({
                    bgmVolume: Number(event.target.value || 0),
                  })
                }
                step={0.05}
                type="number"
                value={settings.bgmVolume}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-bgm-mode">BGM 模式</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="batch-bgm-mode"
                onChange={(event) =>
                  onSettingsChange({
                    bgmMode: event.target.value as BatchSharedSettings["bgmMode"],
                  })
                }
                value={settings.bgmMode}
              >
                <option value="loop">循环</option>
                <option value="once">播放一次</option>
              </select>
            </Field>
          </div>

          {bgmPreviewUrl && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-sm font-medium">BGM 预览</div>
              <audio className="mt-3 w-full" controls src={bgmPreviewUrl} />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="batch-prompt-prefix">媒体提示词前缀</FieldLabel>
              <Textarea
                className="min-h-20 resize-y bg-background"
                id="batch-prompt-prefix"
                onChange={(event) =>
                  onSettingsChange({ promptPrefix: event.target.value })
                }
                placeholder="统一追加到每条内容的媒体生成提示词前"
                value={settings.promptPrefix}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="batch-visual-context">视觉上下文</FieldLabel>
              <Textarea
                className="min-h-20 resize-y bg-background"
                id="batch-visual-context"
                onChange={(event) =>
                  onSettingsChange({
                    imagePromptVisualContext: event.target.value,
                  })
                }
                placeholder="例如品牌视觉、宠物品类、画面禁忌"
                value={settings.imagePromptVisualContext}
              />
            </Field>

            <Field className="lg:col-span-2">
              <FieldLabel htmlFor="batch-prompt-rules">图片提示词生成规则</FieldLabel>
              <Textarea
                className="min-h-32 resize-y bg-background"
                id="batch-prompt-rules"
                onChange={(event) =>
                  onSettingsChange({
                    imagePromptGenerationRules: event.target.value,
                  })
                }
                placeholder="留空则使用模板默认规则"
                value={settings.imagePromptGenerationRules}
              />
            </Field>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">模板自定义参数</div>
              <p className="text-sm leading-6 text-muted-foreground">
                参数来自当前 HTML 模板，会随每条批量任务一起提交。
              </p>
            </div>
            {isLoadingTemplateParams && (
              <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin" data-icon="inline-start" />
                正在读取模板参数
              </div>
            )}
            {templateParamsError && (
              <InlineError title="模板参数读取失败" message={templateParamsError} />
            )}
            {!isLoadingTemplateParams &&
              !templateParamsError &&
              templateParamEntries.length === 0 && (
                <div className="mt-3 rounded-lg bg-background p-3 text-sm text-muted-foreground">
                  当前模板没有额外参数。
                </div>
              )}
            {templateParamEntries.length > 0 && (
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {templateParamEntries.map(([name, config]) => {
                  const value =
                    settings.templateParams[name] ??
                    normalizeTemplateParamValue(config.type, config.default)
                  return (
                    <Field key={name}>
                      <FieldLabel htmlFor={`batch-template-param-${name}`}>
                        {config.label || name}
                      </FieldLabel>
                      {config.type === "bool" ? (
                        <label className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm">
                          <input
                            checked={Boolean(value)}
                            id={`batch-template-param-${name}`}
                            onChange={(event) =>
                              updateTemplateParam(
                                name,
                                config,
                                event.target.checked
                              )
                            }
                            type="checkbox"
                          />
                          启用
                        </label>
                      ) : (
                        <input
                          className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                          id={`batch-template-param-${name}`}
                          onChange={(event) =>
                            updateTemplateParam(name, config, event.target.value)
                          }
                          type={
                            config.type === "number"
                              ? "number"
                              : config.type === "color"
                                ? "color"
                                : "text"
                          }
                          value={String(value)}
                        />
                      )}
                      <FieldDescription>
                        默认值：{formatTemplateParamDefault(config.default)}
                      </FieldDescription>
                    </Field>
                  )
                })}
              </div>
            )}
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-sm font-medium">声音预览</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    使用当前批量 TTS 设置调用真实后端。
                  </p>
                </div>
                <Textarea
                  className="min-h-20 resize-y bg-background"
                  onChange={(event) => setTtsPreviewText(event.target.value)}
                  value={ttsPreviewText}
                />
                <Button
                  disabled={isPreviewingTts}
                  onClick={() => void previewTts()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isPreviewingTts ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Volume2 data-icon="inline-start" />
                  )}
                  预览声音
                </Button>
              </div>
              {ttsPreviewError && (
                <InlineError title="TTS 预览失败" message={ttsPreviewError} />
              )}
              {ttsPreview && (
                <div className="mt-4 flex flex-col gap-3">
                  {ttsPreviewUrl ? (
                    <audio className="w-full" controls src={ttsPreviewUrl} />
                  ) : (
                    <InlineError
                      title="音频不可预览"
                      message="后端返回了 audio_path，但无法转换成 /api/files URL。"
                    />
                  )}
                  <MiniFact label="TTS 模式" value={settings.ttsInferenceMode} />
                  <div className="break-all rounded-lg bg-background p-3 font-mono text-xs text-muted-foreground">
                    {ttsPreview.audio_path}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-sm font-medium">画面模板预览</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    使用当前模板和参数渲染真实帧图。
                  </p>
                </div>
                <Input
                  onChange={(event) => setFramePreviewTitle(event.target.value)}
                  placeholder="预览标题"
                  value={framePreviewTitle}
                />
                <Textarea
                  className="min-h-20 resize-y bg-background"
                  onChange={(event) => setFramePreviewText(event.target.value)}
                  value={framePreviewText}
                />
                <Input
                  onChange={(event) => setFramePreviewImage(event.target.value)}
                  placeholder="resources/example.png"
                  value={framePreviewImage}
                />
                <Button
                  disabled={isPreviewingFrame}
                  onClick={() => void previewFrame()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isPreviewingFrame ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <ImageIcon data-icon="inline-start" />
                  )}
                  预览画面
                </Button>
              </div>
              {framePreviewError && (
                <InlineError title="模板预览失败" message={framePreviewError} />
              )}
              {framePreview && (
                <div className="mt-4 flex flex-col gap-3">
                  {framePreviewUrl ? (
                    <img
                      alt="批量画面模板预览"
                      className="aspect-[9/16] max-h-[420px] rounded-lg border bg-background object-contain"
                      src={framePreviewUrl}
                    />
                  ) : (
                    <InlineError
                      title="画面不可预览"
                      message="后端返回了 frame_path，但无法转换成 /api/files URL。"
                    />
                  )}
                  <MiniFact
                    label="渲染尺寸"
                    value={`${framePreview.width} x ${framePreview.height}`}
                  />
                  <div className="break-all rounded-lg bg-background p-3 font-mono text-xs text-muted-foreground">
                    {framePreview.frame_path}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <div className="text-sm font-medium">媒体工作流预览</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    使用当前 workflow 生成一张图片或一段短视频。
                  </p>
                </div>
                <Textarea
                  className="min-h-20 resize-y bg-background"
                  onChange={(event) => setMediaPreviewPrompt(event.target.value)}
                  placeholder={defaultMediaPreviewPrompt(mediaType)}
                  value={mediaPreviewPrompt}
                />
                {mediaType === "video" && (
                  <Field>
                    <FieldLabel htmlFor="batch-media-duration">
                      视频预览时长
                    </FieldLabel>
                    <input
                      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      id="batch-media-duration"
                      max={12}
                      min={1}
                      onChange={(event) =>
                        onSettingsChange({
                          mediaDuration: Number(event.target.value || 4),
                        })
                      }
                      type="number"
                      value={settings.mediaDuration}
                    />
                  </Field>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <MiniFact label="媒体类型" value={mediaType} />
                  <MiniFact
                    label="媒体尺寸"
                    value={`${settings.mediaWidth} x ${settings.mediaHeight}`}
                  />
                </div>
                <Button
                  disabled={mediaType === "static" || isPreviewingMedia}
                  onClick={() => void previewMedia()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {isPreviewingMedia ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <Video data-icon="inline-start" />
                  )}
                  预览媒体
                </Button>
              </div>
              {mediaPreviewError && (
                <InlineError title="媒体预览失败" message={mediaPreviewError} />
              )}
              {mediaPreview && (
                <div className="mt-4 flex flex-col gap-3">
                  {mediaPreviewUrl ? (
                    mediaPreview.media_type === "video" ? (
                      <video className="w-full rounded-lg border" controls src={mediaPreviewUrl} />
                    ) : (
                      <img
                        alt="批量媒体预览"
                        className="aspect-[9/16] max-h-[420px] rounded-lg border bg-background object-contain"
                        src={mediaPreviewUrl}
                      />
                    )
                  ) : (
                    <InlineError
                      title="媒体不可预览"
                      message="后端返回了 media_path，但无法转换成 /api/files URL。"
                    />
                  )}
                  <div className="break-all rounded-lg bg-background p-3 font-mono text-xs text-muted-foreground">
                    {mediaPreview.media_path}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </details>
  )
}

function MiniFact({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value ?? "未返回"}</div>
    </div>
  )
}

function BatchStatusCard({
  batch,
  onRetryItem,
  retryingItemIndex,
}: {
  batch: GenerationBatch | null
  onRetryItem: (itemIndex: number) => void
  retryingItemIndex: number | null
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>批次状态</CardTitle>
        <CardDescription>显示真实 task_id、状态、进度和失败原因。</CardDescription>
      </CardHeader>
      <CardContent>
        {!batch ? (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            创建或选择一个批次。
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <BatchStatusBadge status={batch.status} />
              <Badge variant="outline">{batch.total_count} 条</Badge>
              <Badge variant="outline">失败 {batch.failed_count}</Badge>
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              {batch.batch_id}
            </div>
            <div className="flex max-h-[520px] flex-col gap-2 overflow-auto pr-1">
              {batch.items.map((item) => (
                <div className="rounded-lg border bg-background p-3" key={item.index}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">#{item.index}</div>
                      <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {item.task_id || "未创建 task"}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <BatchStatusBadge status={item.status} />
                      {canRetryBatchItem(item) && (
                        <Button
                          disabled={retryingItemIndex !== null}
                          onClick={() => onRetryItem(item.index)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {retryingItemIndex === item.index && (
                            <Loader2 className="animate-spin" />
                          )}
                          重试
                        </Button>
                      )}
                    </div>
                  </div>
                  {item.progress && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {item.progress.stage} · {item.progress.percentage}%
                    </div>
                  )}
                  {item.error && (
                    <div className="mt-2 rounded-lg bg-destructive/10 p-2 text-xs text-destructive">
                      {item.error.layer}: {item.error.message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BatchStatusBadge({ status }: { status: string }) {
  const destructive = status === "failed" || status === "partial_failed"
  return <Badge variant={destructive ? "destructive" : "secondary"}>{status}</Badge>
}

function canRetryBatchItem(item: GenerationBatchItem) {
  return item.status === "failed" || item.status === "cancelled"
}

function parseTopicItems(
  text: string,
  titlePrefix: string,
  sharedSettings: BatchSharedSettings
) {
  const sharedInput = buildBatchSharedInput(sharedSettings, "generate")
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((topic) => ({
      input: {
        ...sharedInput,
        topic,
        ...(titlePrefix.trim() ? { title: `${titlePrefix.trim()} - ${topic}` } : {}),
      },
    }))
}

function parseFixedScriptItems(
  text: string,
  sharedSettings: BatchSharedSettings
) {
  const sharedInput = buildBatchSharedInput(sharedSettings, "fixed")
  return text
    .split(/\n\s*---\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, index) => {
      const [title, script] = fixedTitleAndBody(block, index + 1)
      return {
        input: {
          ...sharedInput,
          script,
          title,
        },
      }
    })
}

function buildBatchSharedInput(
  settings: BatchSharedSettings,
  mode: BatchMode
) {
  return compactRecord({
    n_scenes: mode === "generate" ? settings.nScenes : undefined,
    split_mode: mode === "fixed" ? settings.splitMode : undefined,
    frame_template: settings.frameTemplate,
    template_params:
      Object.keys(settings.templateParams).length > 0
        ? settings.templateParams
        : undefined,
    media_workflow: settings.mediaWorkflow,
    media_width: settings.mediaWidth,
    media_height: settings.mediaHeight,
    prompt_prefix: settings.promptPrefix.trim(),
    image_prompt_visual_context: settings.imagePromptVisualContext.trim(),
    image_prompt_generation_rules: settings.imagePromptGenerationRules.trim(),
    bgm_path: settings.bgmPath,
    bgm_volume: settings.bgmVolume,
    bgm_mode: settings.bgmMode,
    tts_inference_mode: settings.ttsInferenceMode,
    tts_voice: settings.ttsVoice.trim(),
    tts_workflow: settings.ttsWorkflow,
    tts_speed: settings.ttsSpeed,
    ref_audio:
      settings.ttsInferenceMode === "comfyui"
        ? settings.ttsRefAudioPath
        : undefined,
  })
}

function fixedTitleAndBody(block: string, index: number): [string, string] {
  const lines = block.split(/\r?\n/)
  const title = lines[0]?.trim() || `Task ${index}`
  const body = lines.slice(1).join("\n").trim() || block
  return [title, body]
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== "" && value != null)
  )
}

function buildTemplateParamDefaults(
  params: Record<string, TemplateParamConfig>
) {
  return Object.fromEntries(
    Object.entries(params).map(([name, config]) => [
      name,
      normalizeTemplateParamValue(config.type, config.default),
    ])
  )
}

function normalizeTemplateParamValue(type: string, value: unknown) {
  if (type === "number") {
    return Number(value ?? 0)
  }
  if (type === "bool") {
    return Boolean(value)
  }
  return String(value ?? "")
}

function formatTemplateParamDefault(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "空"
  }
  return String(value)
}

function frameTemplateMediaType(template: string): "static" | "image" | "video" {
  const filename = template.split("/").pop() ?? template
  if (filename.startsWith("static_")) {
    return "static"
  }
  if (filename.startsWith("video_")) {
    return "video"
  }
  return "image"
}

function defaultMediaPreviewPrompt(mediaType: "static" | "image" | "video") {
  if (mediaType === "static") {
    return "静态模板不需要媒体素材"
  }
  if (mediaType === "video") {
    return "a cat drinking water at home, natural light"
  }
  return "a cat drinking clean water at home, warm natural light"
}

function buildMediaPrompt(prompt: string, prefix: string) {
  const cleanedPrompt = prompt.trim()
  const cleanedPrefix = prefix.trim()
  if (cleanedPrompt && cleanedPrefix) {
    return `${cleanedPrefix}, ${cleanedPrompt}`
  }
  return cleanedPrefix || cleanedPrompt
}

function isRejected<T>(
  result: PromiseSettledResult<T>
): result is PromiseRejectedResult {
  return result.status === "rejected"
}

function isTerminalBatchStatus(status: string) {
  return status === "completed" || status === "failed" || status === "partial_failed"
}

function InlineError({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div>
          <div className="font-medium">{title}</div>
          <div className="mt-1 leading-6">{message}</div>
        </div>
      </div>
    </div>
  )
}

function readableError(error: unknown) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
