import { useMemo, useState } from "react"
import {
  Archive,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Film,
  FolderKanban,
  HelpCircle,
  History,
  ImagePlus,
  Layers3,
  Loader2,
  Play,
  Settings2,
  Sparkles,
  UploadCloud,
  Video,
  WandSparkles,
  Workflow,
} from "lucide-react"

import {
  productionTemplates,
  recentTasks,
  seedAssets,
  type ProductionTemplate,
} from "@/data/productionTemplates"
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
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type GenerationState = "idle" | "running" | "done"

const sampleTopic =
  "母猫配完以后还一直叫，是不是说明没有配上？用宠物医生能听懂的方式解释。"

const navItems = [
  { label: "生成", icon: Workflow, active: true },
  { label: "模板", icon: Layers3, active: false },
  { label: "历史", icon: History, active: false },
  { label: "设置", icon: Settings2, active: false },
]

function ModeIcon({ templateId }: { templateId: string }) {
  if (templateId === "daily") {
    return <Video className="size-4" />
  }

  if (templateId === "explainer") {
    return <WandSparkles className="size-4" />
  }

  if (templateId === "asset") {
    return <ImagePlus className="size-4" />
  }

  if (templateId === "montage") {
    return <Film className="size-4" />
  }

  return <Workflow className="size-4" />
}

function Sidebar() {
  return (
    <aside className="hidden min-h-svh w-[232px] shrink-0 border-r bg-sidebar px-4 py-5 lg:flex lg:flex-col">
      <div className="flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold">Pixelle</div>
          <div className="text-xs text-muted-foreground">视频生成</div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border bg-background p-3">
        <div className="text-xs text-muted-foreground">当前项目</div>
        <div className="mt-1 flex items-center gap-2">
          <FolderKanban className="size-4 text-primary" />
          <span className="truncate text-sm font-medium">PetWoods 小红书</span>
        </div>
      </div>

      <nav className="mt-6 flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon

          return (
            <button
              className={cn(
                "flex h-9 items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors",
                item.active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
              key={item.label}
              type="button"
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="mt-auto rounded-lg border bg-background p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <BadgeCheck className="size-4 text-primary" />
          项目默认
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          日常更新会自动使用固定生产线，不需要每次重新配置工具。
        </p>
      </div>
    </aside>
  )
}

function Header({ defaultTemplate }: { defaultTemplate: ProductionTemplate }) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:px-6">
      <div className="mx-auto flex max-w-[1360px] flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>PetWoods 小红书</span>
            <ChevronRight className="size-3" />
            <span>生成视频</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold leading-tight">
            生成一条新视频
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <BadgeCheck data-icon="inline-start" />
            默认：{defaultTemplate.shortName}
          </Badge>
          <Badge variant="outline">草稿不会自动发布</Badge>
        </div>
      </div>
    </header>
  )
}

function StepHeader() {
  const steps = ["选视频类型", "输入内容", "确认生成"]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => (
        <div className="flex items-center gap-2" key={step}>
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full text-xs font-medium",
              index === 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            {index + 1}
          </span>
          <span
            className={cn(
              "text-sm",
              index === 0 ? "font-medium" : "text-muted-foreground"
            )}
          >
            {step}
          </span>
          {index < steps.length - 1 && (
            <ChevronRight className="size-3 text-muted-foreground" />
          )}
        </div>
      ))}
    </div>
  )
}

function ModePicker({
  selectedTemplateId,
  onSelect,
}: {
  selectedTemplateId: string
  onSelect: (templateId: string) => void
}) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <StepHeader />
            <CardTitle className="mt-5 text-xl">
              这条视频想怎么做？
            </CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              只选目标，不选底层工具。系统会按项目默认设置完成后面的制作。
            </CardDescription>
          </div>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">
                <HelpCircle data-icon="inline-start" />
                什么是生产线
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-lg">
              <SheetHeader>
                <SheetTitle>生产线不是让你配置工具</SheetTitle>
                <SheetDescription>
                  它是已经配置好的视频制作方式。你日常只换内容，声音、画幅、字幕、素材规则和质检默认保持一致。
                </SheetDescription>
              </SheetHeader>
              <div className="px-4">
                <div className="rounded-lg border bg-muted/30 p-4 text-sm leading-6">
                  日常使用时，Pixelle 应该像一个稳定的内容生产系统，而不是每次让你重新选择工具。
                </div>
              </div>
              <SheetFooter>
                <SheetClose asChild>
                  <Button>知道了</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2">
          {productionTemplates.map((template) => (
            <ModeCard
              key={template.id}
              onSelect={() => onSelect(template.id)}
              selected={selectedTemplateId === template.id}
              template={template}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ModeCard({
  template,
  selected,
  onSelect,
}: {
  template: ProductionTemplate
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex min-h-[128px] items-start gap-4 rounded-lg border bg-card p-4 text-left shadow-xs transition-all hover:border-primary/40 hover:bg-primary/5",
        selected && "border-primary bg-primary/5 ring-2 ring-primary/15"
      )}
      onClick={onSelect}
      type="button"
    >
      <span
        className={cn(
          "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground",
          selected && "border-primary/20 text-primary"
        )}
      >
        <ModeIcon templateId={template.id} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-base font-semibold leading-snug">
            {template.shortName}
          </span>
          {template.id === "daily" && <Badge variant="secondary">常用</Badge>}
          {template.requiresAssets && <Badge variant="outline">需要素材</Badge>}
        </span>
        <span className="mt-2 block text-sm leading-6 text-muted-foreground">
          {template.description}
        </span>
      </span>
    </button>
  )
}

function Composer({
  selectedTemplate,
  generationState,
  onGenerate,
}: {
  selectedTemplate: ProductionTemplate
  generationState: GenerationState
  onGenerate: () => void
}) {
  const [strictReview, setStrictReview] = useState(true)
  const needsAssets = selectedTemplate.requiresAssets

  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>讲什么内容？</CardTitle>
        <CardDescription>
          输入这条视频的核心内容。其它制作设置沿用当前生成方式。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="topic">
          <TabsList>
            <TabsTrigger value="topic">选题</TabsTrigger>
            <TabsTrigger value="script">文案</TabsTrigger>
            <TabsTrigger value="storyboard">分镜</TabsTrigger>
          </TabsList>
          <TabsContent className="mt-4" value="topic">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="topic">一句话说明这条视频</FieldLabel>
                <Textarea
                  className="min-h-36 resize-none text-base leading-7"
                  defaultValue={sampleTopic}
                  id="topic"
                />
                <FieldDescription>
                  选题可以很粗，系统会先补成适合账号的脚本。
                </FieldDescription>
              </Field>
            </FieldGroup>
          </TabsContent>
          <TabsContent className="mt-4" value="script">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="script">已经确认的文案</FieldLabel>
                <Textarea
                  className="min-h-36 resize-none text-base leading-7"
                  id="script"
                  placeholder="粘贴口播文案。系统不会重写你已经确认的内容。"
                />
                <FieldDescription>
                  适合你已经写好稿子，只需要视频化的情况。
                </FieldDescription>
              </Field>
            </FieldGroup>
          </TabsContent>
          <TabsContent className="mt-4" value="storyboard">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="storyboard">已有分镜</FieldLabel>
                <Textarea
                  className="min-h-36 resize-none text-base leading-7"
                  id="storyboard"
                  placeholder="写下每个镜头的字幕和想表达的画面。"
                />
                <FieldDescription>
                  适合你已经有清晰镜头结构的重点内容。
                </FieldDescription>
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>

        {needsAssets && <AssetDropzone selectedTemplate={selectedTemplate} />}

        <Separator className="my-5" />

        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel>视频长度</FieldLabel>
            <Select defaultValue="45">
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择长度" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="30">约 30 秒</SelectItem>
                  <SelectItem value="45">约 45 秒</SelectItem>
                  <SelectItem value="60">约 60 秒</SelectItem>
                  <SelectItem value="90">约 90 秒</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="tone">账号语气</FieldLabel>
            <Input defaultValue="温和、专业、像宠物医生解释" id="tone" />
          </Field>
        </div>

        <Field className="mt-5" orientation="horizontal">
          <Switch
            checked={strictReview}
            id="quality-review"
            onCheckedChange={setStrictReview}
          />
          <FieldContent>
            <FieldTitle>生成后检查视频是否可用</FieldTitle>
            <FieldDescription>
              有黑屏、无声或素材缺失时，不会把它当作可发布成片。
            </FieldDescription>
          </FieldContent>
        </Field>

        <div className="mt-6 flex flex-col gap-3 rounded-lg bg-muted/40 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">
              将使用「{selectedTemplate.shortName}」
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              预计 {selectedTemplate.estimatedTime}，生成后先进入草稿。
            </div>
          </div>
          <Button
            className="md:min-w-32"
            disabled={generationState === "running"}
            onClick={onGenerate}
            size="lg"
          >
            {generationState === "running" ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            {generationState === "running" ? "生成中" : "开始生成"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AssetDropzone({
  selectedTemplate,
}: {
  selectedTemplate: ProductionTemplate
}) {
  return (
    <div className="mt-5 rounded-lg border border-dashed bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-primary">
          <UploadCloud className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">添加素材</div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {selectedTemplate.assetRequirement}。Demo 已放入 3 个示例素材，
            后续这里接真实上传和素材库。
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {seedAssets.slice(0, 2).map((asset) => (
              <div
                className="flex items-center justify-between rounded-lg border bg-background px-3 py-2"
                key={asset.name}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Archive className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm">{asset.name}</span>
                </div>
                <Badge variant="outline">{asset.status}</Badge>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function RunSummary({
  selectedTemplate,
  defaultTemplate,
  generationState,
  onSetDefault,
}: {
  selectedTemplate: ProductionTemplate
  defaultTemplate: ProductionTemplate
  generationState: GenerationState
  onSetDefault: () => void
}) {
  const progress =
    generationState === "running" ? 68 : generationState === "done" ? 100 : 0
  const isDefault = selectedTemplate.id === defaultTemplate.id

  return (
    <aside className="flex flex-col gap-4">
      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>生成前确认</CardTitle>
          <CardDescription>
            只展示决定这次能不能顺利生成的信息。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg bg-primary/5 p-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
            <div>
              <div className="text-sm font-medium">
                {selectedTemplate.shortName}
              </div>
              <div className="mt-1 text-sm leading-5 text-muted-foreground">
                {selectedTemplate.description}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <SummaryRow label="输入" value="已填写" ok />
            <SummaryRow
              label="素材"
              value={
                selectedTemplate.requiresAssets ? "已有示例素材" : "无需上传"
              }
              ok
            />
            <SummaryRow label="发布" value="只生成草稿" ok />
          </div>

          <Separator className="my-4" />

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">
                {generationState === "idle"
                  ? "等待开始"
                  : generationState === "running"
                    ? "正在生成"
                    : "已生成草稿"}
              </span>
              <span className="text-xs text-muted-foreground">{progress}%</span>
            </div>
            <Progress className="mt-3" value={progress} />
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <Button disabled={isDefault} onClick={onSetDefault} variant="outline">
              <BadgeCheck data-icon="inline-start" />
              {isDefault ? "已是项目默认" : "设为项目默认"}
            </Button>
            <TemplateDetailSheet selectedTemplate={selectedTemplate} />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardHeader className="border-b">
          <CardTitle>最近生成</CardTitle>
          <CardDescription>这里只保留判断下一步需要的信息。</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {recentTasks.map((task) => (
              <div className="rounded-lg bg-muted/40 p-3" key={task.title}>
                <div className="line-clamp-1 text-sm font-medium">
                  {task.title}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{task.template}</Badge>
                  <Badge variant="secondary">{task.quality}</Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {task.finishedAt}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </aside>
  )
}

function SummaryRow({
  label,
  value,
  ok,
}: {
  label: string
  value: string
  ok: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{value}</div>
      </div>
    </div>
  )
}

function TemplateDetailSheet({
  selectedTemplate,
}: {
  selectedTemplate: ProductionTemplate
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost">
          <Layers3 data-icon="inline-start" />
          查看生产线细节
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{selectedTemplate.name}</SheetTitle>
          <SheetDescription>
            这些是已经固定好的制作设置，普通生成不需要逐项配置。
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailMetric label="预计耗时" value={selectedTemplate.estimatedTime} />
            <DetailMetric label="版本" value={selectedTemplate.version} />
            <DetailMetric label="入口" value={selectedTemplate.entry} />
            <DetailMetric label="检查" value={selectedTemplate.qualityPolicy} />
          </div>
          <Separator />
          <div>
            <div className="text-sm font-medium">固定设置</div>
            <div className="mt-3 grid gap-2">
              {selectedTemplate.fixedSettings.map((setting) => (
                <div
                  className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                  key={setting}
                >
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>{setting}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium">会生成什么</div>
            <div className="mt-3 grid gap-2">
              {selectedTemplate.expectedOutputs.map((output) => (
                <div
                  className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                  key={output}
                >
                  <CheckCircle2 className="size-4 text-primary" />
                  <span>{output}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button>关闭</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}

function BottomContext({ selectedTemplate }: { selectedTemplate: ProductionTemplate }) {
  return (
    <Card className="rounded-lg">
      <CardHeader className="border-b">
        <CardTitle>这次不用你决定的事</CardTitle>
        <CardDescription>
          Pixelle 会沿用项目默认配置，只在异常时提醒你。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <Clock3 className="size-4 text-primary" />
            <div className="mt-3 text-sm font-medium">节奏</div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              预计 {selectedTemplate.estimatedTime}，完成后先保存为草稿。
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <BadgeCheck className="size-4 text-primary" />
            <div className="mt-3 text-sm font-medium">检查</div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              视频异常不会被标成可发布，避免坏成片流到发布环节。
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <Archive className="size-4 text-primary" />
            <div className="mt-3 text-sm font-medium">记录</div>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              成片会记录使用的素材、字幕和音频，方便复查。
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProductionStudio() {
  const [selectedTemplateId, setSelectedTemplateId] = useState("daily")
  const [defaultTemplateId, setDefaultTemplateId] = useState("daily")
  const [generationState, setGenerationState] = useState<GenerationState>("idle")

  const selectedTemplate = useMemo(
    () =>
      productionTemplates.find((template) => template.id === selectedTemplateId) ??
      productionTemplates[0],
    [selectedTemplateId]
  )
  const defaultTemplate = useMemo(
    () =>
      productionTemplates.find((template) => template.id === defaultTemplateId) ??
      productionTemplates[0],
    [defaultTemplateId]
  )

  function selectTemplate(templateId: string) {
    setSelectedTemplateId(templateId)
    setGenerationState("idle")
  }

  function generate() {
    setGenerationState("running")
    window.setTimeout(() => setGenerationState("done"), 1300)
  }

  return (
    <TooltipProvider>
      <div className="min-h-svh bg-muted/30 text-foreground">
        <div className="flex min-h-svh">
          <Sidebar />
          <div className="min-w-0 flex-1">
            <Header defaultTemplate={defaultTemplate} />
            <main className="mx-auto grid max-w-[1360px] gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-6">
              <section className="flex min-w-0 flex-col gap-5">
                <ModePicker
                  onSelect={selectTemplate}
                  selectedTemplateId={selectedTemplate.id}
                />
                <Composer
                  generationState={generationState}
                  onGenerate={generate}
                  selectedTemplate={selectedTemplate}
                />
                <BottomContext selectedTemplate={selectedTemplate} />
              </section>
              <RunSummary
                defaultTemplate={defaultTemplate}
                generationState={generationState}
                onSetDefault={() => setDefaultTemplateId(selectedTemplate.id)}
                selectedTemplate={selectedTemplate}
              />
            </main>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
