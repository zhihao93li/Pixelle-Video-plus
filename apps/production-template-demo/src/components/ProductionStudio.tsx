import { useEffect, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Copy,
  FileText,
  HelpCircle,
  History,
  ImageIcon,
  Layers3,
  Loader2,
  Play,
  RefreshCcw,
  Sparkles,
  Settings,
  UploadCloud,
  Video,
  Volume2,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { BatchWorkspace } from "@/components/BatchWorkspace"
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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import { HistoryWorkspace } from "@/components/HistoryWorkspace"
import { HelpWorkspace } from "@/components/HelpWorkspace"
import { ScriptReviewWorkspace } from "@/components/ScriptReviewWorkspace"
import { SettingsWorkspace } from "@/components/SettingsWorkspace"
import {
  SpecialPipelinesWorkspace,
  type SpecialPipelineMode,
} from "@/components/SpecialPipelinesWorkspace"
import {
  ApiError,
  artifactFileUrl,
  cancelGenerationTask,
  createGenerationTemplateTask,
  fileUrlFromPath,
  generateMediaPreview,
  getFrameTemplateParams,
  getTask,
  getTaskResult,
  isTerminalStatus,
  listGenerationProjects,
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
  updateProjectGenerationSettings,
  type FramePreviewResponse,
  type GenerationProject,
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

const DAILY_TEMPLATE_ID = "petwoods_xhs_daily_v1"
const sampleScript =
  "母猫配完以后还一直叫，不一定说明没有配上。发情期的激素变化不会马上停止，所以它可能还会持续叫几天。真正判断有没有配上，要看后续有没有再次发情、精神食欲是否正常，以及是否需要在合适时间做检查。"

type LoadState = "loading" | "ready" | "error"
type ActiveView =
  | "generate"
  | "scriptReview"
  | "special"
  | "batch"
  | "history"
  | "templates"
  | "settings"
  | "help"

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

export function ProductionStudio() {
  const [activeView, setActiveView] = useState<ActiveView>("generate")
  const [specialMode, setSpecialMode] =
    useState<SpecialPipelineMode>("image_to_video")
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [projects, setProjects] = useState<GenerationProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null)
  const [template, setTemplate] = useState<ProductionTemplate | null>(null)
  const [script, setScript] = useState(sampleScript)
  const [topic, setTopic] = useState("猫咪夏天饮水少，主人应该怎么判断和处理")
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
  const [task, setTask] = useState<GenerationTask | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCancellingTask, setIsCancellingTask] = useState(false)
  const [taskActionError, setTaskActionError] = useState<string | null>(null)
  const [isSavingDefault, setIsSavingDefault] = useState(false)

  const trimmedScript = script.trim()
  const trimmedTopic = topic.trim()
  const trimmedAssetTitle = assetTitle.trim()
  const trimmedAssetIntent = assetIntent.trim()
  const templateNeedsAssets = Boolean(
    template?.requires_user_assets || template?.input_requirements.includes("assets")
  )
  const templateNeedsTopic = Boolean(template?.input_requirements.includes("topic"))
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

  useEffect(() => {
    let cancelled = false

    async function loadTemplates() {
      setLoadState("loading")
      setTemplatesError(null)
      setSettingsError(null)
      try {
        const [templatesResult, projectsResult] = await Promise.allSettled([
          listTemplates(),
          listGenerationProjects(),
        ])
        if (cancelled) {
          return
        }

        if (templatesResult.status === "rejected") {
          throw templatesResult.reason
        }

        const response = templatesResult.value
        let projectDefaultTemplateId: string | null = null
        if (projectsResult.status === "fulfilled") {
          const loadedProjects = projectsResult.value.projects
          const firstProject = loadedProjects[0] ?? null
          setProjects(loadedProjects)
          setSelectedProjectId(firstProject?.id ?? null)
          projectDefaultTemplateId =
            firstProject?.generation_settings?.default_production_template_id ??
            null
        } else {
          setSettingsError(readableError(projectsResult.reason))
        }

        const defaultId =
          projectDefaultTemplateId || response.default_template || DAILY_TEMPLATE_ID
        const selected =
          response.templates.find((item) => item.id === defaultId) ??
          response.templates.find((item) => item.id === DAILY_TEMPLATE_ID) ??
          null

        if (!selected) {
          setLoadState("error")
          setTemplatesError("没有找到可用于 P0 的日常生成模板。")
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
  }, [])

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

  useEffect(() => {
    if (!task || isTerminalStatus(task.status)) {
      return undefined
    }

    let cancelled = false
    const interval = window.setInterval(async () => {
      try {
        const latestTask = await getTask(task.task_id)
        if (cancelled) {
          return
        }
        setTask(latestTask)
        setPollError(null)
      } catch (error) {
        if (cancelled) {
          return
        }
        setPollError(readableError(error))
      }
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [task])

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
          setPollError(null)
        }
      } catch (error) {
        if (!cancelled) {
          setPollError(readableError(error))
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
    setPollError(null)
    setTaskActionError(null)
    setTask(null)
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
          }
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
          }
        )
      }
      setTask(response.task)
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  function selectProject(projectId: string) {
    setSelectedProjectId(projectId)
    setSettingsNotice(null)
    const project = projects.find((item) => item.id === projectId)
    const projectTemplateId =
      project?.generation_settings?.default_production_template_id
    const projectTemplate = templates.find((item) => item.id === projectTemplateId)
    if (projectTemplate) {
      setTemplate(projectTemplate)
    }
  }

  async function saveDefaultTemplate() {
    if (!selectedProjectId || !template) {
      return
    }

    setIsSavingDefault(true)
    setSettingsError(null)
    setSettingsNotice(null)
    try {
      const response = await updateProjectGenerationSettings(
        selectedProjectId,
        template.id
      )
      setProjects((current) =>
        current.map((project) =>
          project.id === selectedProjectId
            ? {
                ...project,
                generation_settings: response.generation_settings,
              }
            : project
        )
      )
      setSettingsNotice("默认生产线已保存。")
    } catch (error) {
      setSettingsError(readableError(error))
    } finally {
      setIsSavingDefault(false)
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
      setTask(latest)
      setPollError(null)
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

  function selectTemplateOrRoute(nextTemplate: ProductionTemplate) {
    if (isSpecialProductEntry(nextTemplate.product_entry)) {
      setSpecialMode(nextTemplate.product_entry)
      setActiveView("special")
      return
    }
    if (nextTemplate.product_entry === "script_review") {
      setActiveView("scriptReview")
      return
    }
    if (nextTemplate.product_entry === "batch") {
      setActiveView("batch")
      return
    }
    setTemplate(nextTemplate)
    setActiveView("generate")
  }

  return (
    <TooltipProvider>
      <div className="min-h-svh bg-muted/30 text-foreground">
        <header className="border-b bg-background px-4 py-4 lg:px-6">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Video className="size-4" />
                Pixelle 生产模板
              </div>
              <h1 className="mt-1 text-2xl font-semibold">
                {activeView === "generate"
                  ? templateNeedsAssets
                    ? "用素材生成视频"
                    : templateNeedsTopic
                      ? "用选题生成视频"
                      : "用已确认文案生成视频"
                  : activeView === "history"
                    ? "历史视频与发布准备"
                    : activeView === "scriptReview"
                      ? "文案审核后生成"
                    : activeView === "special"
                      ? "特殊视频生成"
                    : activeView === "batch"
                      ? "批量生产"
                      : activeView === "templates"
                      ? "模板与迁移状态"
                    : activeView === "settings"
                      ? "系统设置"
                      : "帮助"}
              </h1>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">真实后端生成</Badge>
                <Badge variant="outline">不选择 provider</Badge>
              </div>
              <div className="flex rounded-lg border bg-muted/40 p-1">
                <Button
                  onClick={() => setActiveView("generate")}
                  size="sm"
                  variant={activeView === "generate" ? "default" : "ghost"}
                >
                  <Play data-icon="inline-start" />
                  生成视频
                </Button>
                <Button
                  onClick={() => setActiveView("history")}
                  size="sm"
                  variant={activeView === "history" ? "default" : "ghost"}
                >
                  <History data-icon="inline-start" />
                  历史与发布
                </Button>
                <Button
                  onClick={() => setActiveView("scriptReview")}
                  size="sm"
                  variant={activeView === "scriptReview" ? "default" : "ghost"}
                >
                  <ClipboardCheck data-icon="inline-start" />
                  文案审核
                </Button>
                <Button
                  onClick={() => setActiveView("special")}
                  size="sm"
                  variant={activeView === "special" ? "default" : "ghost"}
                >
                  <Sparkles data-icon="inline-start" />
                  特殊生成
                </Button>
                <Button
                  onClick={() => setActiveView("batch")}
                  size="sm"
                  variant={activeView === "batch" ? "default" : "ghost"}
                >
                  <Layers3 data-icon="inline-start" />
                  批量生产
                </Button>
                <Button
                  onClick={() => setActiveView("templates")}
                  size="sm"
                  variant={activeView === "templates" ? "default" : "ghost"}
                >
                  <FileText data-icon="inline-start" />
                  模板状态
                </Button>
                <Button
                  onClick={() => setActiveView("settings")}
                  size="sm"
                  variant={activeView === "settings" ? "default" : "ghost"}
                >
                  <Settings data-icon="inline-start" />
                  设置
                </Button>
                <Button
                  onClick={() => setActiveView("help")}
                  size="sm"
                  variant={activeView === "help" ? "default" : "ghost"}
                >
                  <HelpCircle data-icon="inline-start" />
                  帮助
                </Button>
              </div>
            </div>
          </div>
        </header>

        {activeView === "generate" ? (
          <main className="mx-auto grid max-w-[1240px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6">
            <section className="flex min-w-0 flex-col gap-5">
              <TemplateCard
              error={templatesError}
              isSavingDefault={isSavingDefault}
              loadState={loadState}
              onReload={() => window.location.reload()}
              onSaveDefault={() => void saveDefaultTemplate()}
              onSelect={selectTemplateOrRoute}
              onSelectProject={selectProject}
              projects={projects}
              selectedProjectId={selectedProjectId}
              settingsError={settingsError}
              settingsNotice={settingsNotice}
              template={template}
              templateCanSubmit={templateCanSubmit}
              templates={templates}
            />

              <Card className="rounded-lg">
                <CardHeader className="border-b">
                  <CardTitle>
                    {templateNeedsAssets
                      ? "1. 上传素材"
                      : templateNeedsTopic
                        ? "1. 输入选题"
                        : "1. 填入已确认文案"}
                  </CardTitle>
                  <CardDescription>
                    {templateNeedsAssets
                      ? "这些素材会作为真实输入进入当前素材生产线，不会使用 mock 素材。"
                      : templateNeedsTopic
                        ? "后端会基于选题生成脚本，再进入同一个标准视频 pipeline。"
                        : "这里不会生成选题，也不会重写文案。提交后会直接进入当前视频模板。"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
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
                      text={topic}
                    />
                  ) : (
                    <StandardInput
                      advancedSettings={advancedSettings}
                      inputKind="script"
                      onBgmUploaded={addBgmResource}
                      onAdvancedSettingsChange={setAdvancedSettings}
                      onTextChange={setScript}
                      resources={resources}
                      resourcesError={resourcesError}
                      text={script}
                    />
                  )}

                  {submitError && (
                    <InlineError title="提交失败" message={submitError} />
                  )}

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      {template
                        ? `当前使用：${template.display_name}`
                        : "正在读取可用模板"}
                    </div>
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
                          ? "上传并提交中"
                          : "提交中"
                        : "创建真实生成任务"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </section>

            <TaskPanel
              isCancellingTask={isCancellingTask}
              onCancelTask={cancelCurrentTask}
              pollError={pollError}
              result={result}
              task={task}
              taskActionError={taskActionError}
              template={template}
            />
          </main>
        ) : activeView === "history" ? (
          <HistoryWorkspace latestTaskId={task?.task_id ?? result?.task_id ?? null} />
        ) : activeView === "scriptReview" ? (
          <ScriptReviewWorkspace />
        ) : activeView === "special" ? (
          <SpecialPipelinesWorkspace
            initialMode={specialMode}
            key={specialMode}
          />
        ) : activeView === "batch" ? (
          <BatchWorkspace />
        ) : activeView === "templates" ? (
          <TemplateStatusWorkspace
            loadState={loadState}
            onSelect={selectTemplateOrRoute}
            templates={templates}
          />
        ) : activeView === "settings" ? (
          <SettingsWorkspace />
        ) : (
          <HelpWorkspace />
        )}
      </div>
    </TooltipProvider>
  )
}

function TemplateCard({
  loadState,
  template,
  templates,
  templateCanSubmit,
  error,
  settingsError,
  settingsNotice,
  projects,
  selectedProjectId,
  isSavingDefault,
  onReload,
  onSelect,
  onSelectProject,
  onSaveDefault,
}: {
  loadState: LoadState
  template: ProductionTemplate | null
  templates: ProductionTemplate[]
  templateCanSubmit: boolean
  error: string | null
  settingsError: string | null
  settingsNotice: string | null
  projects: GenerationProject[]
  selectedProjectId: string | null
  isSavingDefault: boolean
  onReload: () => void
  onSelect: (template: ProductionTemplate) => void
  onSelectProject: (projectId: string) => void
  onSaveDefault: () => void
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>当前真实生成方式</CardTitle>
        <CardDescription>
          选择用户能理解的生产线；provider、runtime 和 workflow 固定在模板里。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loadState === "loading" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            正在读取可用视频模板
          </div>
        )}

        {loadState === "error" && (
          <div className="flex flex-col gap-3">
            <InlineError title="模板读取失败" message={error || "未知错误"} />
            <Button onClick={onReload} variant="outline">
              <RefreshCcw data-icon="inline-start" />
              重新读取
            </Button>
          </div>
        )}

        {loadState === "ready" && template && (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-lg bg-primary/5 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-primary">
                <FileText className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold">{template.display_name}</h2>
                  <Badge variant="secondary">{template.version}</Badge>
                  <Badge variant="outline">{template.entry}</Badge>
                  <MigrationBadge status={template.migration_status} />
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {template.description}
                </p>
                {template.migration_notes && (
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {template.migration_notes}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="输入" value={template.input_requirements.join(", ")} />
              <Fact label="生成方式" value={template.runtime_label} />
              <Fact label="预计耗时" value={template.estimated_turnaround} />
            </div>

            <div className="rounded-lg border bg-background p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">项目默认生产线</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    保存后，Ops/Codex 和 React 都会使用同一个项目默认模板。
                  </div>
                  {projects.length > 0 ? (
                    <select
                      className="mt-3 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                      onChange={(event) => onSelectProject(event.target.value)}
                      value={selectedProjectId ?? ""}
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name} · {project.channel}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">
                      当前没有可用 Ops 项目，使用系统默认生产线。
                    </div>
                  )}
                </div>
                <Button
                  disabled={!selectedProjectId || isSavingDefault}
                  onClick={onSaveDefault}
                  variant="outline"
                >
                  {isSavingDefault ? (
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <RefreshCcw data-icon="inline-start" />
                  )}
                  保存为默认
                </Button>
              </div>
              {settingsError && (
                <InlineError title="设置读取或保存失败" message={settingsError} />
              )}
              {settingsNotice && (
                <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
                  {settingsNotice}
                </div>
              )}
            </div>

            {!templateCanSubmit && (
              <InlineError
                title="当前生产线需要额外输入"
                message="这个生产线的输入类型还没有接入 React，不会用缺失输入创建假成功任务。"
              />
            )}

            <Separator />

            <div>
              <div className="text-sm font-medium">更换生产线</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {templates.map((item) => {
                  const selected = item.id === template.id
                  const supportsScript = item.input_requirements.includes("script")
                  const supportsTopic = item.input_requirements.includes("topic")
                  const supportsAssets = item.input_requirements.includes("assets")
                  const isDedicatedEntry = item.product_entry !== "generate"
                  const canUseHere =
                    item.enabled &&
                    !isDedicatedEntry &&
                    ((supportsScript && !item.requires_user_assets) ||
                      supportsTopic ||
                      supportsAssets)
                  const entryLabel = isDedicatedEntry
                    ? "专用入口"
                    : canUseHere
                      ? "当前可用"
                      : statusLabel(item.migration_status)
                  return (
                    <button
                      className={cn(
                        "rounded-lg border bg-background p-4 text-left transition-colors hover:bg-muted/50",
                        selected && "border-primary bg-primary/5"
                      )}
                      key={item.id}
                      onClick={() => onSelect(item)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {item.display_name}
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                            {item.description}
                          </div>
                        </div>
                        <Badge variant={selected ? "secondary" : "outline"}>
                          {item.use_case}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant="outline">
                          输入：{item.input_requirements.join(", ")}
                        </Badge>
                        <Badge
                          variant={
                            canUseHere || isDedicatedEntry ? "secondary" : "outline"
                          }
                        >
                          {entryLabel}
                        </Badge>
                        {item.streamlit_source && (
                          <Badge variant="outline">{item.streamlit_source}</Badge>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StandardInput({
  inputKind,
  text,
  advancedSettings,
  resources,
  resourcesError,
  onTextChange,
  onAdvancedSettingsChange,
  onBgmUploaded,
}: {
  inputKind: "script" | "topic"
  text: string
  advancedSettings: StandardAdvancedSettings
  resources: GenerationResources
  resourcesError: string | null
  onTextChange: (value: string) => void
  onAdvancedSettingsChange: (value: StandardAdvancedSettings) => void
  onBgmUploaded: (bgm: ResourceBgm) => void
}) {
  const trimmedText = text.trim()
  const inputId = inputKind === "topic" ? "topic" : "script"
  const title =
    inputKind === "topic" ? "选题或内容方向" : "视频文案"
  const description =
    inputKind === "topic"
      ? "后端会先生成脚本，再继续拆分、配音、画面生成和合成。"
      : "这段文字会进入当前视频模板，后端负责拆分、配音、画面生成和合成。"
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
  const previewText = previewCopy(inputKind, text, advancedSettings.title)
  const canPreview = previewText.length > 0
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
        throw new Error("后端没有返回可用的音频资产。")
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
    if (!canPreview) {
      setTtsPreviewError("请先输入要预览的文案。")
      return
    }

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
    if (!canPreview) {
      setFramePreviewError("请先输入要预览的文案。")
      return
    }

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
      <Field data-invalid={!trimmedText && text.length > 0}>
        <FieldLabel htmlFor={inputId}>{title}</FieldLabel>
        <Textarea
          aria-invalid={!trimmedText && text.length > 0}
          className="min-h-52 resize-y text-base leading-7"
          id={inputId}
          onChange={(event) => updateText(event.target.value)}
          value={text}
        />
        <FieldDescription>{description}</FieldDescription>
      </Field>

      <details className="rounded-lg border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          高级生成设置
        </summary>
        <div className="border-t p-4">
          {resourcesError && (
            <InlineError title="资源读取失败" message={resourcesError} />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="advanced-title">视频标题</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="advanced-title"
                onChange={(event) =>
                  patchAdvanced({ title: event.target.value })
                }
                placeholder="可选"
                value={advancedSettings.title}
              />
            </Field>

            {inputKind === "topic" ? (
              <Field>
                <FieldLabel htmlFor="advanced-scenes">分镜数量</FieldLabel>
                <input
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  id="advanced-scenes"
                  max={12}
                  min={1}
                  onChange={(event) =>
                    patchAdvanced({
                      nScenes: Number(event.target.value || 5),
                    })
                  }
                  type="number"
                  value={advancedSettings.nScenes}
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="advanced-split">文案拆分方式</FieldLabel>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  id="advanced-split"
                  onChange={(event) =>
                    patchAdvanced({
                      splitMode: event.target
                        .value as StandardAdvancedSettings["splitMode"],
                    })
                  }
                  value={advancedSettings.splitMode}
                >
                  <option value="paragraph">按段落</option>
                  <option value="line">按行</option>
                  <option value="sentence">按句子</option>
                </select>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="advanced-frame-template">画面模板</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="advanced-frame-template"
                onChange={(event) =>
                  patchAdvanced({ frameTemplate: event.target.value })
                }
                value={advancedSettings.frameTemplate}
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
              <FieldLabel htmlFor="advanced-media-workflow">画面 workflow</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="advanced-media-workflow"
                onChange={(event) =>
                  patchAdvanced({ mediaWorkflow: event.target.value })
                }
                value={advancedSettings.mediaWorkflow}
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
              <FieldLabel htmlFor="advanced-tts-mode">TTS 模式</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="advanced-tts-mode"
                onChange={(event) =>
                  patchAdvanced({
                    ttsInferenceMode: event.target
                      .value as StandardAdvancedSettings["ttsInferenceMode"],
                  })
                }
                value={advancedSettings.ttsInferenceMode}
              >
                <option value="local">本地/Edge Voice</option>
                <option value="comfyui">ComfyUI workflow</option>
                <option value="fish">Fish Audio</option>
              </select>
            </Field>

            <Field>
              <FieldLabel htmlFor="advanced-tts-voice">声音或 Reference ID</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="advanced-tts-voice"
                onChange={(event) =>
                  patchAdvanced({ ttsVoice: event.target.value })
                }
                value={advancedSettings.ttsVoice}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="advanced-tts-workflow">TTS workflow</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="advanced-tts-workflow"
                onChange={(event) =>
                  patchAdvanced({ ttsWorkflow: event.target.value })
                }
                value={advancedSettings.ttsWorkflow}
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
              <FieldLabel htmlFor="advanced-tts-speed">语速</FieldLabel>
              <input
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="advanced-tts-speed"
                max={2}
                min={0.5}
                onChange={(event) =>
                  patchAdvanced({
                    ttsSpeed: Number(event.target.value || 1),
                  })
                }
                step={0.1}
                type="number"
                value={advancedSettings.ttsSpeed}
              />
            </Field>

            {advancedSettings.ttsInferenceMode === "comfyui" && (
              <Field className="lg:col-span-2">
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
                  用于 ComfyUI voice cloning。上传后会传给 TTS 预览和正式生成。
                </FieldDescription>
                {isUploadingRefAudio && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="animate-spin" data-icon="inline-start" />
                    正在上传参考音频
                  </div>
                )}
                {advancedSettings.ttsRefAudioPath && (
                  <div className="mt-2 break-all rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                    {advancedSettings.ttsRefAudioName || "reference audio"} ·{" "}
                    {advancedSettings.ttsRefAudioPath}
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
              <FieldLabel htmlFor="advanced-bgm">背景音乐</FieldLabel>
              <select
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                id="advanced-bgm"
                onChange={(event) =>
                  patchAdvanced({ bgmPath: event.target.value })
                }
                value={advancedSettings.bgmPath}
              >
                <option value="">不指定 BGM</option>
                {resources.bgm.map((item) => (
                  <option key={item.path} value={item.path}>
                    {item.name} · {item.source}
                  </option>
                ))}
              </select>
            </Field>

            <BgmUploadControl
              onUploaded={(bgm) => {
                onBgmUploaded(bgm)
                patchAdvanced({ bgmPath: bgm.path })
              }}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="advanced-bgm-volume">BGM 音量</FieldLabel>
                <input
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  id="advanced-bgm-volume"
                  max={1}
                  min={0}
                  onChange={(event) =>
                    patchAdvanced({
                      bgmVolume: Number(event.target.value || 0),
                    })
                  }
                  step={0.05}
                  type="number"
                  value={advancedSettings.bgmVolume}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="advanced-bgm-mode">BGM 模式</FieldLabel>
                <select
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  id="advanced-bgm-mode"
                  onChange={(event) =>
                    patchAdvanced({
                      bgmMode: event.target
                        .value as StandardAdvancedSettings["bgmMode"],
                    })
                  }
                  value={advancedSettings.bgmMode}
                >
                  <option value="loop">循环</option>
                  <option value="once">播放一次</option>
                </select>
              </Field>
            </div>
          </div>

          {bgmPreviewUrl && (
            <div className="mt-4 rounded-lg border bg-muted/30 p-4">
              <div className="text-sm font-medium">BGM 预览</div>
              <audio className="mt-3 w-full" controls src={bgmPreviewUrl} />
            </div>
          )}

          <div className="mt-5 rounded-lg border bg-muted/30 p-4">
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium">模板自定义参数</div>
              <p className="text-sm leading-6 text-muted-foreground">
                参数来自当前 HTML 模板，会随生成任务一起提交。
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

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-medium">声音预览</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    使用当前 TTS 设置调用真实后端合成一小段音频。
                  </p>
                </div>
                <Button
                  disabled={!canPreview || isPreviewingTts}
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact label="音频时长" value={formatDuration(ttsPreview.duration)} />
                    <Fact label="TTS 模式" value={advancedSettings.ttsInferenceMode} />
                  </div>
                  <div className="break-all rounded-lg bg-background p-3 font-mono text-xs text-muted-foreground">
                    {ttsPreview.audio_path}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-medium">画面模板预览</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    使用当前模板和预览文案渲染一张真实帧图。
                  </p>
                </div>
                <Button
                  disabled={!canPreview || isPreviewingFrame}
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
                      alt="画面模板预览"
                      className="aspect-[9/16] max-h-[420px] rounded-lg border bg-background object-contain"
                      src={framePreviewUrl}
                    />
                  ) : (
                    <InlineError
                      title="画面不可预览"
                      message="后端返回了 frame_path，但无法转换成 /api/files URL。"
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
                  <div className="break-all rounded-lg bg-background p-3 font-mono text-xs text-muted-foreground">
                    {framePreview.frame_path}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-medium">媒体工作流预览</div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    使用当前 workflow 生成一张图片或一段短视频。
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
                  <input
                    className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
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
                      message="后端返回了媒体路径，但无法转换成可访问 URL。"
                    />
                  )}
                  <div className="break-all rounded-lg bg-background p-3 font-mono text-xs text-muted-foreground">
                    {mediaPreview.media_path}
                  </div>
                </div>
              )}
            </div>
          </div>

          <Field className="mt-4">
            <FieldLabel htmlFor="advanced-prompt-prefix">画面提示词前缀</FieldLabel>
            <Textarea
              className="min-h-24 resize-y"
              id="advanced-prompt-prefix"
              onChange={(event) =>
                patchAdvanced({ promptPrefix: event.target.value })
              }
              placeholder="可选，例如：温暖自然光、真实宠物生活方式、竖屏构图"
              value={advancedSettings.promptPrefix}
            />
          </Field>

          <Field className="mt-4">
            <FieldLabel htmlFor="advanced-visual-context">画面视觉上下文</FieldLabel>
            <Textarea
              className="min-h-24 resize-y"
              id="advanced-visual-context"
              onChange={(event) =>
                patchAdvanced({
                  imagePromptVisualContext: event.target.value,
                })
              }
              placeholder="可选，例如品牌视觉、宠物品种、场景约束或不希望偏离的画面事实。"
              value={advancedSettings.imagePromptVisualContext}
            />
            <FieldDescription>
              对应旧 Streamlit 的 image_prompt_visual_context。
            </FieldDescription>
          </Field>

          <Field className="mt-4">
            <FieldLabel htmlFor="advanced-prompt-rules">画面提示词生成规则</FieldLabel>
            <Textarea
              className="min-h-24 resize-y"
              id="advanced-prompt-rules"
              onChange={(event) =>
                patchAdvanced({
                  imagePromptGenerationRules: event.target.value,
                })
              }
              placeholder="可选，用于约束后端生成每个分镜的画面提示词。"
              value={advancedSettings.imagePromptGenerationRules}
            />
          </Field>
        </div>
      </details>
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
        <input
          accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/webm"
          className="block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          id="assets"
          multiple
          onChange={(event) =>
            onAssetFilesChange(Array.from(event.currentTarget.files ?? []))
          }
          type="file"
        />
        <FieldDescription>
          支持图片和视频。提交时会先上传到本地素材目录，再把真实路径交给后端生成任务。
        </FieldDescription>
      </Field>

      {assetFiles.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-sm font-medium">待上传素材</div>
          <div className="mt-2 flex flex-col gap-2">
            {assetFiles.map((file) => (
              <div
                className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2 text-sm"
                key={`${file.name}-${file.size}-${file.lastModified}`}
              >
                <span className="min-w-0 truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
  pollError,
  taskActionError,
}: {
  isCancellingTask: boolean
  onCancelTask: () => void
  task: GenerationTask | null
  result: GenerationResult | null
  template: ProductionTemplate | null
  pollError: string | null
  taskActionError: string | null
}) {
  const videoUrl = artifactFileUrl(result?.primary_video)
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
          <CardTitle>2. 真实任务状态</CardTitle>
          <CardDescription>
            提交后展示后端返回的任务进度和失败原因。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!task && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              提交内容后，这里会显示真实
              <code className="mx-1 rounded bg-background px-1 py-0.5 text-xs">
                generation_task_id
              </code>
              和轮询状态。
            </div>
          )}

          {task && (
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-muted-foreground">任务 ID</div>
                  <div className="mt-1 truncate font-mono text-sm">
                    {task.task_id}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    aria-label="复制任务 ID"
                    onClick={() => void navigator.clipboard?.writeText(task.task_id)}
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
                  <StatusBadge status={task.status} />
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
                <div className="mt-2 text-xs text-muted-foreground">
                  stage: {task.progress.stage}
                </div>
                {progressRuntimeItems.length > 0 && (
                  <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
                    {progressRuntimeItems.map((item) => (
                      <Fact key={item.label} label={item.label} value={item.value} />
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <Fact label="生成链路" value={task.pipeline_id} />
                <Fact label="输入类型" value={task.entry} />
              </div>

              {task.status === "failed" && task.error && (
                <InlineError
                  title={`任务失败：${task.error.layer}`}
                  message={`${task.error.message}${
                    template?.failure_guidance
                      ? ` ${template.failure_guidance}`
                      : ""
                  }`}
                />
              )}
            </div>
          )}

          {pollError && <InlineError title="状态读取失败" message={pollError} />}
          {taskActionError && (
            <InlineError title="任务操作失败" message={taskActionError} />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>3. 结果</CardTitle>
          <CardDescription>
            任务完成后会自动展示成片和关键产物信息。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!result && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              任务完成前不会显示成片结果。
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-4">
              {videoUrl ? (
                <video
                  className="aspect-[9/16] max-h-[520px] rounded-lg border bg-black"
                  controls
                  src={videoUrl}
                />
              ) : (
                <InlineError
                  title="结果视频不可预览"
                  message="后端返回了 primary_video.path，但无法转换成 /api/files URL。"
                />
              )}

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

              <div>
                <div className="text-sm font-medium">成片路径</div>
                <div className="mt-2 break-all rounded-lg bg-muted/40 p-3 font-mono text-xs text-muted-foreground">
                  {result.primary_video.path}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </aside>
  )
}

function TemplateStatusWorkspace({
  templates,
  loadState,
  onSelect,
}: {
  templates: ProductionTemplate[]
  loadState: LoadState
  onSelect: (template: ProductionTemplate) => void
}) {
  const readyCount = templates.filter((template) => template.enabled).length
  const legacyCount = templates.filter(
    (template) => template.migration_status === "legacy_only"
  ).length
  const plannedCount = templates.filter(
    (template) => template.migration_status === "planned"
  ).length

  return (
    <main className="mx-auto flex max-w-[1240px] flex-col gap-5 p-4 lg:p-6">
      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>模板与迁移状态</CardTitle>
          <CardDescription>
            Pipeline 是底层能力，模板是面向用户的固定生成方案。这里展示 React 入口和真实任务提交状态；最终视频和发布仍以 E2E 验收为准。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <Fact label="React 可提交" value={`${readyCount} 个`} />
            <Fact label="Legacy only" value={`${legacyCount} 个`} />
            <Fact label="Planned" value={`${plannedCount} 个`} />
          </div>

          {loadState === "loading" && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在读取模板状态
            </div>
          )}

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {templates.map((template) => {
              const isDedicatedEntry = template.product_entry !== "generate"
              return (
                <div className="rounded-lg border bg-background p-4" key={template.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        {template.display_name}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {template.id}
                      </div>
                    </div>
                    <MigrationBadge status={template.migration_status} />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {template.description}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge
                      variant={
                        template.enabled || isDedicatedEntry ? "secondary" : "outline"
                      }
                    >
                      {isDedicatedEntry
                        ? "专用入口"
                        : template.enabled
                          ? "React 可提交"
                          : "不可提交"}
                    </Badge>
                    <Badge variant="outline">
                      输入：{template.input_requirements.join(", ")}
                    </Badge>
                    <Badge variant="outline">{template.pipeline_id}</Badge>
                    {template.streamlit_source && (
                      <Badge variant="outline">{template.streamlit_source}</Badge>
                    )}
                  </div>
                  {template.migration_notes && (
                    <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm leading-6 text-muted-foreground">
                      {template.migration_notes}
                    </div>
                  )}
                  <div className="mt-4 flex justify-end">
                    <Button onClick={() => onSelect(template)} variant="outline">
                      {isDedicatedEntry ? "打开专用入口" : "使用这个模板"}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </main>
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

function isSpecialProductEntry(value: string): value is SpecialPipelineMode {
  return (
    value === "image_to_video" ||
    value === "action_transfer" ||
    value === "digital_human"
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: GenerationTask["status"] }) {
  const config = {
    pending: { label: "pending", icon: Clock3, className: "" },
    running: { label: "running", icon: Loader2, className: "animate-spin" },
    completed: { label: "completed", icon: CheckCircle2, className: "" },
    failed: { label: "failed", icon: XCircle, className: "" },
    cancelled: { label: "cancelled", icon: AlertCircle, className: "" },
  }[status]
  const Icon = config.icon

  return (
    <Badge variant={status === "failed" ? "destructive" : "secondary"}>
      <Icon className={cn(config.className)} data-icon="inline-start" />
      {config.label}
    </Badge>
  )
}

function MigrationBadge({
  status,
}: {
  status: ProductionTemplate["migration_status"]
}) {
  const label = statusLabel(status)
  const variant = status === "ready" || status === "partial" ? "secondary" : "outline"
  return <Badge variant={variant}>{label}</Badge>
}

function statusLabel(status: ProductionTemplate["migration_status"]) {
  const labels = {
    ready: "React 可提交",
    partial: "部分迁移",
    legacy_only: "Legacy only",
    planned: "计划中",
  }
  return labels[status]
}

function InlineError({ title, message }: { title: string; message: string }) {
  return (
    <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
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

function formatDuration(value: number | null) {
  if (value == null) {
    return "未返回"
  }

  return `${value.toFixed(1)} 秒`
}

function formatBytes(value: number | null) {
  if (value == null) {
    return "未返回"
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`
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
