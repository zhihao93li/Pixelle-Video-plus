import { useEffect, useMemo, useState } from "react"
import { Layers, Loader2, Play } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BatchStatusCard } from "@/components/shared/BatchStatusCard"
import { FileDropzone } from "@/components/shared/FileDropzone"
import { InlineError } from "@/components/shared/feedback"
import { useToast } from "@/components/ui/toast"
import { artifactKindLabel, templateArtifactType } from "@/lib/artifactKind"
import { useCurrentProject } from "@/lib/currentProject"
import { readableError } from "@/lib/format"
import { useTaskCenter } from "@/lib/taskCenter"
import { trackBatchTasks } from "@/lib/trackBatch"
import { useBatchPolling } from "@/lib/useBatchPolling"
import {
  artifactFileUrl,
  cancelGenerationTask,
  createGenerationBatch,
  createGenerationTemplateTask,
  getTask,
  getTaskResult,
  isTerminalStatus,
  listTemplates,
  uploadGenerationAssets,
  type GenerationResult,
  type GenerationTask,
  type ProductionTemplate,
} from "@/lib/generationApi"
import { buildProgressRuntimeItems } from "@/lib/resultSummary"
import { cn } from "@/lib/utils"

export type SpecialPipelineMode = "image_to_video" | "action_transfer" | "digital_human"

const modeLabels: Record<SpecialPipelineMode, string> = {
  image_to_video: "图片生成视频",
  action_transfer: "动作迁移视频",
  digital_human: "数字人视频",
}
export function SpecialPipelinesWorkspace({
  initialMode = "image_to_video",
}: {
  initialMode?: SpecialPipelineMode
}) {
  const [mode, setMode] = useState<SpecialPipelineMode>(initialMode)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [referenceVideoFiles, setReferenceVideoFiles] = useState<File[]>([])
  const [characterFiles, setCharacterFiles] = useState<File[]>([])
  const [goodsFiles, setGoodsFiles] = useState<File[]>([])
  const [prompt, setPrompt] = useState("让画面自然动起来，保持真实宠物生活氛围。")
  const [title, setTitle] = useState("")
  const [duration, setDuration] = useState(0)
  const [digitalMode, setDigitalMode] = useState<"customize" | "digital">("customize")
  const [script, setScript] = useState("")
  const [goodsTitle, setGoodsTitle] = useState("")
  const [ttsVoice, setTtsVoice] = useState("zh-CN-YunjianNeural")
  const [ttsSpeed, setTtsSpeed] = useState(1.2)
  const [task, setTask] = useState<GenerationTask | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCancellingTask, setIsCancellingTask] = useState(false)
  const [taskActionError, setTaskActionError] = useState<string | null>(null)
  // i2v 批量提交模式（本页内存态）
  const [batchMode, setBatchMode] = useState(false)
  const {
    batch: submittedBatch,
    setBatch: setSubmittedBatch,
    retryItem: retryBatchItem,
    retryingItemIndex: retryingBatchIndex,
  } = useBatchPolling()
  const taskCenter = useTaskCenter()
  const toast = useToast()
  const { projectId } = useCurrentProject()

  const template = useMemo(
    () => templates.find((item) => item.use_case === mode) ?? null,
    [mode, templates]
  )
  // 批量只对 i2v 开放（多输入配对的动作迁移/数字人本期不做）
  const isI2v = mode === "image_to_video"
  const inBatch = batchMode && isI2v
  const i2vArtifactLabel = artifactKindLabel(templateArtifactType(template?.pipeline_id))
  const canSubmit = Boolean(template?.enabled) && hasRequiredInput({
    characterFiles,
    digitalMode,
    goodsFiles,
    goodsTitle,
    imageFiles,
    mode,
    prompt,
    referenceVideoFiles,
    script,
  }) && !isSubmitting && !(task && !isTerminalStatus(task.status))

  useEffect(() => {
    let cancelled = false

    listTemplates()
      .then((response) => {
        if (!cancelled) {
          setTemplates(response.templates)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setTemplatesError(readableError(error))
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!task || isTerminalStatus(task.status)) {
      return
    }
    const timer = window.setInterval(() => {
      void getTask(task.task_id)
        .then((latest) => {
          setTask(latest)
          setPollError(null)
        })
        .catch((error) => setPollError(readableError(error)))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [task])

  useEffect(() => {
    if (!task || task.status !== "completed" || result?.task_id === task.task_id) {
      return
    }
    let cancelled = false
    void getTaskResult(task.task_id)
      .then((taskResult) => {
        if (!cancelled) {
          setResult(taskResult)
          setPollError(null)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPollError(readableError(error))
        }
      })
    return () => {
      cancelled = true
    }
  }, [result?.task_id, task])

  async function submitSpecialTask() {
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
      const input = await buildTemplateInput({
        characterFiles,
        digitalMode,
        duration,
        goodsFiles,
        goodsTitle,
        imageFiles,
        mode,
        prompt,
        referenceVideoFiles,
        script,
        title,
        ttsSpeed,
        ttsVoice,
      })
      const response = await createGenerationTemplateTask(template.id, input, {
        source: "react_special_pipeline",
        template_use_case: template.use_case,
      })
      setTask(response.task)
      taskCenter.trackTask(response.task, template.display_name)
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitI2vBatch() {
    if (!template || imageFiles.length === 0 || isSubmitting) {
      return
    }
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      // 多图上传 → 每张图一条任务，提示词/标题作共享参数
      const uploaded = await uploadGenerationAssets(imageFiles)
      const trimmedPrompt = prompt.trim()
      const trimmedTitle = title.trim()
      const items = uploaded.assets.map((asset) => ({
        input: {
          assets: [asset.path],
          prompt: trimmedPrompt,
          ...(trimmedTitle ? { title: trimmedTitle } : {}),
        },
      }))
      const response = await createGenerationBatch({
        templateId: template.id,
        items,
        metadata: { source: "react_generate_batch", mode: "fixed" },
        projectId: projectId ?? undefined,
      })
      setSubmittedBatch(response)
      toast({
        title: `批量任务已创建（${response.total_count} 条）`,
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
      setTask(latest)
      setPollError(null)
    } catch (error) {
      setTaskActionError(readableError(error))
    } finally {
      setIsCancellingTask(false)
    }
  }

  return (
    <main className="grid max-w-[1240px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_400px] lg:p-6">
      <section className="flex min-w-0 flex-col gap-5">
        <Card className="rounded-lg">
          <CardHeader className="border-b">
            <CardTitle>特殊生成</CardTitle>
            <CardDescription>
              图生视频、动作迁移和数字人口播，上传素材即可生成。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(modeLabels) as SpecialPipelineMode[]).map((item) => (
                  <Button
                    key={item}
                    onClick={() => {
                      setMode(item)
                      setSubmitError(null)
                    }}
                    type="button"
                    variant={mode === item ? "default" : "outline"}
                  >
                    {modeLabels[item]}
                  </Button>
                ))}
              </div>

              {templatesError && (
                <InlineError title="模板读取失败" message={templatesError} />
              )}

              <TemplateSummary template={template} />

              {isI2v && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-muted-foreground">
                    {inBatch
                      ? `${imageFiles.length} 张图 → ${imageFiles.length} 个任务，参数全同`
                      : "一张图生成一条视频"}
                  </span>
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
                </div>
              )}

              {mode === "image_to_video" ? (
                <ImageToVideoForm
                  files={imageFiles}
                  onFilesChange={setImageFiles}
                  onPromptChange={setPrompt}
                  onTitleChange={setTitle}
                  prompt={prompt}
                  title={title}
                />
              ) : mode === "action_transfer" ? (
                <ActionTransferForm
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
                <DigitalHumanForm
                  characterFiles={characterFiles}
                  digitalMode={digitalMode}
                  goodsFiles={goodsFiles}
                  goodsTitle={goodsTitle}
                  onCharacterFilesChange={setCharacterFiles}
                  onDigitalModeChange={setDigitalMode}
                  onGoodsFilesChange={setGoodsFiles}
                  onGoodsTitleChange={setGoodsTitle}
                  onScriptChange={setScript}
                  onTitleChange={setTitle}
                  onTtsSpeedChange={setTtsSpeed}
                  onTtsVoiceChange={setTtsVoice}
                  script={script}
                  title={title}
                  ttsSpeed={ttsSpeed}
                  ttsVoice={ttsVoice}
                />
              )}

              {submitError && <InlineError title="提交失败" message={submitError} />}

              <div className="flex justify-end">
                {inBatch ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        disabled={imageFiles.length === 0 || isSubmitting}
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
                          : `批量生成 ${imageFiles.length} 条视频`}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          批量生成 {imageFiles.length} 条视频？
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          每张图会占用一次生成额度，提交后可在下方与「任务」页跟踪进度、失败可单条重试。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>再检查一下</AlertDialogCancel>
                        <AlertDialogAction
                          className={cn(buttonVariants({ variant: "default" }))}
                          onClick={() => void submitI2vBatch()}
                        >
                          确认提交
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button
                    disabled={!canSubmit}
                    onClick={() => void submitSpecialTask()}
                  >
                    {isSubmitting ? (
                      <Loader2 className="animate-spin" data-icon="inline-start" />
                    ) : (
                      <Play data-icon="inline-start" />
                    )}
                    开始生成
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {inBatch && submittedBatch && (
          <BatchStatusCard
            artifactLabel={i2vArtifactLabel}
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
                每张图一个任务，共享上方提示词与标题；进度显示在左侧与「任务」页。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground">
                {imageFiles.length > 0
                  ? `已选 ${imageFiles.length} 张图`
                  : "上传多张图片开始批量。"}
              </div>
            </CardContent>
          </Card>
        </aside>
      ) : (
        <TaskPanel
          isCancellingTask={isCancellingTask}
          onCancelTask={cancelCurrentTask}
          pollError={pollError}
          result={result}
          task={task}
          taskActionError={taskActionError}
        />
      )}
    </main>
  )
}

function TemplateSummary({ template }: { template: ProductionTemplate | null }) {
  if (!template) {
    return (
      <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        正在读取生产模板。
      </div>
    )
  }
  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={template.enabled ? "secondary" : "destructive"}>
          {template.enabled ? "可用" : "暂不可用"}
        </Badge>
        <span className="font-medium">{template.display_name}</span>
      </div>
      <div className="mt-2 text-muted-foreground">{template.runtime_label}</div>
    </div>
  )
}

function ImageToVideoForm({
  files,
  prompt,
  title,
  onFilesChange,
  onPromptChange,
  onTitleChange,
}: {
  files: File[]
  prompt: string
  title: string
  onFilesChange: (files: File[]) => void
  onPromptChange: (value: string) => void
  onTitleChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <FileInput
        accept="image/*"
        files={files}
        label="图片"
        onChange={onFilesChange}
      />
      <TextInput label="标题" onChange={onTitleChange} value={title} />
      <PromptInput onChange={onPromptChange} value={prompt} />
    </div>
  )
}

function ActionTransferForm({
  duration,
  imageFiles,
  prompt,
  referenceVideoFiles,
  title,
  onDurationChange,
  onImageFilesChange,
  onPromptChange,
  onReferenceVideoFilesChange,
  onTitleChange,
}: {
  duration: number
  imageFiles: File[]
  prompt: string
  referenceVideoFiles: File[]
  title: string
  onDurationChange: (value: number) => void
  onImageFilesChange: (files: File[]) => void
  onPromptChange: (value: string) => void
  onReferenceVideoFilesChange: (files: File[]) => void
  onTitleChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <FileInput
        accept="video/*"
        files={referenceVideoFiles}
        label="参考动作视频"
        onChange={onReferenceVideoFilesChange}
      />
      <FileInput
        accept="image/*"
        files={imageFiles}
        label="目标图片"
        onChange={onImageFilesChange}
      />
      <TextInput label="标题" onChange={onTitleChange} value={title} />
      <NumberInput
        label="时长覆盖（秒，0 表示自动）"
        max={30}
        min={0}
        onChange={onDurationChange}
        value={duration}
      />
      <PromptInput onChange={onPromptChange} value={prompt} />
    </div>
  )
}

function DigitalHumanForm({
  characterFiles,
  digitalMode,
  goodsFiles,
  goodsTitle,
  script,
  title,
  ttsSpeed,
  ttsVoice,
  onCharacterFilesChange,
  onDigitalModeChange,
  onGoodsFilesChange,
  onGoodsTitleChange,
  onScriptChange,
  onTitleChange,
  onTtsSpeedChange,
  onTtsVoiceChange,
}: {
  characterFiles: File[]
  digitalMode: "customize" | "digital"
  goodsFiles: File[]
  goodsTitle: string
  script: string
  title: string
  ttsSpeed: number
  ttsVoice: string
  onCharacterFilesChange: (files: File[]) => void
  onDigitalModeChange: (mode: "customize" | "digital") => void
  onGoodsFilesChange: (files: File[]) => void
  onGoodsTitleChange: (value: string) => void
  onScriptChange: (value: string) => void
  onTitleChange: (value: string) => void
  onTtsSpeedChange: (value: number) => void
  onTtsVoiceChange: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => onDigitalModeChange("customize")}
          type="button"
          variant={digitalMode === "customize" ? "default" : "outline"}
        >
          自定义文案
        </Button>
        <Button
          onClick={() => onDigitalModeChange("digital")}
          type="button"
          variant={digitalMode === "digital" ? "default" : "outline"}
        >
          商品数字人
        </Button>
      </div>
      <FileInput
        accept="image/*"
        files={characterFiles}
        label="角色图"
        onChange={onCharacterFilesChange}
      />
      {digitalMode === "digital" && (
        <>
          <FileInput
            accept="image/*"
            files={goodsFiles}
            label="商品图"
            onChange={onGoodsFilesChange}
          />
          <TextInput label="商品标题" onChange={onGoodsTitleChange} value={goodsTitle} />
        </>
      )}
      <TextInput label="视频标题" onChange={onTitleChange} value={title} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          {digitalMode === "digital" ? "商品讲解文案（可选）" : "文案"}
        </span>
        <Textarea
          className="min-h-36 resize-y"
          onChange={(event) => onScriptChange(event.target.value)}
          placeholder={
            digitalMode === "digital"
              ? "不填时，会使用商品标题和商品图让数字人 workflow 自动生成文案。"
              : "输入要由数字人讲述的完整文案。"
          }
          value={script}
        />
        {digitalMode === "digital" && (
          <span className="text-xs leading-5 text-muted-foreground">
            商品模式下，商品标题或讲解文案至少填一个；不填讲解文案时走旧 Streamlit 的自动文案 workflow。
          </span>
        )}
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <TextInput label="TTS voice / reference_id" onChange={onTtsVoiceChange} value={ttsVoice} />
        <NumberInput
          label="语速"
          max={2}
          min={0.5}
          onChange={onTtsSpeedChange}
          step={0.1}
          value={ttsSpeed}
        />
      </div>
    </div>
  )
}

function FileInput({
  accept,
  files,
  label,
  onChange,
}: {
  accept: string
  files: File[]
  label: string
  onChange: (files: File[]) => void
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <FileDropzone
        accept={accept}
        files={files}
        id={`special-file-${label}`}
        onFilesChange={onChange}
      />
    </label>
  )
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  )
}

function NumberInput({
  label,
  max,
  min,
  step = 1,
  value,
  onChange,
}: {
  label: string
  max: number
  min: number
  step?: number
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value) || min)}
        step={step}
        type="number"
        value={value}
      />
    </label>
  )
}

function PromptInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">提示词</span>
      <Textarea
        className="min-h-32 resize-y"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  )
}

function TaskPanel({
  isCancellingTask,
  onCancelTask,
  task,
  result,
  pollError,
  taskActionError,
}: {
  isCancellingTask: boolean
  onCancelTask: () => void
  task: GenerationTask | null
  result: GenerationResult | null
  pollError: string | null
  taskActionError: string | null
}) {
  const videoUrl = artifactFileUrl(result?.primary_video)
  const progressRuntimeItems = buildProgressRuntimeItems(task?.progress.detail)
  return (
    <aside className="flex min-w-0 flex-col gap-5">
      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>任务状态</CardTitle>
          <CardDescription>只展示真实 API 返回的 task 状态。</CardDescription>
        </CardHeader>
        <CardContent>
          {!task ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              提交后会显示任务。
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={task.status === "failed" ? "destructive" : "secondary"}>
                  {task.status}
                </Badge>
                <Badge variant="outline">{task.progress.percentage}%</Badge>
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
              <div className="font-mono text-xs text-muted-foreground">
                {task.task_id}
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                {task.progress.stage || "pending"}
                {task.progress.message ? ` · ${task.progress.message}` : ""}
                {progressRuntimeItems.length > 0 && (
                  <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
                    {progressRuntimeItems.map((item) => (
                      <div key={item.label} className="min-w-0">
                        <div className="text-[11px] text-muted-foreground">
                          {item.label}
                        </div>
                        <div className="truncate font-mono text-xs">{item.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {task.error && (
                <InlineError
                  title={`失败层级：${task.error.layer}`}
                  message={task.error.message}
                />
              )}
            </div>
          )}
          {pollError && <InlineError title="状态刷新失败" message={pollError} />}
          {taskActionError && (
            <InlineError title="任务操作失败" message={taskActionError} />
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>生成结果</CardTitle>
          <CardDescription>成功后显示成片和 artifact 信息。</CardDescription>
        </CardHeader>
        <CardContent>
          {videoUrl ? (
            <div className="flex flex-col gap-3">
              <video className="w-full rounded-lg border" controls src={videoUrl} />
              <a
                className="text-sm text-primary underline-offset-4 hover:underline"
                href={videoUrl}
                rel="noreferrer"
                target="_blank"
              >
                打开视频文件
              </a>
            </div>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              暂无结果。
            </div>
          )}
        </CardContent>
      </Card>
    </aside>
  )
}

async function buildTemplateInput({
  characterFiles,
  digitalMode,
  duration,
  goodsFiles,
  goodsTitle,
  imageFiles,
  mode,
  prompt,
  referenceVideoFiles,
  script,
  title,
  ttsSpeed,
  ttsVoice,
}: {
  characterFiles: File[]
  digitalMode: "customize" | "digital"
  duration: number
  goodsFiles: File[]
  goodsTitle: string
  imageFiles: File[]
  mode: SpecialPipelineMode
  prompt: string
  referenceVideoFiles: File[]
  script: string
  title: string
  ttsSpeed: number
  ttsVoice: string
}) {
  if (mode === "image_to_video") {
    const uploaded = await uploadGenerationAssets(imageFiles)
    return {
      assets: uploaded.assets.map((asset) => asset.path),
      prompt: prompt.trim(),
      title: title.trim(),
    }
  }

  if (mode === "action_transfer") {
    const [videos, images] = await Promise.all([
      uploadGenerationAssets(referenceVideoFiles),
      uploadGenerationAssets(imageFiles),
    ])
    return {
      reference_video: videos.assets[0]?.path,
      assets: images.assets.map((asset) => asset.path),
      prompt: prompt.trim(),
      duration: duration > 0 ? duration : undefined,
      title: title.trim(),
    }
  }

  const uploads = await Promise.all([
    uploadGenerationAssets(characterFiles),
    digitalMode === "digital" && goodsFiles.length > 0
      ? uploadGenerationAssets(goodsFiles)
      : Promise.resolve({ assets: [] }),
  ])
  return {
    character_assets: uploads[0].assets.map((asset) => asset.path),
    script: script.trim(),
    title: title.trim(),
    mode: digitalMode,
    goods_assets: uploads[1].assets.map((asset) => asset.path),
    goods_title: goodsTitle.trim(),
    tts_inference_mode: "local",
    tts_voice: ttsVoice.trim(),
    tts_speed: ttsSpeed,
  }
}

function hasRequiredInput({
  characterFiles,
  digitalMode,
  goodsFiles,
  goodsTitle,
  imageFiles,
  mode,
  prompt,
  referenceVideoFiles,
  script,
}: {
  characterFiles: File[]
  digitalMode: "customize" | "digital"
  goodsFiles: File[]
  goodsTitle: string
  imageFiles: File[]
  mode: SpecialPipelineMode
  prompt: string
  referenceVideoFiles: File[]
  script: string
}) {
  if (mode === "image_to_video") {
    return imageFiles.length > 0 && prompt.trim().length > 0
  }
  if (mode === "action_transfer") {
    return (
      referenceVideoFiles.length > 0 &&
      imageFiles.length > 0 &&
      prompt.trim().length > 0
    )
  }
  if (digitalMode === "customize") {
    return characterFiles.length > 0 && script.trim().length > 0
  }
  return (
    characterFiles.length > 0 &&
    goodsFiles.length > 0 &&
    (script.trim().length > 0 || goodsTitle.trim().length > 0)
  )
}
