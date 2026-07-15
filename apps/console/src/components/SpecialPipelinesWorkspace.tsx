import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  Check,
  Circle,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
} from "lucide-react"

import { AdvancedGroup } from "@/components/shared/AdvancedGroup"
import { AsyncState } from "@/components/shared/AsyncState"
import { FileDropzone } from "@/components/shared/FileDropzone"
import {
  Fact,
  InlineError,
  QualityBadge,
  QualityMessages,
  TechDetails,
} from "@/components/shared/feedback"
import { PageFrame } from "@/components/shared/PageFrame"
import { SingleTaskPanel } from "@/components/shared/SingleTaskPanel"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { WorkspacePanel } from "@/components/shared/WorkspacePanel"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useToast } from "@/components/ui/toast"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useCurrentProject } from "@/lib/currentProject"
import {
  formatBytes,
  formatDuration,
  readableError,
  voiceLabel,
} from "@/lib/format"
import {
  artifactFileUrl,
  cancelGenerationTask,
  createGenerationTemplateTask,
  createProductionTask,
  getTask,
  getTaskResult,
  listTemplates,
  uploadGenerationAssets,
  type GenerationResult,
  type GenerationTask,
  type ProductionTemplate,
} from "@/lib/generationApi"
import {
  productionDescription,
  productionInputSummary,
} from "@/lib/productionSurface"
import {
  adaptRunStatus,
  runStatusIsActive,
  runStatusIsCancellable,
} from "@/lib/productViewModels"
import { productionRunViewModel } from "@/lib/productionRunAdapters"
import {
  buildAssetItems,
  buildProgressRuntimeItems,
  buildQualitySummary,
  type AssetManifestInput,
  type QualityReviewInput,
} from "@/lib/resultSummary"
import { navigate, routeHref } from "@/lib/router"
import {
  buildSpecialTaskInput,
  digitalVoiceDefaults,
  digitalVoiceOverrides,
  preferredSpecialTemplate,
  resolveSpecialTemplate,
  specialTemplatePath,
  specialTemplatesForMode,
  SPECIAL_MODE_COPY,
  SPECIAL_PIPELINE_MODES,
  validateSpecialSubmission,
  type DigitalHumanMode,
  type DigitalVoiceSettings,
  type SpecialPipelineMode,
} from "@/lib/specialPipelineSurface"
import { useTaskCenter } from "@/lib/taskCenter"
import { cn } from "@/lib/utils"

export type { SpecialPipelineMode } from "@/lib/specialPipelineSurface"

type LoadState = "loading" | "ready" | "error" | "stale"

const FORM_ID = "special-production-form"

export function SpecialPipelinesWorkspace({
  initialMode,
  templateId,
}: {
  initialMode: SpecialPipelineMode
  templateId: string
}) {
  const { projectId } = useCurrentProject()
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(true)
  const cachedTemplatesRef = useRef<{
    projectId?: string
    templates: ProductionTemplate[]
  } | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const cached =
        cachedTemplatesRef.current?.projectId === (projectId ?? undefined)
          ? cachedTemplatesRef.current
          : null
      if (!cached) {
        setTemplates([])
        setLoadState("loading")
      }
      setIsRefreshing(true)
      setLoadError(null)
      try {
        const response = await listTemplates(projectId ?? undefined)
        if (!cancelled) {
          setTemplates(response.templates)
          cachedTemplatesRef.current = {
            projectId: projectId ?? undefined,
            templates: response.templates,
          }
          setLoadState("ready")
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(readableError(error))
          if (cached) {
            setTemplates(cached.templates)
            setLoadState("stale")
          } else {
            setLoadState("error")
          }
        }
      } finally {
        if (!cancelled) {
          setIsRefreshing(false)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [projectId, reloadToken])

  const resolution = useMemo(
    () =>
      loadState === "ready" || loadState === "stale"
        ? resolveSpecialTemplate(templates, initialMode, templateId)
        : null,
    [initialMode, loadState, templateId, templates]
  )
  if (loadState === "loading") {
    return (
      <SpecialStateShell mode={initialMode}>
        <AsyncState
          description="正在同步当前项目的专用生产模板。"
          state="loading"
          title="正在读取模板"
        />
      </SpecialStateShell>
    )
  }

  if (loadState === "error") {
    return (
      <SpecialStateShell mode={initialMode}>
        <AsyncState
          action={
            <Button
              onClick={() => setReloadToken((value) => value + 1)}
              size="sm"
              type="button"
              variant="outline"
            >
              重试
            </Button>
          }
          description={loadError || "暂时无法读取模板。"}
          state="error"
          title="模板读取失败"
        />
      </SpecialStateShell>
    )
  }

  if (!resolution) {
    return null
  }

  if (resolution.kind === "not_found") {
    return (
      <SpecialStateShell mode={initialMode}>
        <ResolutionError
          description={`没有找到模板「${resolution.templateId}」，链接可能已失效。`}
          title="模板不存在"
        />
      </SpecialStateShell>
    )
  }

  if (resolution.kind === "mode_mismatch") {
    return (
      <SpecialStateShell mode={initialMode}>
        <ResolutionError
          description={`「${resolution.template.display_name}」不属于${SPECIAL_MODE_COPY[initialMode].label}，不会自动改用其他模板。`}
          title="模板与生产模式不匹配"
        />
      </SpecialStateShell>
    )
  }

  if (resolution.kind === "unavailable") {
    return (
      <SpecialStateShell mode={initialMode}>
        <ResolutionError
          description={`「${resolution.template.display_name}」已停用，请返回快速生产选择可用模板。`}
          title="当前模板暂不可用"
        />
      </SpecialStateShell>
    )
  }

  return (
    <SpecialWorkspace
      key={resolution.template.id}
      mode={initialMode}
      projectId={projectId ?? undefined}
      isRefreshing={isRefreshing}
      loadError={loadState === "stale" ? loadError : null}
      onReload={() => setReloadToken((value) => value + 1)}
      template={resolution.template}
      templates={templates}
    />
  )
}

function SpecialWorkspace({
  mode,
  projectId,
  isRefreshing,
  loadError,
  onReload,
  template,
  templates,
}: {
  mode: SpecialPipelineMode
  projectId?: string
  isRefreshing: boolean
  loadError: string | null
  onReload: () => void
  template: ProductionTemplate
  templates: ProductionTemplate[]
}) {
  const toast = useToast()
  const taskCenter = useTaskCenter()
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [referenceVideoFiles, setReferenceVideoFiles] = useState<File[]>([])
  const [characterFiles, setCharacterFiles] = useState<File[]>([])
  const [goodsFiles, setGoodsFiles] = useState<File[]>([])
  const [prompt, setPrompt] = useState("")
  const [title, setTitle] = useState("")
  const [duration, setDuration] = useState(0)
  const [digitalMode, setDigitalMode] = useState<DigitalHumanMode>(() =>
    template.fixed_params.mode === "digital" ? "digital" : "customize"
  )
  const [script, setScript] = useState("")
  const [goodsTitle, setGoodsTitle] = useState("")
  const voiceDefaults = useMemo(
    () => digitalVoiceDefaults(template),
    [template]
  )
  const [voiceSettings, setVoiceSettings] =
    useState<DigitalVoiceSettings>(voiceDefaults)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isCancellingTask, setIsCancellingTask] = useState(false)
  const [taskActionError, setTaskActionError] = useState<string | null>(null)
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [resultFetchError, setResultFetchError] = useState<string | null>(null)
  const [resultReloadToken, setResultReloadToken] = useState(0)
  const [batchMode, setBatchMode] = useState(false)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)

  const task = currentTaskId
    ? (taskCenter.getTask(currentTaskId)?.task ?? null)
    : null
  const isI2v = mode === "image_to_video"
  const inBatch = isI2v && batchMode
  const hasActiveTask = Boolean(
    task && runStatusIsActive(adaptRunStatus(task.status))
  )
  const voiceOverrideValues = useMemo(
    () => digitalVoiceOverrides(voiceDefaults, voiceSettings),
    [voiceDefaults, voiceSettings]
  )
  const validation = validateSpecialSubmission({
    mode,
    digitalMode,
    templateEnabled: template.enabled,
    imageCount: imageFiles.length,
    referenceVideoCount: referenceVideoFiles.length,
    characterCount: characterFiles.length,
    goodsCount: goodsFiles.length,
    prompt,
    script,
    goodsTitle,
    isSubmitting,
    hasActiveTask,
  })
  const canSubmit = validation.ok
  const recipeOptions = specialTemplatesForMode(templates, mode).filter(
    (item) => item.enabled
  )
  const inputChecks = buildInputChecks({
    mode,
    digitalMode,
    imageFiles,
    referenceVideoFiles,
    characterFiles,
    goodsFiles,
    prompt,
    script,
    goodsTitle,
  })

  useEffect(() => {
    const completedTaskId = task?.task_id
    if (
      !completedTaskId ||
      task.status !== "completed" ||
      result?.task_id === completedTaskId
    ) {
      return
    }

    let cancelled = false
    void getTaskResult(completedTaskId)
      .then((taskResult) => {
        if (!cancelled) {
          setResult(taskResult)
          setResultFetchError(null)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setResultFetchError(readableError(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [result?.task_id, resultReloadToken, task?.status, task?.task_id])

  function resetVisibleRun() {
    setCurrentTaskId(null)
    setResult(null)
    setResultFetchError(null)
    setTaskActionError(null)
    setSubmitError(null)
  }

  function toggleBatch(nextBatch: boolean) {
    setBatchMode(nextBatch)
    if (!nextBatch) {
      setImageFiles((current) => current.slice(0, 1))
    }
    resetVisibleRun()
  }

  async function submitSingle() {
    if (!canSubmit || inBatch || !projectId) {
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)
    setTaskActionError(null)
    setResultFetchError(null)
    setCurrentTaskId(null)
    setResult(null)

    try {
      const uploadPaths = await uploadModeAssets({
        mode,
        digitalMode,
        imageFiles,
        referenceVideoFiles,
        characterFiles,
        goodsFiles,
      })
      const input = buildSpecialTaskInput({
        mode,
        digitalMode,
        imagePaths: uploadPaths.images,
        referenceVideoPaths: uploadPaths.referenceVideos,
        characterPaths: uploadPaths.characters,
        goodsPaths: uploadPaths.goods,
        prompt,
        title,
        duration,
        script,
        goodsTitle,
      })
      const response = await createGenerationTemplateTask(
        template.id,
        template.pipeline_id,
        input,
        projectId,
        voiceOverrideValues
      )
      const generationTaskId = response.task.generation_task_ids.at(-1)
      if (!generationTaskId) {
        throw new Error("生产任务已建立，但执行任务尚未创建。")
      }
      const generationTask = await getTask(generationTaskId)
      taskCenter.trackTask(generationTask, template.display_name)
      setCurrentTaskId(generationTask.task_id)
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitBatch() {
    if (!canSubmit || !inBatch || !projectId) {
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)
    setBatchConfirmOpen(false)
    try {
      const uploaded = await uploadGenerationAssets(imageFiles)
      const items = uploaded.assets.map((asset) => ({
        input: buildSpecialTaskInput({
          mode: "image_to_video",
          digitalMode,
          imagePaths: [asset.path],
          referenceVideoPaths: [],
          characterPaths: [],
          goodsPaths: [],
          prompt,
          title,
          duration: 0,
          script: "",
          goodsTitle: "",
        }),
      }))
      const results = await Promise.allSettled(
        items.map((item) =>
          createProductionTask({
            projectId,
            pipelineId: template.pipeline_id,
            recipeId: template.id,
            payload: item.input,
            source: "react",
          })
        )
      )
      const createdCount = results.filter(
        (result) => result.status === "fulfilled"
      ).length
      const failedCount = results.length - createdCount
      if (createdCount === 0) {
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        )
        throw firstFailure?.reason ?? new Error("批量任务创建失败。")
      }
      toast({
        title: `已创建 ${createdCount} 条独立任务`,
        description: failedCount ? `${failedCount} 条未能创建。` : undefined,
        variant: failedCount ? "default" : "success",
      })
      navigate("/board")
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function cancelCurrentTask() {
    if (
      !task ||
      !runStatusIsCancellable(adaptRunStatus(task.status)) ||
      isCancellingTask
    ) {
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) {
      return
    }
    if (inBatch) {
      setBatchConfirmOpen(true)
      return
    }
    void submitSingle()
  }

  const submitLabel = isSubmitting
    ? "正在上传并提交…"
    : inBatch
      ? `批量生成 ${imageFiles.length} 条视频`
      : "开始生成"

  return (
    <PageFrame>
      <BackLink />
      <WorkspaceHeader
        actions={
          <>
            <Button
              aria-label="刷新专用模板"
              disabled={isRefreshing}
              onClick={onReload}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <RefreshCw className={cn(isRefreshing && "animate-spin")} />
            </Button>
            <Button asChild className="hidden lg:inline-flex" variant="outline">
              <a href={routeHref(`/create/recipes/${template.id}`)}>
                调整模板默认
              </a>
            </Button>
            <SubmitButton
              canSubmit={canSubmit}
              className="hidden lg:inline-flex"
              form={FORM_ID}
              inBatch={inBatch}
              isSubmitting={isSubmitting}
              label={submitLabel}
            />
          </>
        }
        description={productionDescription(template)}
        headingLevel={2}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {template.display_name}
            <Badge variant="secondary">视频</Badge>
            {template.is_custom ? (
              <Badge variant="outline">我的模板</Badge>
            ) : null}
          </span>
        }
      />

      {loadError ? (
        <AsyncState
          action={
            <Button
              disabled={isRefreshing}
              onClick={onReload}
              size="sm"
              type="button"
              variant="outline"
            >
              {isRefreshing ? <Loader2 className="animate-spin" /> : null}
              重新读取
            </Button>
          }
          description={loadError}
          state="stale"
          title="专用模板可能不是最新状态"
        />
      ) : null}

      <WorkspacePanel
        description="切换会打开独立链接，当前页未提交的素材不会带到新模式。"
        title="专用生产"
        variant="plain"
      >
        <ModeNavigation
          currentMode={mode}
          currentTemplate={template}
          templates={templates}
        />
        {recipeOptions.length > 1 ? (
          <RecipeNavigation
            currentTemplate={template}
            mode={mode}
            templates={recipeOptions}
          />
        ) : null}
      </WorkspacePanel>

      <form
        className="flex min-w-0 flex-col gap-4"
        id={FORM_ID}
        onSubmit={handleSubmit}
      >
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(380px,0.72fr)] lg:items-start lg:gap-5">
          <section className="flex min-w-0 flex-col gap-4">
            <WorkspacePanel
              className="min-h-[620px]"
              description={SPECIAL_MODE_COPY[mode].inputDescription}
              headerAction={
                isI2v ? (
                  <ToggleGroup
                    aria-label="选择单条或批量生成"
                    disabled={hasActiveTask || isSubmitting}
                    onValueChange={(value) => {
                      if (value === "single" || value === "batch") {
                        toggleBatch(value === "batch")
                      }
                    }}
                    type="single"
                    value={inBatch ? "batch" : "single"}
                    variant="outline"
                  >
                    <ToggleGroupItem
                      className="min-h-11 sm:min-h-8"
                      value="single"
                    >
                      单条
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      className="min-h-11 sm:min-h-8"
                      value="batch"
                    >
                      批量
                    </ToggleGroupItem>
                  </ToggleGroup>
                ) : null
              }
              title={SPECIAL_MODE_COPY[mode].inputTitle}
            >
              <FieldGroup>
                {mode === "image_to_video" ? (
                  <ImageToVideoFields
                    files={imageFiles}
                    inBatch={inBatch}
                    onFilesChange={setImageFiles}
                    onPromptChange={setPrompt}
                    onTitleChange={setTitle}
                    prompt={prompt}
                    title={title}
                  />
                ) : mode === "action_transfer" ? (
                  <ActionTransferFields
                    duration={duration}
                    imageFiles={imageFiles}
                    onDurationChange={setDuration}
                    onImageFilesChange={setImageFiles}
                    onPromptChange={setPrompt}
                    onReferenceVideoFilesChange={setReferenceVideoFiles}
                    onTitleChange={setTitle}
                    prompt={prompt}
                    referenceVideoFiles={referenceVideoFiles}
                    title={title}
                  />
                ) : (
                  <DigitalHumanFields
                    characterFiles={characterFiles}
                    digitalMode={digitalMode}
                    goodsFiles={goodsFiles}
                    goodsTitle={goodsTitle}
                    onCharacterFilesChange={setCharacterFiles}
                    onDigitalModeChange={(nextMode) => {
                      setDigitalMode(nextMode)
                      setSubmitError(null)
                    }}
                    onGoodsFilesChange={setGoodsFiles}
                    onGoodsTitleChange={setGoodsTitle}
                    onScriptChange={setScript}
                    onTitleChange={setTitle}
                    onVoiceSettingsChange={setVoiceSettings}
                    onVoiceSettingsReset={() => setVoiceSettings(voiceDefaults)}
                    script={script}
                    title={title}
                    voiceDefaults={voiceDefaults}
                    voiceSettings={voiceSettings}
                  />
                )}
              </FieldGroup>

              {submitError ? (
                <InlineError message={submitError} title="提交失败" />
              ) : null}
            </WorkspacePanel>

          </section>

          {inBatch ? (
            <BatchInspector files={imageFiles} prompt={prompt} title={title} />
          ) : (
            <RunInspector
              inputChecks={inputChecks}
              isCancellingTask={isCancellingTask}
              isSubmitting={isSubmitting}
              onCancelTask={cancelCurrentTask}
              onRetryResult={() => {
                setResultFetchError(null)
                setResult(null)
                setResultReloadToken((value) => value + 1)
              }}
              result={result}
              resultFetchError={resultFetchError}
              task={task}
              taskActionError={taskActionError}
              template={template}
            />
          )}
        </div>
      </form>

      <div className="sticky bottom-[calc(4.25rem+var(--safe-area-bottom))] z-20 -mx-2 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur lg:hidden">
        {!canSubmit && validation.reason ? (
          <p
            className="mb-2 text-center text-xs text-muted-foreground"
            id="special-submit-hint"
          >
            {validation.reason}
          </p>
        ) : null}
        <SubmitButton
          canSubmit={canSubmit}
          className="min-h-11 w-full"
          describedBy={!canSubmit ? "special-submit-hint" : undefined}
          form={FORM_ID}
          inBatch={inBatch}
          isSubmitting={isSubmitting}
          label={submitLabel}
        />
      </div>

      <AlertDialog onOpenChange={setBatchConfirmOpen} open={batchConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              批量生成 {imageFiles.length} 条视频？
            </AlertDialogTitle>
            <AlertDialogDescription>
              每张图会创建一个独立任务，共享当前运动描述和标题。失败项可以单独重试。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再检查一下</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "default" }))}
              onClick={() => void submitBatch()}
            >
              确认提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageFrame>
  )
}

function ImageToVideoFields({
  files,
  inBatch,
  onFilesChange,
  onPromptChange,
  onTitleChange,
  prompt,
  title,
}: {
  files: File[]
  inBatch: boolean
  onFilesChange: (files: File[]) => void
  onPromptChange: (value: string) => void
  onTitleChange: (value: string) => void
  prompt: string
  title: string
}) {
  return (
    <>
      <FileField
        accept="image/*"
        files={files}
        hint={
          inBatch ? "可选多张，每张图生成一条视频" : "单条模式仅使用一张图片"
        }
        id="i2v-images"
        label={inBatch ? "图片" : "起始图片"}
        multiple={inBatch}
        onChange={onFilesChange}
        required
      />
      <PromptField
        id="i2v-prompt"
        label="运动描述"
        onChange={onPromptChange}
        placeholder="例如：镜头缓慢推近，人物自然眺眼，头发轻微飘动"
        value={prompt}
      />
      <TextField
        description={inBatch ? "批量中所有视频共用此标题。" : undefined}
        id="i2v-title"
        label="视频标题（可选）"
        onChange={onTitleChange}
        value={title}
      />
    </>
  )
}

function ActionTransferFields({
  duration,
  imageFiles,
  onDurationChange,
  onImageFilesChange,
  onPromptChange,
  onReferenceVideoFilesChange,
  onTitleChange,
  prompt,
  referenceVideoFiles,
  title,
}: {
  duration: number
  imageFiles: File[]
  onDurationChange: (value: number) => void
  onImageFilesChange: (files: File[]) => void
  onPromptChange: (value: string) => void
  onReferenceVideoFilesChange: (files: File[]) => void
  onTitleChange: (value: string) => void
  prompt: string
  referenceVideoFiles: File[]
  title: string
}) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <FileField
          accept="video/*"
          files={referenceVideoFiles}
          hint="仅使用一段视频，最长按 30 秒处理"
          id="action-reference-video"
          label="参考动作视频"
          multiple={false}
          onChange={onReferenceVideoFilesChange}
          required
        />
        <FileField
          accept="image/*"
          files={imageFiles}
          hint="动作将迁移到这个人物"
          id="action-target-image"
          label="目标人物图"
          multiple={false}
          onChange={onImageFilesChange}
          required
        />
      </div>
      <PromptField
        id="action-prompt"
        label="效果描述"
        onChange={onPromptChange}
        placeholder="例如：保留人物面部特征，动作自然，画面稳定"
        value={prompt}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="action-title"
          label="视频标题（可选）"
          onChange={onTitleChange}
          value={title}
        />
        <NumberField
          description="0 表示跟随参考视频，最长 30 秒。"
          id="action-duration"
          label="目标时长（秒）"
          max={30}
          min={0}
          onChange={onDurationChange}
          value={duration}
        />
      </div>
    </>
  )
}

function DigitalHumanFields({
  characterFiles,
  digitalMode,
  goodsFiles,
  goodsTitle,
  onCharacterFilesChange,
  onDigitalModeChange,
  onGoodsFilesChange,
  onGoodsTitleChange,
  onScriptChange,
  onTitleChange,
  onVoiceSettingsChange,
  onVoiceSettingsReset,
  script,
  title,
  voiceDefaults,
  voiceSettings,
}: {
  characterFiles: File[]
  digitalMode: DigitalHumanMode
  goodsFiles: File[]
  goodsTitle: string
  onCharacterFilesChange: (files: File[]) => void
  onDigitalModeChange: (mode: DigitalHumanMode) => void
  onGoodsFilesChange: (files: File[]) => void
  onGoodsTitleChange: (value: string) => void
  onScriptChange: (value: string) => void
  onTitleChange: (value: string) => void
  onVoiceSettingsChange: (settings: DigitalVoiceSettings) => void
  onVoiceSettingsReset: () => void
  script: string
  title: string
  voiceDefaults: DigitalVoiceSettings
  voiceSettings: DigitalVoiceSettings
}) {
  const voiceIsDirty =
    voiceSettings.voice.trim() !== voiceDefaults.voice.trim() ||
    voiceSettings.speed !== voiceDefaults.speed

  return (
    <>
      <FieldSet>
        <FieldLegend variant="label">内容模式</FieldLegend>
        <ToggleGroup
          aria-label="选择数字人内容模式"
          className="justify-start"
          onValueChange={(value) => {
            if (value === "customize" || value === "digital") {
              onDigitalModeChange(value)
            }
          }}
          type="single"
          value={digitalMode}
          variant="outline"
        >
          <ToggleGroupItem className="min-h-11 sm:min-h-8" value="customize">
            自定义文案
          </ToggleGroupItem>
          <ToggleGroupItem className="min-h-11 sm:min-h-8" value="digital">
            商品讲解
          </ToggleGroupItem>
        </ToggleGroup>
      </FieldSet>

      <div className="grid gap-4 md:grid-cols-2">
        <FileField
          accept="image/*"
          files={characterFiles}
          hint="选择正面、清晰、面部无遮挡的形象图"
          id="digital-character-image"
          label="角色图"
          multiple={false}
          onChange={onCharacterFilesChange}
          required
        />
        {digitalMode === "digital" ? (
          <FileField
            accept="image/*"
            files={goodsFiles}
            hint="仅使用一张商品主图"
            id="digital-goods-image"
            label="商品图"
            multiple={false}
            onChange={onGoodsFilesChange}
            required
          />
        ) : null}
      </div>

      {digitalMode === "digital" ? (
        <TextField
          description="如果不填讲解文案，商品标题必填。"
          id="digital-goods-title"
          label="商品标题"
          onChange={onGoodsTitleChange}
          value={goodsTitle}
        />
      ) : null}

      <Field>
        <FieldLabel htmlFor="digital-script">
          {digitalMode === "digital" ? "商品讲解文案（可选）" : "口播文案"}
        </FieldLabel>
        <Textarea
          className="min-h-44 resize-y text-base leading-7"
          id="digital-script"
          onChange={(event) => onScriptChange(event.target.value)}
          placeholder={
            digitalMode === "digital"
              ? "输入自定义讲解文案；留空时根据商品标题生成。"
              : "输入要由数字人讲述的完整文案。"
          }
          value={script}
        />
      </Field>

      <TextField
        id="digital-title"
        label="视频标题（可选）"
        onChange={onTitleChange}
        value={title}
      />

      <AdvancedGroup
        description={
          voiceIsDirty
            ? "已调整当次音色设置"
            : `沿用模板：${voiceLabel(voiceDefaults.voice) || "默认音色"}·${voiceDefaults.speed}x`
        }
        id="special-digital-voice"
        title="当次声音设置"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="digital-voice"
            label="音色"
            onChange={(voice) =>
              onVoiceSettingsChange({ ...voiceSettings, voice })
            }
            value={voiceSettings.voice}
          />
          <NumberField
            id="digital-speed"
            label="语速"
            max={2}
            min={0.5}
            onChange={(speed) =>
              onVoiceSettingsChange({ ...voiceSettings, speed })
            }
            step={0.1}
            value={voiceSettings.speed}
          />
        </div>
        {voiceIsDirty ? (
          <Button
            className="self-start"
            onClick={onVoiceSettingsReset}
            size="sm"
            type="button"
            variant="ghost"
          >
            <RotateCcw data-icon="inline-start" />
            恢复模板默认
          </Button>
        ) : null}
      </AdvancedGroup>
    </>
  )
}

function FileField({
  accept,
  files,
  hint,
  id,
  label,
  multiple,
  onChange,
  required = false,
}: {
  accept: string
  files: File[]
  hint?: string
  id: string
  label: string
  multiple: boolean
  onChange: (files: File[]) => void
  required?: boolean
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </FieldLabel>
      <FileDropzone
        accept={accept}
        files={files}
        hint={hint}
        id={id}
        multiple={multiple}
        onFilesChange={onChange}
      />
    </Field>
  )
}

function TextField({
  description,
  id,
  label,
  onChange,
  value,
}: {
  description?: string
  id: string
  label: string
  onChange: (value: string) => void
  value: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        className="min-h-11 sm:min-h-8"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function NumberField({
  description,
  id,
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  description?: string
  id: string
  label: string
  max: number
  min: number
  onChange: (value: number) => void
  step?: number
  value: number
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        className="min-h-11 sm:min-h-8"
        id={id}
        max={max}
        min={min}
        onChange={(event) => {
          const numeric = Number(event.target.value)
          onChange(Number.isFinite(numeric) ? numeric : min)
        }}
        step={step}
        type="number"
        value={value}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  )
}

function PromptField({
  id,
  label,
  onChange,
  placeholder,
  value,
}: {
  id: string
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        <span className="text-destructive">*</span>
      </FieldLabel>
      <Textarea
        className="min-h-36 resize-y text-base leading-7"
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </Field>
  )
}

function RunInspector({
  inputChecks,
  isCancellingTask,
  isSubmitting,
  onCancelTask,
  onRetryResult,
  result,
  resultFetchError,
  task,
  taskActionError,
  template,
}: {
  inputChecks: Array<{ label: string; complete: boolean }>
  isCancellingTask: boolean
  isSubmitting: boolean
  onCancelTask: () => void
  onRetryResult: () => void
  result: GenerationResult | null
  resultFetchError: string | null
  task: GenerationTask | null
  taskActionError: string | null
  template: ProductionTemplate
}) {
  const run = productionRunViewModel({
    isSubmitting,
    result,
    task,
    template,
  })

  if (!run) {
    return (
      <aside className="lg:sticky lg:top-5 lg:self-start">
        <WorkspacePanel
          description={`需要准备：${productionInputSummary(template)}`}
          title="提交前检查"
        >
          <div className="divide-y">
            {inputChecks.map((item) => (
              <div
                className="flex min-h-12 items-center gap-3 py-2"
                key={item.label}
              >
                {item.complete ? (
                  <span className="flex size-6 items-center justify-center rounded-full bg-success/10 text-success">
                    <Check className="size-3.5" />
                  </span>
                ) : (
                  <span className="flex size-6 items-center justify-center text-muted-foreground">
                    <Circle className="size-4" />
                  </span>
                )}
                <span
                  className={cn(
                    "text-sm",
                    !item.complete && "text-muted-foreground"
                  )}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">
            生成流程、执行位置和质量策略由当前模板提供。
          </p>
        </WorkspacePanel>
      </aside>
    )
  }

  const videoUrl = artifactFileUrl(result?.primary_video)
  const qualitySummary = buildQualitySummary(
    result?.metadata?.quality_review as QualityReviewInput | undefined
  )
  const assetManifest = result?.metadata?.asset_manifest as
    AssetManifestInput | undefined
  const assetItems = buildAssetItems(assetManifest)
  const assetCount = assetManifest?.assets?.length ?? assetItems.length

  const resultDetails = result ? (
    <div className="flex flex-col gap-4">
      <Button asChild className="min-h-11" size="lg">
        <a href={routeHref(`/library?task=${result.task_id}`)}>
          <Send data-icon="inline-start" />
          前往发布
        </a>
      </Button>

      <div className="grid gap-3 sm:grid-cols-2">
        <Fact label="生产模板" value={template.display_name} />
        <Fact label="时长" value={formatDuration(result.duration)} />
        <Fact label="文件大小" value={formatBytes(result.file_size)} />
        <Fact label="发布判断" value={qualitySummary.label} />
      </div>

      <Separator />

      <section aria-labelledby="special-quality-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium" id="special-quality-title">
            质量检查
          </h3>
          <QualityBadge summary={qualitySummary} />
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {qualitySummary.summary}
        </p>
        <QualityMessages
          failures={qualitySummary.failures}
          warnings={qualitySummary.warnings}
        />
      </section>

      <Separator />

      <section aria-labelledby="special-assets-title">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium" id="special-assets-title">
            素材记录
          </h3>
          <Badge variant="outline">
            {assetCount > 0 ? `${assetCount} 项` : "未返回"}
          </Badge>
        </div>
        {assetItems.length > 0 ? (
          <div className="mt-3 divide-y border-y">
            {assetItems.map((asset, index) => (
              <div
                className="flex items-start justify-between gap-3 py-3"
                key={`${asset.label}-${index}`}
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium">{asset.label}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {asset.kind}
                  </div>
                </div>
                <Badge
                  variant={
                    asset.statusLabel === "缺失" ? "destructive" : "outline"
                  }
                >
                  {asset.statusLabel}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            后端未返回独立素材记录。
          </p>
        )}
      </section>

      <TechDetails
        items={[{ label: "成品路径", value: result.primary_video?.path }]}
      />
    </div>
  ) : null

  return (
    <SingleTaskPanel
      actionError={taskActionError}
      artifactError={
        result && !videoUrl
          ? "成品已生成，但当前结果没有可用的视频地址。"
          : null
      }
      isCancelling={isCancellingTask}
      onCancel={onCancelTask}
      onRetryResult={onRetryResult}
      resultDetails={resultDetails}
      resultFetchError={resultFetchError}
      run={run}
      runDetails={
        task ? (
          <TechDetails
            items={[
              { label: "生成链路", value: task.pipeline_id },
              { label: "当前阶段", value: task.progress.stage },
              ...buildProgressRuntimeItems(task.progress.detail),
              {
                label: "失败层级",
                value: task.status === "failed" ? task.error?.layer : null,
              },
            ]}
          />
        ) : null
      }
    />
  )
}

function BatchInspector({
  files,
  prompt,
  title,
}: {
  files: File[]
  prompt: string
  title: string
}) {
  return (
    <aside className="lg:sticky lg:top-5 lg:self-start">
      <WorkspacePanel
        description="每张图一个任务，失败项可以单独重试。"
        title="批量提交"
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
          <div>
            <dt className="text-xs text-muted-foreground">预计任务</dt>
            <dd className="mt-1 text-lg font-medium">{files.length}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">成品</dt>
            <dd className="mt-1 text-sm font-medium">视频</dd>
          </div>
          <div className="col-span-2 border-t pt-3">
            <dt className="text-xs text-muted-foreground">共用运动描述</dt>
            <dd className="mt-1 line-clamp-3 text-sm leading-6">
              {prompt.trim() || "尚未填写"}
            </dd>
          </div>
          {title.trim() ? (
            <div className="col-span-2 border-t pt-3">
              <dt className="text-xs text-muted-foreground">共用标题</dt>
              <dd className="mt-1 text-sm font-medium">{title.trim()}</dd>
            </div>
          ) : null}
        </dl>
      </WorkspacePanel>
    </aside>
  )
}

function ModeNavigation({
  currentMode,
  currentTemplate,
  templates,
}: {
  currentMode: SpecialPipelineMode
  currentTemplate: ProductionTemplate
  templates: ProductionTemplate[]
}) {
  return (
    <nav
      aria-label="专用生产模式"
      className="flex min-w-0 gap-2 overflow-x-auto pb-1"
    >
      {SPECIAL_PIPELINE_MODES.map((mode) => {
        const target =
          mode === currentMode
            ? currentTemplate
            : preferredSpecialTemplate(templates, mode)
        const active = mode === currentMode
        return target ? (
          <a
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 shrink-0 items-center rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "border-primary/30 bg-primary/10 text-primary"
                : "bg-background hover:bg-muted"
            )}
            href={routeHref(specialTemplatePath(mode, target.id))}
            key={mode}
          >
            {SPECIAL_MODE_COPY[mode].label}
          </a>
        ) : (
          <span
            aria-disabled="true"
            className="flex min-h-11 shrink-0 items-center rounded-lg border px-3 text-sm text-muted-foreground opacity-50"
            key={mode}
          >
            {SPECIAL_MODE_COPY[mode].label}
          </span>
        )
      })}
    </nav>
  )
}

function RecipeNavigation({
  currentTemplate,
  mode,
  templates,
}: {
  currentTemplate: ProductionTemplate
  mode: SpecialPipelineMode
  templates: ProductionTemplate[]
}) {
  return (
    <div className="mt-3 border-t pt-3">
      <div className="mb-2 text-xs text-muted-foreground">当前模式的模板</div>
      <nav
        aria-label="选择专用生产模板"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {templates.map((template) => {
          const active = template.id === currentTemplate.id
          return (
            <a
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 shrink-0 items-center rounded-lg px-3 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
              href={routeHref(specialTemplatePath(mode, template.id))}
              key={template.id}
            >
              {template.display_name}
            </a>
          )
        })}
      </nav>
    </div>
  )
}

function SubmitButton({
  canSubmit,
  className,
  describedBy,
  form,
  inBatch,
  isSubmitting,
  label,
}: {
  canSubmit: boolean
  className?: string
  describedBy?: string
  form: string
  inBatch: boolean
  isSubmitting: boolean
  label: string
}) {
  return (
    <Button
      aria-describedby={describedBy}
      className={className}
      disabled={!canSubmit}
      form={form}
      size="lg"
      type="submit"
    >
      {isSubmitting ? (
        <Loader2 className="animate-spin" data-icon="inline-start" />
      ) : inBatch ? (
        <Layers data-icon="inline-start" />
      ) : (
        <Play data-icon="inline-start" />
      )}
      {label}
    </Button>
  )
}

function SpecialStateShell({
  children,
  mode,
}: {
  children: React.ReactNode
  mode: SpecialPipelineMode
}) {
  return (
    <PageFrame>
      <BackLink />
      <WorkspaceHeader
        description="使用专用素材和生产模板生成视频。"
        headingLevel={2}
        title={SPECIAL_MODE_COPY[mode].label}
      />
      {children}
    </PageFrame>
  )
}

function ResolutionError({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <AsyncState
      action={
        <Button asChild size="sm" variant="outline">
          <a href={routeHref("/create")}>
            <ArrowLeft data-icon="inline-start" />
            返回快速生产
          </a>
        </Button>
      }
      description={description}
      state="error"
      title={title}
    />
  )
}

function BackLink() {
  return (
    <Button
      asChild
      className="min-h-11 self-start px-0 sm:min-h-8"
      variant="ghost"
    >
      <a href={routeHref("/create")}>
        <ArrowLeft data-icon="inline-start" />
        快速生产
      </a>
    </Button>
  )
}

async function uploadModeAssets({
  mode,
  digitalMode,
  imageFiles,
  referenceVideoFiles,
  characterFiles,
  goodsFiles,
}: {
  mode: SpecialPipelineMode
  digitalMode: DigitalHumanMode
  imageFiles: File[]
  referenceVideoFiles: File[]
  characterFiles: File[]
  goodsFiles: File[]
}) {
  if (mode === "image_to_video") {
    const images = await uploadGenerationAssets(imageFiles.slice(0, 1))
    return {
      images: images.assets.map((asset) => asset.path),
      referenceVideos: [],
      characters: [],
      goods: [],
    }
  }

  if (mode === "action_transfer") {
    const [videos, images] = await Promise.all([
      uploadGenerationAssets(referenceVideoFiles.slice(0, 1)),
      uploadGenerationAssets(imageFiles.slice(0, 1)),
    ])
    return {
      images: images.assets.map((asset) => asset.path),
      referenceVideos: videos.assets.map((asset) => asset.path),
      characters: [],
      goods: [],
    }
  }

  const [characters, goods] = await Promise.all([
    uploadGenerationAssets(characterFiles.slice(0, 1)),
    digitalMode === "digital"
      ? uploadGenerationAssets(goodsFiles.slice(0, 1))
      : Promise.resolve({ assets: [] }),
  ])
  return {
    images: [],
    referenceVideos: [],
    characters: characters.assets.map((asset) => asset.path),
    goods: goods.assets.map((asset) => asset.path),
  }
}

function buildInputChecks({
  mode,
  digitalMode,
  imageFiles,
  referenceVideoFiles,
  characterFiles,
  goodsFiles,
  prompt,
  script,
  goodsTitle,
}: {
  mode: SpecialPipelineMode
  digitalMode: DigitalHumanMode
  imageFiles: File[]
  referenceVideoFiles: File[]
  characterFiles: File[]
  goodsFiles: File[]
  prompt: string
  script: string
  goodsTitle: string
}) {
  if (mode === "image_to_video") {
    return [
      { label: "起始图片", complete: imageFiles.length > 0 },
      { label: "运动描述", complete: Boolean(prompt.trim()) },
    ]
  }
  if (mode === "action_transfer") {
    return [
      {
        label: "参考动作视频",
        complete: referenceVideoFiles.length > 0,
      },
      { label: "目标人物图", complete: imageFiles.length > 0 },
      { label: "效果描述", complete: Boolean(prompt.trim()) },
    ]
  }
  const checks = [{ label: "角色图", complete: characterFiles.length > 0 }]
  if (digitalMode === "digital") {
    checks.push(
      { label: "商品图", complete: goodsFiles.length > 0 },
      {
        label: "商品标题或讲解文案",
        complete: Boolean(script.trim() || goodsTitle.trim()),
      }
    )
  } else {
    checks.push({ label: "口播文案", complete: Boolean(script.trim()) })
  }
  return checks
}
