import { useEffect, useMemo, useState } from "react"
import {
  Copy,
  ImageIcon,
  Layers,
  Loader2,
  Play,
  RefreshCcw,
  Send,
  UploadCloud,
  Video,
  Volume2,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useToast } from "@/components/ui/toast"
import { Fact, InlineError, TechDetails } from "@/components/shared/feedback"
import { StatusBadge } from "@/components/shared/StatusBadge"
import {
  formatBytes,
  formatDuration,
  readableError,
} from "@/lib/format"
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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AdvancedGroup } from "@/components/shared/AdvancedGroup"
import { FileDropzone } from "@/components/shared/FileDropzone"
import {
  artifactKindLabel,
  isNonVideoPipeline,
  templateArtifactType,
  type ArtifactKind,
} from "@/lib/artifactKind"
import {
  getBatchPreviewBody,
  getBatchPreviewLineCount,
  getBatchPreviewTitle,
  parseFixedScriptItems,
  removeScriptItem,
  type ParsedScriptItem,
} from "@/lib/batchInput"
import { trackBatchTasks } from "@/lib/trackBatch"
import { useBatchPolling } from "@/lib/useBatchPolling"
import { BatchStatusCard } from "@/components/shared/BatchStatusCard"
import { ImageSetView } from "@/components/shared/ImageSetView"
import { RecipeSelect } from "@/components/shared/RecipeSelect"
import { TextArticleView } from "@/components/shared/TextArticleView"
import { imageSetLabel } from "@/lib/imageSet"
import {
  isActiveProductTemplate,
  pipelineChipLabel,
} from "@/lib/templatePresentation"
import { useExpertMode } from "@/lib/expertMode"
import { navigate } from "@/lib/router"
import { useTaskCenter } from "@/lib/taskCenter"
import { useCurrentProject } from "@/lib/currentProject"
import { useLocalStorageState } from "@/lib/useLocalStorageState"
import {
  apiResourceUrl,
  artifactFileUrl,
  cancelGenerationTask,
  createGenerationBatch,
  createGenerationTemplateTask,
  fileUrlFromPath,
  generateMediaPreview,
  getFrameTemplateParams,
  getTaskResult,
  isTerminalStatus,
  listResourceBgm,
  listResourceMediaWorkflows,
  listResourceTemplates,
  listResourceTtsWorkflows,
  listTemplates,
  renderFramePreview,
  resourceFileUrl,
  synthesizeTtsPreview,
  uploadGenerationAssets,
  uploadResourceBgm,
  type FramePreviewResponse,
  type GenerationResult,
  type GenerationTask,
  type MediaPreviewResponse,
  type ProductionTemplate,
  type ResourceBgm,
  type ResourceTemplate,
  type ResourceWorkflow,
  type TemplateParamsResponse,
  type TtsPreviewResponse,
  type UploadedGenerationAsset,
} from "@/lib/generationApi"
import {
  buildAssetItems,
  buildProgressRuntimeItems,
  buildQualitySummary,
  type AssetManifestInput,
  type QualityReviewInput,
} from "@/lib/resultSummary"
import { cn } from "@/lib/utils"

const STANDARD_TEMPLATE_ID = "pipeline_standard_base_v1"
const sampleScript =
  "母猫配完以后还一直叫，不一定说明没有配上。发情期的激素变化不会马上停止，所以它可能还会持续叫几天。真正判断有没有配上，要看后续有没有再次发情、精神食欲是否正常，以及是否需要在合适时间做检查。"
const sampleTopic = "猫咪夏天饮水少，主人应该怎么判断和处理"

type LoadState = "loading" | "ready" | "error"

type GenerationResources = {
  bgm: ResourceBgm[]
  frameTemplates: ResourceTemplate[]
  mediaWorkflows: ResourceWorkflow[]
  ttsWorkflows: ResourceWorkflow[]
}

type TemplateParamValue = string | number | boolean

type StandardAdvancedSettings = {
  title: string
  nScenes: number
  splitMode: "paragraph" | "line" | "sentence"
  frameTemplate: string
  templateParams: Record<string, TemplateParamValue>
  mediaWorkflow: string
  mediaWidth: number
  mediaHeight: number
  mediaDuration: number
  mediaPreviewPrompt: string
  promptPrefix: string
  imagePromptVisualContext: string
  imagePromptGenerationRules: string
  bgmPath: string
  bgmVolume: number
  bgmMode: "loop" | "once"
  ttsInferenceMode: "local" | "comfyui" | "fish"
  ttsVoice: string
  ttsWorkflow: string
  ttsSpeed: number
  ttsRefAudioPath: string
  ttsRefAudioName: string
}

type AssetAdvancedSettings = {
  bgmPath: string
  bgmVolume: number
  bgmMode: "loop" | "once"
  voiceId: string
  ttsSpeed: number
}

const defaultResources: GenerationResources = {
  bgm: [],
  frameTemplates: [],
  mediaWorkflows: [],
  ttsWorkflows: [],
}

const defaultAdvancedSettings: StandardAdvancedSettings = {
  title: "",
  nScenes: 5,
  splitMode: "paragraph",
  frameTemplate: "1080x1920/image_default.html",
  templateParams: {},
  mediaWorkflow: "",
  mediaWidth: 1080,
  mediaHeight: 1440,
  mediaDuration: 4,
  mediaPreviewPrompt: "",
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

const defaultAssetAdvancedSettings: AssetAdvancedSettings = {
  bgmPath: "",
  bgmVolume: 0.2,
  bgmMode: "loop",
  voiceId: "zh-CN-YunjianNeural",
  ttsSpeed: 1.2,
}

export function GenerateWorkspace({ templateId }: { templateId?: string }) {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [reloadToken, setReloadToken] = useState(0)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [template, setTemplate] = useState<ProductionTemplate | null>(null)
  const [script, setScript] = useLocalStorageState(
    "pixelle-draft-script",
    ""
  )
  const [topic, setTopic] = useLocalStorageState("pixelle-draft-topic", "")
  const [advancedSettings, setAdvancedSettings] =
    useState<StandardAdvancedSettings>(defaultAdvancedSettings)
  const [resources, setResources] =
    useState<GenerationResources>(defaultResources)
  const [resourcesError, setResourcesError] = useState<string | null>(null)
  const [assetFiles, setAssetFiles] = useState<File[]>([])
  const [uploadedAssets, setUploadedAssets] = useState<UploadedGenerationAsset[]>([])
  const [assetTitle, setAssetTitle] = useState("")
  const [assetIntent, setAssetIntent] = useState(
    "根据这些用户素材制作一条适合小红书发布的 PetWoods 短视频。"
  )
  const [assetDuration, setAssetDuration] = useState(30)
  const [assetAdvancedSettings, setAssetAdvancedSettings] =
    useState<AssetAdvancedSettings>(defaultAssetAdvancedSettings)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCancellingTask, setIsCancellingTask] = useState(false)
  const [taskActionError, setTaskActionError] = useState<string | null>(null)
  // 批量提交模式（本页内存态，不持久化）
  const [batchMode, setBatchMode] = useState(false)
  const [batchText, setBatchText] = useState("")
  const {
    batch: submittedBatch,
    setBatch: setSubmittedBatch,
    retryItem: retryBatchItem,
    retryingItemIndex: retryingBatchIndex,
  } = useBatchPolling()
  const taskCenter = useTaskCenter()
  const toast = useToast()
  const { projectId } = useCurrentProject()

  const task = currentTaskId
    ? (taskCenter.getTask(currentTaskId)?.task ?? null)
    : null

  const trimmedScript = script.trim()
  const trimmedTopic = topic.trim()
  const trimmedAssetTitle = assetTitle.trim()
  const trimmedAssetIntent = assetIntent.trim()
  const templateNeedsAssets = Boolean(
    template?.requires_user_assets || template?.input_requirements.includes("assets")
  )
  const templateNeedsTopic = Boolean(template?.input_requirements.includes("topic"))
  // 非视频产线（图文线 / 长文线）：无配音/画面/合成视频，隐藏视频专属输入与承诺文案
  const isNonVideo = isNonVideoPipeline(template?.pipeline_id)
  const nonVideoArtifact = templateArtifactType(template?.pipeline_id)
  // 批量是「任何 script 入口配方生成页的一种提交模式」——topic/assets 入口不支持
  const canBatch = Boolean(
    template &&
      template.product_entry === "generate" &&
      template.input_requirements.includes("script") &&
      !templateNeedsAssets &&
      !templateNeedsTopic
  )
  const inBatch = batchMode && canBatch
  const batchItems = useMemo(
    () => parseFixedScriptItems(batchText),
    [batchText]
  )
  const batchMeasureWord = nonVideoArtifact === "text" ? "篇" : "条"
  const batchOutputNoun =
    nonVideoArtifact === "text"
      ? "长文"
      : nonVideoArtifact === "image_set"
        ? "图文帖"
        : "视频"
  const templateCanSubmit = Boolean(
    template &&
      template.enabled &&
      ((template.input_requirements.includes("script") && !template.requires_user_assets) ||
        template.input_requirements.includes("topic") ||
        template.input_requirements.includes("assets"))
  )
  const hasRequiredTemplateInput = templateNeedsAssets
    ? assetFiles.length > 0
    : templateNeedsTopic
      ? trimmedTopic.length > 0
    : trimmedScript.length > 0
  const canSubmit =
    loadState === "ready" &&
    templateCanSubmit &&
    hasRequiredTemplateInput &&
    !isSubmitting &&
    !(task && !isTerminalStatus(task.status))
  const submitDisabledReason = canSubmit
    ? null
    : isSubmitting
      ? null
      : loadState !== "ready"
        ? "正在读取可用模板"
        : !templateCanSubmit
          ? "当前模板暂不支持在此页提交"
          : task && !isTerminalStatus(task.status)
            ? "有任务正在生成中，完成后可再次提交"
            : templateNeedsAssets
              ? "请先选择素材文件"
              : templateNeedsTopic
                ? "请先输入选题"
                : "请先输入文案"

  useEffect(() => {
    let cancelled = false

    async function loadTemplates() {
      setLoadState("loading")
      setTemplatesError(null)
      try {
        // 默认模板 = 项目默认 > 全局（后端按 project 解析 default_template）
        const response = await listTemplates(projectId ?? undefined)
        if (cancelled) {
          return
        }

        const defaultId =
          templateId || response.default_template || STANDARD_TEMPLATE_ID
        const selected =
          response.templates.find((item) => item.id === defaultId) ??
          response.templates.find((item) => item.id === STANDARD_TEMPLATE_ID) ??
          null

        if (!selected) {
          setLoadState("error")
          setTemplatesError("没有找到可用的默认生成模板。")
          return
        }

        setTemplates(response.templates)
        setTemplate(selected)
        setLoadState("ready")
      } catch (error) {
        if (cancelled) {
          return
        }
        setLoadState("error")
        setTemplatesError(readableError(error))
      }
    }

    loadTemplates()

    return () => {
      cancelled = true
    }
  }, [reloadToken, templateId, projectId])

  useEffect(() => {
    let cancelled = false

    async function loadResources() {
      setResourcesError(null)
      const [bgmResult, frameTemplateResult, mediaWorkflowResult, ttsWorkflowResult] =
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
          frameTemplateResult.status === "fulfilled"
            ? frameTemplateResult.value.templates
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

      const failures = [
        bgmResult,
        frameTemplateResult,
        mediaWorkflowResult,
        ttsWorkflowResult,
      ]
        .filter((result) => result.status === "rejected")
        .map((result) => readableError((result as PromiseRejectedResult).reason))
      if (failures.length > 0) {
        setResourcesError(failures.join("；"))
      }
    }

    void loadResources()

    return () => {
      cancelled = true
    }
  }, [])

  // 轮询与终态通知由全局任务中心负责；这里只在完成后拉取结果。
  useEffect(() => {
    if (!task || task.status !== "completed" || result?.task_id === task.task_id) {
      return
    }

    let cancelled = false
    const completedTaskId = task.task_id
    async function loadResult() {
      try {
        const taskResult = await getTaskResult(completedTaskId)
        if (!cancelled) {
          setResult(taskResult)
        }
      } catch (error) {
        if (!cancelled) {
          setTaskActionError(readableError(error))
        }
      }
    }

    loadResult()

    return () => {
      cancelled = true
    }
  }, [task, result?.task_id])

  async function submitTask() {
    if (!template || !canSubmit) {
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)
    setTaskActionError(null)
    setCurrentTaskId(null)
    setResult(null)

    try {
      let response
      if (templateNeedsAssets) {
        const uploadResponse = await uploadGenerationAssets(assetFiles)
        const uploaded = uploadResponse.assets
        setUploadedAssets(uploaded)
        response = await createGenerationTemplateTask(
          template.id,
          {
            assets: uploaded.map((asset) => asset.path),
            video_title: trimmedAssetTitle,
            intent: trimmedAssetIntent || trimmedAssetTitle,
            duration: assetDuration,
            bgm_path: assetAdvancedSettings.bgmPath,
            bgm_volume: assetAdvancedSettings.bgmVolume,
            bgm_mode: assetAdvancedSettings.bgmMode,
            voice_id: assetAdvancedSettings.voiceId.trim(),
            tts_speed: assetAdvancedSettings.ttsSpeed,
          },
          {
            source: "react_p8_demo",
            uploaded_assets: uploaded,
            template_use_case: template.use_case,
          },
          projectId ?? undefined
        )
      } else {
        response = await createGenerationTemplateTask(
          template.id,
          buildStandardTemplateInput({
            advancedSettings,
            script: trimmedScript,
            template,
            topic: trimmedTopic,
          }),
          {
            source: "react_streamlit_migration",
            template_use_case: template.use_case,
          },
          projectId ?? undefined
        )
      }
      taskCenter.trackTask(response.task, template.display_name)
      setCurrentTaskId(response.task.task_id)
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitBatch() {
    if (!template || batchItems.length === 0 || isSubmitting) {
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      // 每条：本条 script + 首行标题 + 其余高级设置作共享参数 merge（与旧批量页语义一致）
      const items = batchItems.map((item) => ({
        input: buildStandardTemplateInput({
          template,
          script: item.input.script,
          topic: "",
          advancedSettings: { ...advancedSettings, title: item.input.title },
        }),
      }))
      const response = await createGenerationBatch({
        templateId: template.id,
        items,
        metadata: { source: "react_generate_batch", mode: "fixed" },
        projectId: projectId ?? undefined,
      })
      setSubmittedBatch(response)
      toast({
        title: `批量任务已创建（${response.total_count} ${batchMeasureWord}）`,
        variant: "success",
      })
      void trackBatchTasks(response, taskCenter.trackTask, template.display_name)
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function cancelCurrentTask() {
    if (!task || isTerminalStatus(task.status) || isCancellingTask) {
      return
    }

    setIsCancellingTask(true)
    setTaskActionError(null)
    try {
      const latest = await cancelGenerationTask(task.task_id)
      taskCenter.updateTask(latest)
    } catch (error) {
      setTaskActionError(readableError(error))
    } finally {
      setIsCancellingTask(false)
    }
  }

  function addBgmResource(bgm: ResourceBgm) {
    setResources((current) => ({
      ...current,
      bgm: [bgm, ...current.bgm.filter((item) => item.path !== bgm.path)],
    }))
  }

  /**
   * 页头下拉换配方：选择器只列启用的 generate 配方，故直接切换 + 同步 URL，
   * 已输入文案保留（现状行为）。若新配方不支持批量（素材/选题入口），落回单条
   * 模式但保留 batchText 以免丢字。
   */
  function handleSelectTemplate(nextTemplate: ProductionTemplate) {
    const nextCanBatch =
      nextTemplate.product_entry === "generate" &&
      nextTemplate.input_requirements.includes("script") &&
      !nextTemplate.requires_user_assets &&
      !nextTemplate.input_requirements.includes("assets") &&
      !nextTemplate.input_requirements.includes("topic")
    if (!nextCanBatch) {
      setBatchMode(false)
    }
    setTemplate(nextTemplate)
    navigate(`/create/generate/${nextTemplate.id}`)
  }

  return (
    <TooltipProvider>
      <div>
        <main className="grid max-w-[1240px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6">
            <section className="flex min-w-0 flex-col gap-5">
              <Card className="rounded-lg">
                <CardHeader className="border-b">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle>
                        {templateNeedsAssets
                          ? "上传素材"
                          : templateNeedsTopic
                            ? "输入选题"
                            : "填入文案"}
                      </CardTitle>
                      <CardDescription>
                        {templateNeedsAssets
                          ? "上传你的照片或视频，AI 会围绕它们组织旁白和镜头。"
                          : templateNeedsTopic
                            ? "只需一个选题，AI 会自动撰写文案并完成配音、画面和合成。"
                            : nonVideoArtifact === "text"
                              ? "文案将扩写成结构化长文，不配音、不合成视频。"
                              : nonVideoArtifact === "image_set"
                                ? "文案将逐行排版成图集，不配音、不合成视频。"
                                : "文案不会被改写，将按原文进行拆分、配音、配画面并合成视频。"}
                      </CardDescription>
                    </div>
                    {canBatch && (
                      <ToggleGroup
                        onValueChange={(value) => {
                          if (value) {
                            setBatchMode(value === "batch")
                          }
                        }}
                        type="single"
                        value={inBatch ? "batch" : "single"}
                        variant="outline"
                      >
                        <ToggleGroupItem value="single">单条</ToggleGroupItem>
                        <ToggleGroupItem value="batch">批量</ToggleGroupItem>
                      </ToggleGroup>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <TemplateSummaryBar
                    error={templatesError}
                    loadState={loadState}
                    onReload={() => setReloadToken((token) => token + 1)}
                    onSelect={handleSelectTemplate}
                    template={template}
                    templates={templates}
                  />

                  {!templateCanSubmit && loadState === "ready" && (
                    <InlineError
                      title="当前模板暂不支持在此页提交"
                      message="请更换一个可用模板，或前往对应的专用入口。"
                    />
                  )}

                  <div className="mt-5">
                  {templateNeedsAssets ? (
                    <AssetInput
                      assetAdvancedSettings={assetAdvancedSettings}
                      assetDuration={assetDuration}
                      assetFiles={assetFiles}
                      assetIntent={assetIntent}
                      assetTitle={assetTitle}
                      onAssetAdvancedSettingsChange={setAssetAdvancedSettings}
                      onBgmUploaded={addBgmResource}
                      onAssetDurationChange={setAssetDuration}
                      onAssetFilesChange={(files) => {
                        setAssetFiles(files)
                        setUploadedAssets([])
                        setSubmitError(null)
                      }}
                      onAssetIntentChange={setAssetIntent}
                      onAssetTitleChange={setAssetTitle}
                      resources={resources}
                      resourcesError={resourcesError}
                      uploadedAssets={uploadedAssets}
                    />
                  ) : templateNeedsTopic ? (
                    <StandardInput
                      advancedSettings={advancedSettings}
                      inputKind="topic"
                      onBgmUploaded={addBgmResource}
                      onAdvancedSettingsChange={setAdvancedSettings}
                      onTextChange={setTopic}
                      resources={resources}
                      resourcesError={resourcesError}
                      sampleText={sampleTopic}
                      text={topic}
                    />
                  ) : (
                    <StandardInput
                      advancedSettings={advancedSettings}
                      artifactKind={nonVideoArtifact}
                      batchItems={batchItems}
                      batchMode={inBatch}
                      batchText={batchText}
                      inputKind="script"
                      isNonVideo={isNonVideo}
                      onBatchTextChange={setBatchText}
                      onBgmUploaded={addBgmResource}
                      onAdvancedSettingsChange={setAdvancedSettings}
                      onRemoveBatchItem={(index) =>
                        setBatchText((current) =>
                          removeScriptItem(current, index)
                        )
                      }
                      onTextChange={setScript}
                      resources={resources}
                      resourcesError={resourcesError}
                      sampleText={sampleScript}
                      text={script}
                    />
                  )}
                  </div>

                  {submitError && (
                    <InlineError title="提交失败" message={submitError} />
                  )}

                  <div className="mt-5 flex flex-col items-end gap-1.5">
                    {inBatch ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            disabled={batchItems.length === 0 || isSubmitting}
                            size="lg"
                          >
                            {isSubmitting ? (
                              <Loader2
                                className="animate-spin"
                                data-icon="inline-start"
                              />
                            ) : (
                              <Layers data-icon="inline-start" />
                            )}
                            {isSubmitting
                              ? "正在提交…"
                              : `批量生成 ${batchItems.length} ${batchMeasureWord}${batchOutputNoun}`}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              批量生成 {batchItems.length} {batchMeasureWord}
                              {batchOutputNoun}？
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              每条会占用一次生成额度，提交后可在下方与「任务」页跟踪进度、失败可单条重试。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>再检查一下</AlertDialogCancel>
                            <AlertDialogAction
                              className={cn(
                                buttonVariants({ variant: "default" })
                              )}
                              onClick={() => void submitBatch()}
                            >
                              确认提交
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <Button disabled={!canSubmit} onClick={submitTask} size="lg">
                        {isSubmitting ? (
                          <Loader2 className="animate-spin" data-icon="inline-start" />
                        ) : templateNeedsAssets ? (
                          <UploadCloud data-icon="inline-start" />
                        ) : (
                          <Play data-icon="inline-start" />
                        )}
                        {isSubmitting
                          ? templateNeedsAssets
                            ? "正在上传并提交…"
                            : "正在提交…"
                          : "开始生成"}
                      </Button>
                    )}
                    {!inBatch && submitDisabledReason && (
                      <div className="text-xs text-muted-foreground">
                        {submitDisabledReason}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {inBatch && submittedBatch && (
                <BatchStatusCard
                  artifactLabel={artifactKindLabel(nonVideoArtifact)}
                  batch={submittedBatch}
                  onRetryItem={retryBatchItem}
                  retryingItemIndex={retryingBatchIndex}
                />
              )}
            </section>

            {inBatch ? (
              <aside className="flex min-w-0 flex-col gap-5">
                <Card className="rounded-lg">
                  <CardHeader className="border-b">
                    <CardTitle>批量提交</CardTitle>
                    <CardDescription>
                      每条一个任务，共享上方的画面/声音等设置；提交后进度显示在左侧与「任务」页。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground">
                      {batchItems.length > 0
                        ? `已解析 ${batchItems.length} ${batchMeasureWord}`
                        : "在左侧粘贴多条内容开始批量。"}
                    </div>
                  </CardContent>
                </Card>
              </aside>
            ) : (
              <TaskPanel
                isCancellingTask={isCancellingTask}
                onCancelTask={cancelCurrentTask}
                result={result}
                task={task}
                taskActionError={taskActionError}
                template={template}
              />
            )}
          </main>
      </div>
    </TooltipProvider>
  )
}

function TemplateSummaryBar({
  loadState,
  template,
  templates,
  error,
  onReload,
  onSelect,
}: {
  loadState: LoadState
  template: ProductionTemplate | null
  templates: ProductionTemplate[]
  error: string | null
  onReload: () => void
  onSelect: (template: ProductionTemplate) => void
}) {
  if (loadState === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        正在读取可用配方
      </div>
    )
  }

  if (loadState === "error") {
    return (
      <div className="flex flex-col gap-3">
        <InlineError title="配方读取失败" message={error || "未知错误"} />
        <Button onClick={onReload} variant="outline">
          <RefreshCcw data-icon="inline-start" />
          重试
        </Button>
      </div>
    )
  }

  if (!template) {
    return null
  }

  // 只列启用、非退役、product_entry === "generate" 的配方——退役项与专用入口不出现。
  // 兜底：当前配方即便被过滤掉（异常态）也保留在可选项，避免下拉空白。
  const selectable = templates.filter(isActiveProductTemplate)
  const options = selectable.some((item) => item.id === template.id)
    ? selectable
    : [template, ...selectable]

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <RecipeSelect
            onChange={onSelect}
            templates={options}
            triggerClassName="w-full sm:w-[260px]"
            value={template.id}
          />
          <Badge variant="outline">
            {pipelineChipLabel(template.pipeline_id)} ·{" "}
            {artifactKindLabel(templateArtifactType(template.pipeline_id))}
          </Badge>
          <Badge variant="outline">预计 {template.estimated_turnaround}</Badge>
        </div>
        <button
          className="shrink-0 self-start text-xs text-primary transition-colors hover:underline sm:self-auto"
          onClick={() => navigate(`/create/recipes/${template.id}`)}
          type="button"
        >
          调整默认配方
        </button>
      </div>
      <p className="line-clamp-1 text-xs leading-5 text-muted-foreground">
        {template.description}
      </p>
    </div>
  )
}

function StandardInput({
  inputKind,
  text,
  advancedSettings,
  resources,
  resourcesError,
  sampleText,
  isNonVideo = false,
  artifactKind = "video",
  batchMode = false,
  batchText = "",
  batchItems = [],
  onBatchTextChange,
  onRemoveBatchItem,
  onTextChange,
  onAdvancedSettingsChange,
  onBgmUploaded,
}: {
  inputKind: "script" | "topic"
  text: string
  advancedSettings: StandardAdvancedSettings
  resources: GenerationResources
  resourcesError: string | null
  sampleText?: string
  isNonVideo?: boolean
  artifactKind?: ArtifactKind
  batchMode?: boolean
  batchText?: string
  batchItems?: ParsedScriptItem[]
  onBatchTextChange?: (value: string) => void
  onRemoveBatchItem?: (index: number) => void
  onTextChange: (value: string) => void
  onAdvancedSettingsChange: (value: StandardAdvancedSettings) => void
  onBgmUploaded: (bgm: ResourceBgm) => void
}) {
  const trimmedText = text.trim()
  const inputId = inputKind === "topic" ? "topic" : "script"
  const title =
    inputKind === "topic" ? "选题或内容方向" : isNonVideo ? "文案" : "视频文案"
  const description =
    inputKind === "topic"
      ? "AI 会先撰写文案，再继续拆分、配音、画面生成和合成。"
      : artifactKind === "text"
        ? "这段文字会扩写成结构化长文，不配音、不合成视频。"
        : artifactKind === "image_set"
          ? "这段文字会逐行排版成图集，不配音、不合成视频。"
          : "这段文字会按原文拆分、配音、配画面并合成视频。"
  const batchListLabel = artifactKind === "text" ? "稿件列表" : "文案列表"
  const batchListHint =
    artifactKind === "text"
      ? "每篇会按配方的长文提示词扩写成结构化 markdown，换行不影响结果。"
      : artifactKind === "image_set"
        ? "用 --- 单独一行分隔多条；每条首行作标题。图文线按行分页，注意换行即分页。"
        : "用 --- 单独一行分隔多条；每条首行作标题。"
  const expertMode = useExpertMode()
  const [ttsPreview, setTtsPreview] = useState<TtsPreviewResponse | null>(null)
  const [ttsPreviewError, setTtsPreviewError] = useState<string | null>(null)
  const [isPreviewingTts, setIsPreviewingTts] = useState(false)
  const [framePreview, setFramePreview] =
    useState<FramePreviewResponse | null>(null)
  const [framePreviewParams, setFramePreviewParams] =
    useState<TemplateParamsResponse | null>(null)
  const [framePreviewError, setFramePreviewError] = useState<string | null>(null)
  const [isPreviewingFrame, setIsPreviewingFrame] = useState(false)
  const [mediaPreview, setMediaPreview] =
    useState<MediaPreviewResponse | null>(null)
  const [mediaPreviewError, setMediaPreviewError] = useState<string | null>(null)
  const [isPreviewingMedia, setIsPreviewingMedia] = useState(false)
  const [refAudioUploadError, setRefAudioUploadError] = useState<string | null>(
    null
  )
  const [isUploadingRefAudio, setIsUploadingRefAudio] = useState(false)
  const [templateParamsResponse, setTemplateParamsResponse] =
    useState<TemplateParamsResponse | null>(null)
  const [templateParamsError, setTemplateParamsError] = useState<string | null>(
    null
  )
  const [isLoadingTemplateParams, setIsLoadingTemplateParams] = useState(true)
  const previewText =
    previewCopy(inputKind, text, advancedSettings.title) ||
    "这是一段用于预览画面与声音的示例文案。"
  const ttsPreviewUrl = fileUrlFromPath(ttsPreview?.audio_path)
  const framePreviewUrl = fileUrlFromPath(framePreview?.frame_path)
  const mediaPreviewUrl = mediaPreviewFileUrl(mediaPreview?.media_path)
  const bgmPreviewUrl = resourceFileUrl(advancedSettings.bgmPath)
  const mediaType = frameTemplateMediaType(advancedSettings.frameTemplate)
  const mediaPreviewPrompt =
    advancedSettings.mediaPreviewPrompt?.trim() ||
    defaultMediaPreviewPrompt(mediaType)
  const templateParamEntries = templateParamsResponse
    ? Object.entries(templateParamsResponse.params)
    : []

  useEffect(() => {
    let cancelled = false

    getFrameTemplateParams(advancedSettings.frameTemplate)
      .then((response) => {
        if (!cancelled) {
          setTemplateParamsResponse(response)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTemplateParamsResponse(null)
          setTemplateParamsError(readableError(error))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingTemplateParams(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [advancedSettings.frameTemplate])

  useEffect(() => {
    if (!templateParamsResponse) {
      return
    }

    const defaults = templateParamDefaultValues(templateParamsResponse)
    const allowedNames = new Set(Object.keys(defaults))
    const currentValues = Object.fromEntries(
      Object.entries(advancedSettings.templateParams).filter(([name]) =>
        allowedNames.has(name)
      )
    ) as Record<string, TemplateParamValue>
    const nextValues = { ...defaults, ...currentValues }
    const nextSettings = {
      ...advancedSettings,
      mediaWidth: templateParamsResponse.media_width,
      mediaHeight: templateParamsResponse.media_height,
      templateParams: nextValues,
    }

    if (
      !sameTemplateParams(nextValues, advancedSettings.templateParams) ||
      advancedSettings.mediaWidth !== templateParamsResponse.media_width ||
      advancedSettings.mediaHeight !== templateParamsResponse.media_height
    ) {
      onAdvancedSettingsChange(nextSettings)
    }
  }, [advancedSettings, onAdvancedSettingsChange, templateParamsResponse])

  function patchAdvanced(patch: Partial<StandardAdvancedSettings>) {
    setTtsPreview(null)
    setTtsPreviewError(null)
    setFramePreview(null)
    setFramePreviewParams(null)
    setFramePreviewError(null)
    setMediaPreview(null)
    setMediaPreviewError(null)
    if (patch.frameTemplate) {
      setTemplateParamsResponse(null)
      setTemplateParamsError(null)
      setIsLoadingTemplateParams(true)
    }
    onAdvancedSettingsChange({ ...advancedSettings, ...patch })
  }

  function updateTemplateParam(
    name: string,
    config: TemplateParamsResponse["params"][string],
    value: string | boolean
  ) {
    patchAdvanced({
      templateParams: {
        ...advancedSettings.templateParams,
        [name]: normalizeTemplateParamValue(config.type, value),
      },
    })
  }

  function updateText(value: string) {
    setTtsPreview(null)
    setTtsPreviewError(null)
    setFramePreview(null)
    setFramePreviewParams(null)
    setFramePreviewError(null)
    setMediaPreview(null)
    setMediaPreviewError(null)
    onTextChange(value)
  }

  async function uploadRefAudio(file: File | null) {
    setRefAudioUploadError(null)
    if (!file) {
      patchAdvanced({ ttsRefAudioPath: "", ttsRefAudioName: "" })
      return
    }

    setIsUploadingRefAudio(true)
    try {
      const response = await uploadGenerationAssets([file])
      const asset = response.assets[0]
      if (!asset || asset.kind !== "audio") {
        throw new Error("上传的文件不是可用的音频。")
      }
      patchAdvanced({
        ttsRefAudioPath: asset.path,
        ttsRefAudioName: asset.original_filename,
      })
    } catch (error) {
      setRefAudioUploadError(readableError(error))
      patchAdvanced({ ttsRefAudioPath: "", ttsRefAudioName: "" })
    } finally {
      setIsUploadingRefAudio(false)
    }
  }

  async function previewTts() {
    setIsPreviewingTts(true)
    setTtsPreview(null)
    setTtsPreviewError(null)
    try {
      const response = await synthesizeTtsPreview({
        text: previewText,
        inferenceMode: advancedSettings.ttsInferenceMode,
        workflow: advancedSettings.ttsWorkflow,
        voiceId:
          advancedSettings.ttsInferenceMode === "fish"
            ? undefined
            : advancedSettings.ttsVoice.trim(),
        referenceId:
          advancedSettings.ttsInferenceMode === "fish"
            ? advancedSettings.ttsVoice.trim()
            : undefined,
        speed: advancedSettings.ttsSpeed,
        refAudio:
          advancedSettings.ttsInferenceMode === "comfyui"
            ? advancedSettings.ttsRefAudioPath
            : undefined,
      })
      setTtsPreview(response)
    } catch (error) {
      setTtsPreviewError(readableError(error))
    } finally {
      setIsPreviewingTts(false)
    }
  }

  async function previewMedia() {
    if (mediaType === "static") {
      setMediaPreviewError("当前模板是静态模板，不需要生成媒体素材。")
      return
    }
    if (!mediaPreviewPrompt) {
      setMediaPreviewError("请先输入媒体预览提示词。")
      return
    }

    setIsPreviewingMedia(true)
    setMediaPreview(null)
    setMediaPreviewError(null)
    try {
      const response = await generateMediaPreview({
        prompt: buildMediaPrompt(mediaPreviewPrompt, advancedSettings.promptPrefix),
        workflow: advancedSettings.mediaWorkflow,
        mediaType,
        width: advancedSettings.mediaWidth,
        height: advancedSettings.mediaHeight,
        duration: advancedSettings.mediaDuration,
      })
      setMediaPreview(response)
    } catch (error) {
      setMediaPreviewError(readableError(error))
    } finally {
      setIsPreviewingMedia(false)
    }
  }

  async function previewFrame() {
    setIsPreviewingFrame(true)
    setFramePreview(null)
    setFramePreviewParams(null)
    setFramePreviewError(null)
    try {
      const [frameResponse, paramsResponse] = await Promise.all([
        renderFramePreview({
          template: advancedSettings.frameTemplate,
          title: advancedSettings.title.trim() || undefined,
          text: previewText,
          templateParams: advancedSettings.templateParams,
        }),
        getFrameTemplateParams(advancedSettings.frameTemplate),
      ])
      setFramePreview(frameResponse)
      setFramePreviewParams(paramsResponse)
    } catch (error) {
      setFramePreviewError(readableError(error))
    } finally {
      setIsPreviewingFrame(false)
    }
  }

  return (
    <FieldGroup>
      {batchMode ? (
        <BatchScriptInput
          artifactKind={artifactKind}
          items={batchItems}
          label={batchListLabel}
          hint={batchListHint}
          onRemoveItem={onRemoveBatchItem}
          onTextChange={onBatchTextChange}
          text={batchText}
        />
      ) : (
        <Field data-invalid={!trimmedText && text.length > 0}>
          <FieldLabel htmlFor={inputId}>{title}</FieldLabel>
          <Textarea
            aria-invalid={!trimmedText && text.length > 0}
            className="min-h-52 resize-y text-base leading-7"
            id={inputId}
            onChange={(event) => updateText(event.target.value)}
            placeholder={
              inputKind === "topic"
                ? "例如：猫咪夏天饮水少，主人应该怎么判断和处理"
                : "粘贴或输入完整视频文案…"
            }
            value={text}
          />
          <FieldDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{description}</span>
            {sampleText && !trimmedText && (
              <Button
                onClick={() => updateText(sampleText)}
                size="xs"
                type="button"
                variant="ghost"
              >
                填入示例
              </Button>
            )}
          </FieldDescription>
        </Field>
      )}

      {resourcesError && (
        <InlineError title="资源读取失败" message={resourcesError} />
      )}

      <div className="flex flex-col gap-3">
        <AdvancedGroup
          description="标题、分镜与提示词规则"
          id="content"
          title="内容结构"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {/* 批量态标题取每条首行，隐藏共享标题字段 */}
            {!batchMode && (
              <Field>
                <FieldLabel htmlFor="advanced-title">
                  {isNonVideo ? "标题" : "视频标题"}
                </FieldLabel>
                <Input
                  id="advanced-title"
                  onChange={(event) => patchAdvanced({ title: event.target.value })}
                  placeholder="可选"
                  value={advancedSettings.title}
                />
              </Field>
            )}

            {inputKind === "topic" ? (
              <Field>
                <FieldLabel htmlFor="advanced-scenes">分镜数量</FieldLabel>
                <Input
                  id="advanced-scenes"
                  max={12}
                  min={1}
                  onChange={(event) =>
                    patchAdvanced({ nScenes: Number(event.target.value || 5) })
                  }
                  type="number"
                  value={advancedSettings.nScenes}
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel>文案拆分方式</FieldLabel>
                <ToggleGroup
                  onValueChange={(value) => {
                    if (value) {
                      patchAdvanced({
                        splitMode:
                          value as StandardAdvancedSettings["splitMode"],
                      })
                    }
                  }}
                  type="single"
                  value={advancedSettings.splitMode}
                  variant="outline"
                >
                  <ToggleGroupItem value="paragraph">按段落</ToggleGroupItem>
                  <ToggleGroupItem value="line">按行</ToggleGroupItem>
                  <ToggleGroupItem value="sentence">按句子</ToggleGroupItem>
                </ToggleGroup>
              </Field>
            )}
          </div>

          <Field>
            <FieldLabel htmlFor="advanced-prompt-rules">
              画面提示词生成规则
            </FieldLabel>
            <Textarea
              className="min-h-20 resize-y"
              id="advanced-prompt-rules"
              onChange={(event) =>
                patchAdvanced({
                  imagePromptGenerationRules: event.target.value,
                })
              }
              placeholder="可选，用于约束每个分镜画面提示词的生成。"
              value={advancedSettings.imagePromptGenerationRules}
            />
          </Field>
        </AdvancedGroup>

        {/* 长文（text）无画面；图集/视频保留画面风格 */}
        {artifactKind !== "text" && (
        <AdvancedGroup
          description="画面模板、参数与帧图预览"
          id="visual"
          title="画面风格"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Field>
              <FieldLabel>画面模板</FieldLabel>
              <Select
                onValueChange={(value) =>
                  patchAdvanced({ frameTemplate: value })
                }
                value={advancedSettings.frameTemplate}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择画面模板" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1080x1920/image_default.html">
                    1080x1920/image_default.html
                  </SelectItem>
                  {resources.frameTemplates
                    .filter(
                      (item) => item.key !== "1080x1920/image_default.html"
                    )
                    .map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.key}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {/* 静态预览图（原版 docs/images 图库）：选择即见；「生成预览」留给带自定义参数的真渲染 */}
              {(() => {
                const previewSrc = apiResourceUrl(
                  resources.frameTemplates.find(
                    (item) => item.key === advancedSettings.frameTemplate
                  )?.preview_url
                )
                return previewSrc ? (
                  <img
                    alt="画面模板样式预览"
                    className="mt-2 max-h-64 w-auto self-start rounded-md border"
                    src={previewSrc}
                  />
                ) : null
              })()}
            </Field>

            {expertMode && (
              <Field>
                <FieldLabel>画面 workflow</FieldLabel>
                <Select
                  onValueChange={(value) =>
                    patchAdvanced({
                      mediaWorkflow: value === "__default__" ? "" : value,
                    })
                  }
                  value={advancedSettings.mediaWorkflow || "__default__"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">使用模板默认</SelectItem>
                    {resources.mediaWorkflows.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>专家模式覆盖项。</FieldDescription>
              </Field>
            )}
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">模板自定义参数</div>
              <p className="text-sm leading-6 text-muted-foreground">
                参数来自当前画面模板，会随生成任务一起提交。
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
                    advancedSettings.templateParams[name] ??
                    normalizeTemplateParamValue(config.type, config.default)
                  return (
                    <Field key={name}>
                      <FieldLabel htmlFor={`template-param-${name}`}>
                        {config.label || name}
                      </FieldLabel>
                      {config.type === "bool" ? (
                        <label className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-sm">
                          <input
                            checked={Boolean(value)}
                            id={`template-param-${name}`}
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
                          id={`template-param-${name}`}
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

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-medium">画面预览</div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  用当前画面模板渲染一张示例帧图；未填文案时使用示例文案。
                </p>
              </div>
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
              <InlineError title="画面预览失败" message={framePreviewError} />
            )}
            {framePreview && (
              <div className="mt-4 flex flex-col gap-3">
                {framePreviewUrl ? (
                  <img
                    alt="画面模板预览"
                    className="aspect-[9/16] max-h-[420px] rounded-lg border bg-background object-contain"
                    src={framePreviewUrl}
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
                  <Fact
                    label="媒体区域"
                    value={
                      framePreviewParams
                        ? `${framePreviewParams.media_width} x ${framePreviewParams.media_height}`
                        : "未返回"
                    }
                  />
                </div>
                <TechDetails
                  items={[{ label: "帧图路径", value: framePreview.frame_path }]}
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="advanced-prompt-prefix">
                画面提示词前缀
              </FieldLabel>
              <Textarea
                className="min-h-20 resize-y"
                id="advanced-prompt-prefix"
                onChange={(event) =>
                  patchAdvanced({ promptPrefix: event.target.value })
                }
                placeholder="可选，例如：温暖自然光、真实宠物生活方式、竖屏构图"
                value={advancedSettings.promptPrefix}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="advanced-visual-context">
                画面视觉上下文
              </FieldLabel>
              <Textarea
                className="min-h-20 resize-y"
                id="advanced-visual-context"
                onChange={(event) =>
                  patchAdvanced({
                    imagePromptVisualContext: event.target.value,
                  })
                }
                placeholder="可选，例如品牌视觉、宠物品种、场景约束。"
                value={advancedSettings.imagePromptVisualContext}
              />
            </Field>
          </div>

          {expertMode && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-medium">媒体工作流预览</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    生成一张示例图片或一段短视频；会调用生成服务并消耗额度。
                  </p>
                </div>
                <Button
                  disabled={
                    mediaType === "static" ||
                    !mediaPreviewPrompt ||
                    isPreviewingMedia
                  }
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

              <Field className="mt-4">
                <FieldLabel htmlFor="advanced-media-preview-prompt">
                  预览提示词
                </FieldLabel>
                <Textarea
                  className="min-h-20 resize-y bg-background"
                  id="advanced-media-preview-prompt"
                  onChange={(event) =>
                    patchAdvanced({ mediaPreviewPrompt: event.target.value })
                  }
                  placeholder={defaultMediaPreviewPrompt(mediaType)}
                  value={advancedSettings.mediaPreviewPrompt}
                />
              </Field>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Fact label="媒体类型" value={mediaType} />
                <Fact
                  label="媒体尺寸"
                  value={`${advancedSettings.mediaWidth} x ${advancedSettings.mediaHeight}`}
                />
              </div>

              {mediaType === "video" && (
                <Field className="mt-3">
                  <FieldLabel htmlFor="advanced-media-duration">
                    预览视频时长
                  </FieldLabel>
                  <Input
                    id="advanced-media-duration"
                    max={20}
                    min={1}
                    onChange={(event) =>
                      patchAdvanced({
                        mediaDuration: Number(event.target.value || 4),
                      })
                    }
                    type="number"
                    value={advancedSettings.mediaDuration}
                  />
                </Field>
              )}

              {mediaPreviewError && (
                <InlineError title="媒体预览失败" message={mediaPreviewError} />
              )}
              {mediaPreview && (
                <div className="mt-4 flex flex-col gap-3">
                  {mediaPreviewUrl ? (
                    mediaPreview.media_type === "video" ? (
                      <video
                        className="aspect-[9/16] max-h-[420px] rounded-lg border bg-background object-contain"
                        controls
                        src={mediaPreviewUrl}
                      />
                    ) : (
                      <img
                        alt="媒体工作流预览"
                        className="aspect-[9/16] max-h-[420px] rounded-lg border bg-background object-contain"
                        src={mediaPreviewUrl}
                      />
                    )
                  ) : (
                    <InlineError
                      title="媒体不可预览"
                      message="媒体已生成，但当前无法在浏览器中显示。"
                    />
                  )}
                  <TechDetails
                    items={[{ label: "媒体路径", value: mediaPreview.media_path }]}
                  />
                </div>
              )}
            </div>
          )}
        </AdvancedGroup>
        )}

        {/* 图文/长文无配音；仅视频保留声音与音乐 */}
        {!isNonVideo && (
        <AdvancedGroup
          description="声音试听、语速与背景音乐"
          id="audio"
          title="声音与音乐"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {/* 配音引擎决定音色 ID 的取值方式，常驻显示（2026-07-08 用户反馈，移出专家门控） */}
            <Field>
              <FieldLabel>配音引擎</FieldLabel>
              <Select
                onValueChange={(value) =>
                  patchAdvanced({
                    ttsInferenceMode:
                      value as StandardAdvancedSettings["ttsInferenceMode"],
                  })
                }
                value={advancedSettings.ttsInferenceMode}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">本地 / Edge Voice</SelectItem>
                  <SelectItem value="comfyui">ComfyUI workflow</SelectItem>
                  <SelectItem value="fish">Fish Audio</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="advanced-tts-voice">
                声音或 Reference ID
              </FieldLabel>
              <Input
                id="advanced-tts-voice"
                onChange={(event) =>
                  patchAdvanced({ ttsVoice: event.target.value })
                }
                value={advancedSettings.ttsVoice}
              />
            </Field>

            {expertMode && (
              <Field>
                <FieldLabel>TTS workflow</FieldLabel>
                <Select
                  onValueChange={(value) =>
                    patchAdvanced({
                      ttsWorkflow: value === "__default__" ? "" : value,
                    })
                  }
                  value={advancedSettings.ttsWorkflow || "__default__"}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">使用模板默认</SelectItem>
                    {resources.ttsWorkflows.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>专家模式覆盖项。</FieldDescription>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="advanced-tts-speed">
                语速 · {advancedSettings.ttsSpeed.toFixed(1)}x
              </FieldLabel>
              <Slider
                id="advanced-tts-speed"
                max={2}
                min={0.5}
                onValueChange={([value]) =>
                  patchAdvanced({ ttsSpeed: value ?? 1 })
                }
                step={0.1}
                value={[advancedSettings.ttsSpeed]}
              />
            </Field>
          </div>

          {expertMode && advancedSettings.ttsInferenceMode === "comfyui" && (
            <Field>
              <FieldLabel htmlFor="advanced-ref-audio">Reference audio</FieldLabel>
              <input
                accept="audio/mpeg,audio/wav,audio/flac,audio/mp4,audio/aac,audio/ogg,.mp3,.wav,.flac,.m4a,.aac,.ogg"
                className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
                disabled={isUploadingRefAudio}
                id="advanced-ref-audio"
                onChange={(event) =>
                  void uploadRefAudio(event.currentTarget.files?.[0] ?? null)
                }
                type="file"
              />
              <FieldDescription>
                用于 ComfyUI voice cloning，试听和正式生成都会使用。
              </FieldDescription>
              {isUploadingRefAudio && (
                <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                  正在上传参考音频
                </div>
              )}
              {advancedSettings.ttsRefAudioPath && (
                <TechDetails
                  items={[
                    {
                      label: advancedSettings.ttsRefAudioName || "参考音频",
                      value: advancedSettings.ttsRefAudioPath,
                    },
                  ]}
                />
              )}
              {refAudioUploadError && (
                <InlineError
                  title="参考音频上传失败"
                  message={refAudioUploadError}
                />
              )}
            </Field>
          )}

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-sm font-medium">试听</div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  用当前声音设置合成一小段试听音频。
                </p>
              </div>
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
                试听声音
              </Button>
            </div>
            {ttsPreviewError && (
              <InlineError title="试听失败" message={ttsPreviewError} />
            )}
            {ttsPreview && (
              <div className="mt-4 flex flex-col gap-3">
                {ttsPreviewUrl ? (
                  <audio className="w-full" controls src={ttsPreviewUrl} />
                ) : (
                  <InlineError
                    title="音频不可播放"
                    message="音频已合成，但当前无法在浏览器中播放。"
                  />
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Fact label="音频时长" value={formatDuration(ttsPreview.duration)} />
                  <Fact label="声音" value={advancedSettings.ttsVoice || "默认"} />
                </div>
                <TechDetails
                  items={[{ label: "音频路径", value: ttsPreview.audio_path }]}
                />
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Field>
              <FieldLabel>背景音乐</FieldLabel>
              <Select
                onValueChange={(value) =>
                  patchAdvanced({ bgmPath: value === "__none__" ? "" : value })
                }
                value={advancedSettings.bgmPath || "__none__"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">不指定 BGM</SelectItem>
                  {resources.bgm.map((item) => (
                    <SelectItem key={item.path} value={item.path}>
                      {item.name} · {item.source}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <BgmUploadControl
              onUploaded={(bgm) => {
                onBgmUploaded(bgm)
                patchAdvanced({ bgmPath: bgm.path })
              }}
            />

            <Field>
              <FieldLabel htmlFor="advanced-bgm-volume">
                BGM 音量 · {Math.round(advancedSettings.bgmVolume * 100)}%
              </FieldLabel>
              <Slider
                id="advanced-bgm-volume"
                max={1}
                min={0}
                onValueChange={([value]) =>
                  patchAdvanced({ bgmVolume: value ?? 0 })
                }
                step={0.05}
                value={[advancedSettings.bgmVolume]}
              />
            </Field>

            <Field>
              <FieldLabel>BGM 模式</FieldLabel>
              <ToggleGroup
                onValueChange={(value) => {
                  if (value) {
                    patchAdvanced({
                      bgmMode: value as StandardAdvancedSettings["bgmMode"],
                    })
                  }
                }}
                type="single"
                value={advancedSettings.bgmMode}
                variant="outline"
              >
                <ToggleGroupItem value="loop">循环</ToggleGroupItem>
                <ToggleGroupItem value="once">播放一次</ToggleGroupItem>
              </ToggleGroup>
            </Field>
          </div>

          {bgmPreviewUrl && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="text-sm font-medium">BGM 预览</div>
              <audio className="mt-3 w-full" controls src={bgmPreviewUrl} />
            </div>
          )}
        </AdvancedGroup>
        )}
      </div>
    </FieldGroup>
  )
}

function AssetInput({
  assetFiles,
  uploadedAssets,
  assetTitle,
  assetIntent,
  assetDuration,
  assetAdvancedSettings,
  resources,
  resourcesError,
  onAssetFilesChange,
  onAssetTitleChange,
  onAssetIntentChange,
  onAssetDurationChange,
  onAssetAdvancedSettingsChange,
  onBgmUploaded,
}: {
  assetFiles: File[]
  uploadedAssets: UploadedGenerationAsset[]
  assetTitle: string
  assetIntent: string
  assetDuration: number
  assetAdvancedSettings: AssetAdvancedSettings
  resources: GenerationResources
  resourcesError: string | null
  onAssetFilesChange: (files: File[]) => void
  onAssetTitleChange: (value: string) => void
  onAssetIntentChange: (value: string) => void
  onAssetDurationChange: (value: number) => void
  onAssetAdvancedSettingsChange: (value: AssetAdvancedSettings) => void
  onBgmUploaded: (bgm: ResourceBgm) => void
}) {
  const bgmPreviewUrl = resourceFileUrl(assetAdvancedSettings.bgmPath)

  function patchAssetAdvanced(patch: Partial<AssetAdvancedSettings>) {
    onAssetAdvancedSettingsChange({ ...assetAdvancedSettings, ...patch })
  }

  return (
    <FieldGroup>
      <Field data-invalid={assetFiles.length === 0}>
        <FieldLabel htmlFor="assets">图片或视频素材</FieldLabel>
        <FileDropzone
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
          files={assetFiles}
          hint="支持图片和视频，可多选"
          id="assets"
          onFilesChange={onAssetFilesChange}
        />
        <FieldDescription>
          提交时会先上传素材，再开始生成。
        </FieldDescription>
      </Field>

      {uploadedAssets.length > 0 && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
          已上传 {uploadedAssets.length} 个素材，并提交给当前生成任务。
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
        <Field>
          <FieldLabel htmlFor="asset-title">视频标题</FieldLabel>
          <input
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            id="asset-title"
            onChange={(event) => onAssetTitleChange(event.target.value)}
            placeholder="可选，例如：猫咪玩具日常"
            value={assetTitle}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="asset-duration">目标时长</FieldLabel>
          <input
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
            id="asset-duration"
            max={120}
            min={15}
            onChange={(event) =>
              onAssetDurationChange(Number(event.target.value || 30))
            }
            step={5}
            type="number"
            value={assetDuration}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="asset-intent">制作目标</FieldLabel>
        <Textarea
          className="min-h-28 resize-y leading-6"
          id="asset-intent"
          onChange={(event) => onAssetIntentChange(event.target.value)}
          value={assetIntent}
        />
        <FieldDescription>
          这段说明用于帮助后端组织素材、生成旁白和镜头顺序，不是 provider 设置。
        </FieldDescription>
      </Field>

      <details className="rounded-lg border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          素材生成高级设置
        </summary>
        <div className="border-t p-4">
          {resourcesError && (
            <InlineError title="资源读取失败" message={resourcesError} />
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="asset-bgm">背景音乐</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="asset-bgm"
                onChange={(event) =>
                  patchAssetAdvanced({ bgmPath: event.target.value })
                }
                value={assetAdvancedSettings.bgmPath}
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
              <FieldLabel htmlFor="asset-bgm-mode">BGM 模式</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="asset-bgm-mode"
                onChange={(event) =>
                  patchAssetAdvanced({
                    bgmMode: event.target.value as AssetAdvancedSettings["bgmMode"],
                  })
                }
                value={assetAdvancedSettings.bgmMode}
              >
                <option value="loop">循环</option>
                <option value="once">播放一次</option>
              </select>
            </Field>

            <BgmUploadControl
              onUploaded={(bgm) => {
                onBgmUploaded(bgm)
                patchAssetAdvanced({ bgmPath: bgm.path })
              }}
            />

            <Field>
              <FieldLabel htmlFor="asset-bgm-volume">BGM 音量</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="asset-bgm-volume"
                max={1}
                min={0}
                onChange={(event) =>
                  patchAssetAdvanced({
                    bgmVolume: Number(event.target.value || 0),
                  })
                }
                step={0.05}
                type="number"
                value={assetAdvancedSettings.bgmVolume}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="asset-voice">声音</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="asset-voice"
                onChange={(event) =>
                  patchAssetAdvanced({ voiceId: event.target.value })
                }
                value={assetAdvancedSettings.voiceId}
              />
              <FieldDescription>
                对应旧 Streamlit 素材生成里的 voice 选择；source/provider 继续固定在模板里。
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="asset-tts-speed">语速</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="asset-tts-speed"
                max={2}
                min={0.5}
                onChange={(event) =>
                  patchAssetAdvanced({
                    ttsSpeed: Number(event.target.value || 1.2),
                  })
                }
                step={0.1}
                type="number"
                value={assetAdvancedSettings.ttsSpeed}
              />
            </Field>
          </div>
          {bgmPreviewUrl && (
            <div className="mt-4 rounded-lg border bg-muted/30 p-4">
              <div className="text-sm font-medium">BGM 预览</div>
              <audio className="mt-3 w-full" controls src={bgmPreviewUrl} />
            </div>
          )}
        </div>
      </details>
    </FieldGroup>
  )
}

function TaskPanel({
  isCancellingTask,
  onCancelTask,
  task,
  result,
  template,
  taskActionError,
}: {
  isCancellingTask: boolean
  onCancelTask: () => void
  task: GenerationTask | null
  result: GenerationResult | null
  template: ProductionTemplate | null
  taskActionError: string | null
}) {
  const toast = useToast()
  const videoUrl = artifactFileUrl(result?.primary_video)
  const isImageSet = result?.artifact_type === "image_set"
  const isText = result?.artifact_type === "text"
  const articleText =
    isText && typeof result?.metadata?.article === "string"
      ? result.metadata.article
      : ""
  const imageSetItems =
    isImageSet && result
      ? result.artifacts
          .filter((artifact) => artifact.kind === "image")
          .map((artifact, index) => ({
            url: artifactFileUrl(artifact) ?? "",
            label: imageSetLabel(index, artifact.role),
          }))
          .filter((item) => item.url)
      : []
  const qualitySummary = buildQualitySummary(
    result?.metadata?.quality_review as QualityReviewInput | undefined
  )
  const progressRuntimeItems = buildProgressRuntimeItems(task?.progress.detail)
  const assetManifest = result?.metadata
    ?.asset_manifest as AssetManifestInput | undefined
  const assetItems = buildAssetItems(assetManifest)
  const assetCount = assetManifest?.assets?.length ?? assetItems.length

  return (
    <aside className="flex flex-col gap-5">
      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>任务状态</CardTitle>
          <CardDescription>
            提交后在这里跟踪进度；失败时会显示原因。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!task && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              提交后这里会显示生成进度。
            </div>
          )}

          {task && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3">
                <StatusBadge status={task.status} />
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    aria-label="复制任务 ID"
                    onClick={() => {
                      void navigator.clipboard?.writeText(task.task_id)
                      toast({ title: "任务 ID 已复制", variant: "success" })
                    }}
                    size="icon-sm"
                    type="button"
                    variant="outline"
                  >
                    <Copy />
                  </Button>
                  {!isTerminalStatus(task.status) && (
                    <Button
                      disabled={isCancellingTask}
                      onClick={onCancelTask}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {isCancellingTask && <Loader2 className="animate-spin" />}
                      取消任务
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">
                    {task.progress.message || task.progress.stage}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(task.progress.percentage)}%
                  </span>
                </div>
                <Progress className="mt-3" value={task.progress.percentage} />
                {progressRuntimeItems.length > 0 && (
                  <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
                    {progressRuntimeItems.map((item) => (
                      <Fact key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>
                )}
              </div>

              {task.status === "failed" && task.error && (
                <InlineError
                  title="任务失败"
                  message={`${task.error.message}${
                    template?.failure_guidance
                      ? ` ${template.failure_guidance}`
                      : ""
                  }`}
                />
              )}

              <TechDetails
                items={[
                  { label: "任务 ID", value: task.task_id },
                  { label: "生成链路", value: task.pipeline_id },
                  { label: "输入类型", value: task.entry },
                  { label: "当前阶段", value: task.progress.stage },
                  {
                    label: "失败层级",
                    value: task.status === "failed" ? task.error?.layer : null,
                  },
                ]}
              />
            </div>
          )}

          {taskActionError && (
            <InlineError title="任务操作失败" message={taskActionError} />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>生成结果</CardTitle>
          <CardDescription>
            任务完成后自动展示成片和关键信息。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!result && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              完成后这里会显示成片预览。
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-4">
              {isText ? (
                <TextArticleView
                  article={articleText}
                  title={
                    typeof result.metadata?.title === "string"
                      ? result.metadata.title
                      : null
                  }
                />
              ) : isImageSet ? (
                <ImageSetView
                  caption={
                    typeof result.metadata?.caption === "string"
                      ? result.metadata.caption
                      : null
                  }
                  items={imageSetItems}
                />
              ) : videoUrl ? (
                <video
                  className="aspect-[9/16] max-h-[520px] rounded-lg border bg-black"
                  controls
                  src={videoUrl}
                />
              ) : (
                <InlineError
                  title="结果视频不可预览"
                  message="成片已生成，但当前无法在浏览器中预览。"
                />
              )}

              <Button
                onClick={() => navigate(`/library?task=${result.task_id}`)}
                size="lg"
              >
                <Send data-icon="inline-start" />
                前往发布
              </Button>

              <div className="grid gap-3 sm:grid-cols-2">
                <Fact
                  label="生产模板"
                  value={productionTemplateLabel(result, template)}
                />
                <Fact label="时长" value={formatDuration(result.duration)} />
                <Fact label="文件大小" value={formatBytes(result.file_size)} />
                <Fact
                  label="发布判断"
                  value={qualitySummary.label}
                />
                <Fact
                  label="素材记录"
                  value={assetCount ? `${assetCount} 项` : "未返回"}
                />
              </div>

              <Separator />

              <div className="rounded-lg border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">质量检查</div>
                  <QualityBadge tone={qualitySummary.tone} label={qualitySummary.label} />
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {qualitySummary.summary}
                </p>
                <QualityMessages
                  failures={qualitySummary.failures}
                  warnings={qualitySummary.warnings}
                />
              </div>

              <div className="rounded-lg border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">素材清单</div>
                  <Badge variant="outline">
                    {assetCount ? `${assetCount} 项` : "未返回"}
                  </Badge>
                </div>
                {assetItems.length > 0 ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {assetItems.map((asset, index) => (
                      <div
                        className="rounded-lg bg-muted/40 p-3"
                        key={`${asset.label}-${index}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">{asset.label}</div>
                          <Badge
                            variant={
                              asset.statusLabel === "缺失"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {asset.statusLabel}
                          </Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {asset.kind}
                        </div>
                        <div className="mt-2 line-clamp-2 break-all font-mono text-xs text-muted-foreground">
                          {asset.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                    后端没有返回素材清单。
                  </div>
                )}
              </div>

              <Separator />

              <TechDetails
                items={[
                  {
                    label: isText
                      ? "长文字数"
                      : isImageSet
                        ? "图集封面"
                        : "成片路径",
                    value: isText
                      ? `${articleText.length} 字`
                      : (result.primary_video?.path ??
                        imageSetItems[0]?.url ??
                        "（图集）"),
                  },
                ]}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </aside>
  )
}

function previewCopy(
  inputKind: "script" | "topic",
  text: string,
  title: string
) {
  const cleaned = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
  const source =
    inputKind === "topic"
      ? [title.trim(), cleaned].filter(Boolean).join("：")
      : cleaned
  return source.slice(0, 180)
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
  if (mediaType === "video") {
    return "a dog running in a sunny park, natural handheld vertical video"
  }
  if (mediaType === "static") {
    return ""
  }
  return "a dog drinking clean water at home, warm natural light"
}

function buildMediaPrompt(prompt: string, prefix: string) {
  const cleanedPrompt = prompt.trim()
  const cleanedPrefix = prefix.trim()
  if (cleanedPrompt && cleanedPrefix) {
    return `${cleanedPrefix}, ${cleanedPrompt}`
  }
  return cleanedPrefix || cleanedPrompt
}

function BgmUploadControl({
  onUploaded,
}: {
  onUploaded: (bgm: ResourceBgm) => void
}) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function uploadBgm(file: File | null) {
    setUploadError(null)
    if (!file) {
      return
    }

    setIsUploading(true)
    try {
      const response = await uploadResourceBgm(file)
      onUploaded(response.bgm_file)
    } catch (error) {
      setUploadError(readableError(error))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Field>
      <FieldLabel htmlFor="bgm-upload">上传 BGM</FieldLabel>
      <input
        accept="audio/mpeg,audio/wav,audio/flac,audio/mp4,audio/aac,audio/ogg,.mp3,.wav,.flac,.m4a,.aac,.ogg"
        className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
        disabled={isUploading}
        id="bgm-upload"
        onChange={(event) => void uploadBgm(event.currentTarget.files?.[0] ?? null)}
        type="file"
      />
      <FieldDescription>
        上传后保存到自定义 BGM 资源，并自动用于当前生成设置。
      </FieldDescription>
      {isUploading && (
        <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" data-icon="inline-start" />
          正在上传 BGM
        </div>
      )}
      {uploadError && <InlineError title="BGM 上传失败" message={uploadError} />}
    </Field>
  )
}

function mediaPreviewFileUrl(path: string | null | undefined) {
  if (!path) {
    return null
  }
  if (/^https?:\/\//.test(path)) {
    return path
  }
  return fileUrlFromPath(path)
}

function templateParamDefaultValues(response: TemplateParamsResponse) {
  return Object.fromEntries(
    Object.entries(response.params).map(([name, config]) => [
      name,
      normalizeTemplateParamValue(config.type, config.default),
    ])
  ) as Record<string, TemplateParamValue>
}

function normalizeTemplateParamValue(
  type: string,
  value: unknown
): TemplateParamValue {
  if (type === "bool") {
    return value === true || value === "true"
  }
  if (type === "number") {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : 0
  }
  if (type === "color") {
    const color = String(value ?? "").trim()
    return color || "#000000"
  }
  return String(value ?? "")
}

function sameTemplateParams(
  left: Record<string, TemplateParamValue>,
  right: Record<string, TemplateParamValue>
) {
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  if (leftEntries.length !== rightEntries.length) {
    return false
  }
  return leftEntries.every(([key, value]) => right[key] === value)
}

function formatTemplateParamDefault(value: unknown) {
  if (value === "" || value == null) {
    return "空"
  }
  return String(value)
}

function BatchScriptInput({
  text,
  label,
  hint,
  items,
  artifactKind,
  onTextChange,
  onRemoveItem,
}: {
  text: string
  label: string
  hint: string
  items: ParsedScriptItem[]
  artifactKind: ArtifactKind
  onTextChange?: (value: string) => void
  onRemoveItem?: (index: number) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="batch-text">{label}</FieldLabel>
        <Textarea
          className="min-h-64 resize-y text-base leading-7"
          id="batch-text"
          onChange={(event) => onTextChange?.(event.target.value)}
          placeholder={
            "第一条标题\n第一条完整文案...\n\n---\n\n第二条标题\n第二条完整文案..."
          }
          value={text}
        />
        <FieldDescription>{hint}</FieldDescription>
      </Field>
      {items.length > 0 ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">解析预览 · {items.length} 条</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {items.map((item, index) => {
              const itemTitle = getBatchPreviewTitle(item.input, index)
              const chars = getBatchPreviewBody(item.input).length
              const lines = getBatchPreviewLineCount(item.input)
              const meta =
                artifactKind === "text"
                  ? `素材 ${chars} 字`
                  : artifactKind === "image_set"
                    ? `${chars} 字 · ${lines} 行`
                    : `${chars} 字`
              return (
                <div
                  className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2 text-sm"
                  key={`${index}-${itemTitle}`}
                >
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{itemTitle}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {meta}
                  </span>
                  <Button
                    aria-label={`移除第 ${index + 1} 条`}
                    onClick={() => onRemoveItem?.(index)}
                    size="icon-xs"
                    type="button"
                    variant="ghost"
                  >
                    <X />
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          在上面粘贴多条内容，这里会实时显示解析出的条目。
        </div>
      )}
    </div>
  )
}

function buildStandardTemplateInput({
  template,
  script,
  topic,
  advancedSettings,
}: {
  template: ProductionTemplate
  script: string
  topic: string
  advancedSettings: StandardAdvancedSettings
}) {
  const baseInput = template.input_requirements.includes("topic")
    ? { topic }
    : { script }

  return compactRecord({
    ...baseInput,
    title: advancedSettings.title.trim(),
    n_scenes: template.input_requirements.includes("topic")
      ? advancedSettings.nScenes
      : undefined,
    split_mode: template.input_requirements.includes("script")
      ? advancedSettings.splitMode
      : undefined,
    frame_template: advancedSettings.frameTemplate,
    template_params:
      Object.keys(advancedSettings.templateParams).length > 0
        ? advancedSettings.templateParams
        : undefined,
    media_workflow: advancedSettings.mediaWorkflow,
    media_width: advancedSettings.mediaWidth,
    media_height: advancedSettings.mediaHeight,
    prompt_prefix: advancedSettings.promptPrefix.trim(),
    image_prompt_visual_context:
      advancedSettings.imagePromptVisualContext.trim(),
    image_prompt_generation_rules:
      advancedSettings.imagePromptGenerationRules.trim(),
    bgm_path: advancedSettings.bgmPath,
    bgm_volume: advancedSettings.bgmVolume,
    bgm_mode: advancedSettings.bgmMode,
    tts_inference_mode: advancedSettings.ttsInferenceMode,
    tts_voice: advancedSettings.ttsVoice.trim(),
    tts_workflow: advancedSettings.ttsWorkflow,
    tts_speed: advancedSettings.ttsSpeed,
    ref_audio:
      advancedSettings.ttsInferenceMode === "comfyui"
        ? advancedSettings.ttsRefAudioPath
        : undefined,
  })
}

function compactRecord(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== "" && value != null)
  )
}

function QualityBadge({
  tone,
  label,
}: {
  tone: ReturnType<typeof buildQualitySummary>["tone"]
  label: string
}) {
  if (tone === "failed") {
    return <Badge variant="destructive">{label}</Badge>
  }
  if (tone === "warning" || tone === "missing") {
    return <Badge variant="outline">{label}</Badge>
  }
  return <Badge variant="secondary">{label}</Badge>
}

function QualityMessages({
  failures,
  warnings,
}: {
  failures: string[]
  warnings: string[]
}) {
  const messages = [
    ...failures.map((message) => ({ tone: "failed", message })),
    ...warnings.map((message) => ({ tone: "warning", message })),
  ]

  if (messages.length === 0) {
    return null
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {messages.map((item, index) => (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm leading-6",
            item.tone === "failed"
              ? "bg-destructive/10 text-destructive"
              : "bg-muted/60 text-muted-foreground"
          )}
          key={`${item.tone}-${index}`}
        >
          {item.message}
        </div>
      ))}
    </div>
  )
}


function productionTemplateLabel(
  result: GenerationResult,
  fallbackTemplate: ProductionTemplate | null
) {
  const metadataTemplate = result.metadata.production_template
  if (
    metadataTemplate &&
    typeof metadataTemplate === "object" &&
    "name" in metadataTemplate
  ) {
    const name = String((metadataTemplate as { name?: unknown }).name ?? "")
    const version = String((metadataTemplate as { version?: unknown }).version ?? "")
    return [name, version].filter(Boolean).join(" · ") || "未返回"
  }

  return fallbackTemplate
    ? `${fallbackTemplate.display_name} · ${fallbackTemplate.version}`
    : "未返回"
}
