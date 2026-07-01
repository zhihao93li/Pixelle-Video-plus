import { useEffect, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Copy,
  FileText,
  Loader2,
  Play,
  RefreshCcw,
  Video,
  XCircle,
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
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  ApiError,
  artifactFileUrl,
  createDailyVideoTask,
  getTask,
  getTaskResult,
  isTerminalStatus,
  listTemplates,
  type GenerationResult,
  type GenerationTask,
  type ProductionTemplate,
} from "@/lib/generationApi"
import {
  buildAssetItems,
  buildQualitySummary,
  type AssetManifestInput,
  type QualityReviewInput,
} from "@/lib/resultSummary"
import { cn } from "@/lib/utils"

const DAILY_TEMPLATE_ID = "petwoods_xhs_daily_v1"
const sampleScript =
  "母猫配完以后还一直叫，不一定说明没有配上。发情期的激素变化不会马上停止，所以它可能还会持续叫几天。真正判断有没有配上，要看后续有没有再次发情、精神食欲是否正常，以及是否需要在合适时间做检查。"

type LoadState = "loading" | "ready" | "error"

export function ProductionStudio() {
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [template, setTemplate] = useState<ProductionTemplate | null>(null)
  const [script, setScript] = useState(sampleScript)
  const [task, setTask] = useState<GenerationTask | null>(null)
  const [result, setResult] = useState<GenerationResult | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const trimmedScript = script.trim()
  const templateCanSubmit = Boolean(
    template &&
      template.input_requirements.includes("script") &&
      !template.requires_user_assets
  )
  const canSubmit =
    loadState === "ready" &&
    templateCanSubmit &&
    trimmedScript.length > 0 &&
    !isSubmitting &&
    !(task && !isTerminalStatus(task.status))

  useEffect(() => {
    let cancelled = false

    async function loadTemplates() {
      setLoadState("loading")
      setTemplatesError(null)
      try {
        const response = await listTemplates()
        if (cancelled) {
          return
        }

        const defaultId = response.default_template || DAILY_TEMPLATE_ID
        const selected =
          response.templates.find((item) => item.id === defaultId) ??
          response.templates.find((item) => item.id === DAILY_TEMPLATE_ID) ??
          null

        if (!selected) {
          setLoadState("error")
          setTemplatesError("没有找到可用于 P0 的日常生成模板。")
          return
        }

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
    setTask(null)
    setResult(null)

    try {
      const response = await createDailyVideoTask(template.id, trimmedScript)
      setTask(response.task)
    } catch (error) {
      setSubmitError(readableError(error))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <TooltipProvider>
      <div className="min-h-svh bg-muted/30 text-foreground">
        <header className="border-b bg-background px-4 py-4 lg:px-6">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Video className="size-4" />
                PetWoods 小红书日常短视频 v1
              </div>
              <h1 className="mt-1 text-2xl font-semibold">
                用已确认文案生成视频
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">真实后端生成</Badge>
              <Badge variant="outline">只提交文案</Badge>
            </div>
          </div>
        </header>

        <main className="mx-auto grid max-w-[1240px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:p-6">
          <section className="flex min-w-0 flex-col gap-5">
            <TemplateCard
              error={templatesError}
              loadState={loadState}
              onReload={() => window.location.reload()}
              template={template}
              templateCanSubmit={templateCanSubmit}
            />

            <Card className="rounded-lg">
              <CardHeader className="border-b">
                <CardTitle>1. 填入已确认文案</CardTitle>
                <CardDescription>
                  这里不会生成选题，也不会重写文案。提交后会直接进入当前视频模板。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field data-invalid={!trimmedScript && script.length > 0}>
                    <FieldLabel htmlFor="script">视频文案</FieldLabel>
                    <Textarea
                      aria-invalid={!trimmedScript && script.length > 0}
                      className="min-h-52 resize-y text-base leading-7"
                      id="script"
                      onChange={(event) => setScript(event.target.value)}
                      value={script}
                    />
                    <FieldDescription>
                      这段文字会进入当前日常视频模板，后端负责拆分、配音、画面生成和合成。
                    </FieldDescription>
                  </Field>
                </FieldGroup>

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
                    ) : (
                      <Play data-icon="inline-start" />
                    )}
                    {isSubmitting ? "提交中" : "创建真实生成任务"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

          <TaskPanel
            pollError={pollError}
            result={result}
            task={task}
            template={template}
          />
        </main>
      </div>
    </TooltipProvider>
  )
}

function TemplateCard({
  loadState,
  template,
  templateCanSubmit,
  error,
  onReload,
}: {
  loadState: LoadState
  template: ProductionTemplate | null
  templateCanSubmit: boolean
  error: string | null
  onReload: () => void
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>当前真实生成方式</CardTitle>
        <CardDescription>
          当前只开放一种稳定入口：把已确认文案交给日常短视频模板生成。
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
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {template.description}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="输入" value={template.input_requirements.join(", ")} />
              <Fact label="生成方式" value={template.runtime_label} />
              <Fact label="预计耗时" value={template.estimated_turnaround} />
            </div>

            {!templateCanSubmit && (
              <InlineError
                title="模板不能用于 P0"
                message="当前页面只支持不需要额外素材、并且可以直接用文案生成的视频模板。"
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TaskPanel({
  task,
  result,
  template,
  pollError,
}: {
  task: GenerationTask | null
  result: GenerationResult | null
  template: ProductionTemplate | null
  pollError: string | null
}) {
  const videoUrl = artifactFileUrl(result?.primary_video)
  const qualitySummary = buildQualitySummary(
    result?.metadata?.quality_review as QualityReviewInput | undefined
  )
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
              提交文案后，这里会显示真实
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
