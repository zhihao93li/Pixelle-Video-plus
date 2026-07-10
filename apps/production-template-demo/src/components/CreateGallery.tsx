import { useEffect, useState } from "react"
import {
  ArrowRight,
  Loader2,
  Plus,
  RefreshCcw,
  SlidersHorizontal,
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
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { InlineError } from "@/components/shared/feedback"
import { useToast } from "@/components/ui/toast"
import { PART_KEY_LABELS } from "@/lib/pipelineParts"
import { readableError } from "@/lib/format"
import { navigate } from "@/lib/router"
import { useCurrentProject } from "@/lib/currentProject"
import {
  cloneProductionTemplate,
  getTemplateGenerationConfig,
  listTemplates,
  type ProductionTemplate,
} from "@/lib/generationApi"
import { isRetiredTemplate, templateRoute } from "@/lib/templatePresentation"

/**
 * 快速生产页 v3（2026-07-07 用户批准方案）：
 * 产线板块（直跑三管线合并陈列）→ 板块内配方卡（成品语言、项目默认徽标、
 * 已自定义摘要）→ 板块头「+ 新建配方」（直跑先选输入形态，创建后直开产线换零件）
 * → 流程入口降级为列表条。选机身=选板块，套模板=点卡，自己调=新建/看产线。
 */

type LoadState = "loading" | "ready" | "error"

const INPUT_LABELS: Record<string, string> = {
  script: "文案",
  topic: "选题",
  assets: "素材",
  image: "图片",
  video: "视频",
  prompt: "提示词",
  reference_video: "参考动作视频",
  character_assets: "角色图",
}

function inputLabel(requirements: string[]) {
  return requirements.map((item) => INPUT_LABELS[item] ?? item).join("＋")
}

const FLOW_ENTRIES = new Set(["script_review"])

function isFlowEntry(template: ProductionTemplate) {
  return FLOW_ENTRIES.has(template.product_entry)
}

/** 产线板块（陈列层家族）：直跑三条管线合并为一个板块。 */
type Family = {
  id: string
  label: string
  tagline: string
  pipelineIds: string[]
  /** 「+ 新建配方」的克隆源；多个时需先选输入形态。 */
  newSources: { pipelineId: string; skeletonId: string; label: string }[]
}

const FAMILIES: Family[] = [
  {
    id: "standard",
    label: "标准线",
    tagline: "文案 → 分镜 → 配音 → 画面 → 成片",
    pipelineIds: ["standard"],
    newSources: [
      {
        pipelineId: "standard",
        skeletonId: "pipeline_standard_base_v1",
        label: "标准线",
      },
    ],
  },
  {
    id: "asset",
    label: "素材线",
    tagline: "你的照片视频 → AI 组织成片",
    pipelineIds: ["asset_based"],
    newSources: [
      {
        pipelineId: "asset_based",
        skeletonId: "pipeline_asset_based_base_v1",
        label: "素材线",
      },
    ],
  },
  {
    id: "image_post",
    label: "图文线",
    tagline: "文案 → 每段一页配图 → 图集帖",
    pipelineIds: ["image_post"],
    newSources: [
      {
        pipelineId: "image_post",
        skeletonId: "pipeline_image_post_base_v1",
        label: "图文线",
      },
    ],
  },
  {
    id: "long_form",
    label: "长文线",
    tagline: "确认稿 → 结构化长文（纯文字）",
    pipelineIds: ["long_form"],
    newSources: [
      {
        pipelineId: "long_form",
        skeletonId: "pipeline_long_form_base_v1",
        label: "长文线",
      },
    ],
  },
  {
    id: "direct",
    label: "Workflow 直跑",
    tagline: "素材进 → 跑一个工作流 → 视频出",
    pipelineIds: ["i2v", "action_transfer", "digital_human"],
    newSources: [
      {
        pipelineId: "i2v",
        skeletonId: "pixelle_i2v_basic_v1",
        label: "图片生成视频",
      },
      {
        pipelineId: "action_transfer",
        skeletonId: "pixelle_action_transfer_basic_v1",
        label: "动作迁移",
      },
      {
        pipelineId: "digital_human",
        skeletonId: "pixelle_digital_human_basic_v1",
        label: "数字人",
      },
    ],
  },
]

/** 配方卡：成品语言 + 项目默认徽标 + 已自定义摘要 + 开始制作/看产线。 */
function RecipeCard({
  template,
  isProjectDefault,
  customizedSummary,
}: {
  template: ProductionTemplate
  isProjectDefault: boolean
  customizedSummary: string | null
}) {
  const statusText = customizedSummary
    ? `已自定义：${customizedSummary}`
    : template.is_custom
      ? "我的配方"
      : "出厂配置"

  return (
    <div
      className={
        isProjectDefault
          ? "flex flex-col rounded-lg border-2 border-primary/50 bg-background p-3.5"
          : "flex flex-col rounded-lg border bg-background p-3.5"
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-6">
          {template.display_name}
        </span>
        {isProjectDefault && <Badge variant="secondary">项目默认</Badge>}
      </div>
      <p className="mt-1 flex-1 text-sm leading-6 text-muted-foreground">
        {template.description}
      </p>
      <div className="mt-2 text-xs text-muted-foreground">
        需要{inputLabel(template.input_requirements)} · {statusText}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          className="flex-1"
          onClick={() => navigate(templateRoute(template))}
          size="sm"
        >
          开始制作
          <ArrowRight data-icon="inline-end" />
        </Button>
        <Button
          aria-label="看产线"
          onClick={() => navigate(`/create/recipes/${template.id}`)}
          size="sm"
          variant="outline"
        >
          <SlidersHorizontal />
        </Button>
      </div>
    </div>
  )
}

/** 板块头的「+ 新建配方」：起名（直跑先选输入形态）→ 克隆骨架 → 直开产线。 */
function NewRecipeForm({
  family,
  onCreated,
  onCancel,
}: {
  family: Family
  onCreated: (template: ProductionTemplate) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState("")
  const [sourceId, setSourceId] = useState(
    family.newSources.length === 1 ? family.newSources[0].skeletonId : ""
  )
  const [busy, setBusy] = useState(false)

  async function create() {
    const displayName = name.trim()
    const source = family.newSources.find(
      (item) => item.skeletonId === sourceId
    )
    if (!displayName || !source) {
      return
    }
    setBusy(true)
    try {
      const template = await cloneProductionTemplate({
        sourceTemplateId: source.skeletonId,
        id: `my_${source.pipelineId}_${Date.now().toString(36)}`,
        displayName,
      })
      toast({
        title: `「${displayName}」已创建`,
        description: "接下来换零件，调成你要的效果。",
        variant: "success",
      })
      onCreated(template)
    } catch (error) {
      toast({
        title: "创建失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
      {family.newSources.length > 1 && (
        <Select onValueChange={setSourceId} value={sourceId || undefined}>
          <SelectTrigger aria-label="输入形态" className="h-8 w-44">
            <SelectValue placeholder="基于哪种玩法" />
          </SelectTrigger>
          <SelectContent>
            {family.newSources.map((source) => (
              <SelectItem key={source.skeletonId} value={source.skeletonId}>
                {source.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Input
        autoFocus
        className="h-8 w-52"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            void create()
          }
        }}
        placeholder="给新配方起个名字"
        value={name}
      />
      <Button
        disabled={busy || !name.trim() || !sourceId}
        onClick={() => void create()}
        size="sm"
      >
        {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
        创建并换零件
      </Button>
      <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost">
        取消
      </Button>
    </div>
  )
}

export function CreateGallery() {
  const { project } = useCurrentProject()
  const [loadState, setLoadState] = useState<LoadState>("loading")
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [reloadToken, setReloadToken] = useState(0)
  const [newRecipeFamily, setNewRecipeFamily] = useState<string | null>(null)
  // 每张卡的「已自定义」摘要（模板 id → 差异零件人话列表）
  const [customized, setCustomized] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoadState("loading")
      setError(null)
      try {
        const response = await listTemplates()
        if (cancelled) {
          return
        }
        setTemplates(response.templates)
        setLoadState("ready")

        // 已自定义摘要：并行拉可见卡的默认配置（≤8 张，轻量 GET），失败静默。
        const visible = response.templates.filter(
          (template) =>
            template.enabled &&
            !isRetiredTemplate(template) &&
            !isFlowEntry(template)
        )
        const results = await Promise.allSettled(
          visible.map(async (template) => {
            const config = await getTemplateGenerationConfig(template.id)
            const keys = Object.keys(config.overrides)
            return [template.id, keys] as const
          })
        )
        if (cancelled) {
          return
        }
        const summary: Record<string, string> = {}
        for (const result of results) {
          if (result.status !== "fulfilled") {
            continue
          }
          const [id, keys] = result.value
          if (keys.length > 0) {
            summary[id] = keys
              .map((key) => PART_KEY_LABELS[key] ?? key)
              .join("、")
          }
        }
        setCustomized(summary)
      } catch (loadError) {
        if (!cancelled) {
          setError(readableError(loadError))
          setLoadState("error")
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const productTemplates = templates.filter(
    (template) =>
      template.enabled &&
      !isRetiredTemplate(template) &&
      !isFlowEntry(template)
  )
  const flowTemplates = templates.filter(isFlowEntry)
  const defaultTemplateId = project?.default_production_template_id || ""

  return (
    <main className="flex max-w-[1240px] flex-col gap-5 p-4 lg:p-6">
      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>产线与配方</CardTitle>
          <CardDescription>
            选一条产线，用现成配方直接做；或点「新建配方」，在这条产线上调一套自己的。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadState === "loading" && (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在读取配方
            </div>
          )}

          {loadState === "error" && (
            <div className="flex flex-col gap-3">
              <InlineError title="配方读取失败" message={error || "未知错误"} />
              <Button
                onClick={() => setReloadToken((token) => token + 1)}
                variant="outline"
              >
                <RefreshCcw data-icon="inline-start" />
                重试
              </Button>
            </div>
          )}

          {loadState === "ready" && (
            <div className="flex flex-col gap-6">
              {FAMILIES.map((family) => {
                const cards = productTemplates.filter((template) =>
                  family.pipelineIds.includes(template.pipeline_id)
                )
                if (cards.length === 0) {
                  return null
                }
                return (
                  <section key={family.id}>
                    <div className="mb-2.5 flex items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-semibold">
                          {family.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {family.tagline}
                        </span>
                      </div>
                      <Button
                        onClick={() =>
                          setNewRecipeFamily((current) =>
                            current === family.id ? null : family.id
                          )
                        }
                        size="sm"
                        variant="ghost"
                      >
                        <Plus data-icon="inline-start" />
                        新建配方
                      </Button>
                    </div>

                    {newRecipeFamily === family.id && (
                      <NewRecipeForm
                        family={family}
                        onCancel={() => setNewRecipeFamily(null)}
                        onCreated={(template) => {
                          setNewRecipeFamily(null)
                          // 直接落到新配方详情页换零件（不再弹抽屉）
                          navigate(`/create/recipes/${template.id}`)
                        }}
                      />
                    )}

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {cards.map((template) => (
                        <RecipeCard
                          customizedSummary={customized[template.id] ?? null}
                          isProjectDefault={template.id === defaultTemplateId}
                          key={template.id}
                          template={template}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}

              {flowTemplates.length > 0 && (
                <section>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">
                    流程入口
                  </div>
                  <div className="overflow-hidden rounded-lg border">
                    {flowTemplates.map((template, index) => (
                      <button
                        className={
                          index > 0
                            ? "flex w-full items-center justify-between gap-3 border-t px-4 py-3 text-left transition-colors hover:bg-muted/40"
                            : "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                        }
                        key={template.id}
                        onClick={() => navigate(templateRoute(template))}
                        type="button"
                      >
                        <span className="min-w-0">
                          <span className="text-sm font-medium">
                            {template.display_name}
                          </span>
                          <span className="ml-2.5 text-xs text-muted-foreground">
                            {template.description}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
