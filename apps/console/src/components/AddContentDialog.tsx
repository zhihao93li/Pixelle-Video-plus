import { useEffect, useState } from "react"
import { Eye, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { FileDropzone } from "@/components/shared/FileDropzone"
import { InlineError } from "@/components/shared/feedback"
import { SourceChip } from "@/components/shared/SourceChip"
import { PromptPeekSheet } from "@/components/shared/PromptPeekSheet"
import { useToast } from "@/components/ui/toast"
import { languageLabel, PRESET_LANGUAGES } from "@/lib/languages"
import { readableError } from "@/lib/format"
import { settingsLink } from "@/lib/settingsLinks"
import { cn } from "@/lib/utils"
import { useCurrentProject } from "@/lib/currentProject"
import { generateDraftsForItems } from "@/lib/contentDrafting"
import {
  createContentItems,
  listTemplates,
  uploadGenerationAssets,
  type ProductionTemplate,
} from "@/lib/generationApi"

type AddTab = "topic" | "copy" | "asset"

function parseTopics(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseCopyBlocks(text: string) {
  return text
    .split(/\n-{3,}\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n")
      const title = (lines[0] ?? "").trim()
      const script = lines.slice(1).join("\n").trim()
      return { title, script }
    })
    .filter((entry) => entry.title)
}

export function AddContentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const toast = useToast()
  const { projectId, project } = useCurrentProject()
  const [tab, setTab] = useState<AddTab>("topic")
  const [topicsText, setTopicsText] = useState("")
  const [copyText, setCopyText] = useState("")
  const [assetFiles, setAssetFiles] = useState<File[]>([])
  const [languages, setLanguages] = useState<string[]>(["Chinese"])
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [peekOpen, setPeekOpen] = useState(false)

  const draftingRecipe = templates.find(
    (template) => template.id === project?.default_production_template_id
  )
  const languagesAreProjectDefault =
    !!project &&
    project.languages.length === languages.length &&
    languages.every((language) => project.languages.includes(language))

  // 语言默认来自当前项目（渲染期调整，避免 effect 内同步 setState）。
  // 打开时按项目初始化；关闭后重置，使下次打开重新取项目语言。
  const [languageInitKey, setLanguageInitKey] = useState<string | null>(null)
  if (open) {
    const key = project?.project_id ?? "none"
    if (key !== languageInitKey) {
      setLanguageInitKey(key)
      setLanguages(project?.languages?.length ? project.languages : ["Chinese"])
    }
  } else if (languageInitKey !== null) {
    setLanguageInitKey(null)
  }

  // 这里只展示项目默认配方；真正起草时后端仍会锁定同一配方。
  useEffect(() => {
    if (!open) {
      return
    }
    let cancelled = false
    void listTemplates(projectId ?? undefined)
      .then((response) => {
        if (!cancelled) {
          setTemplates(response.templates)
        }
      })
      .catch(() => {
        // 展示失败不阻塞添加；后端会按项目默认配方解析。
      })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

  function reset() {
    setTopicsText("")
    setCopyText("")
    setAssetFiles([])
    setError(null)
  }

  function toggleLanguage(language: string) {
    setLanguages((current) =>
      current.includes(language)
        ? current.filter((value) => value !== language)
        : [...current, language]
    )
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onCreated()
      reset()
      onOpenChange(false)
    } catch (actionError) {
      setError(readableError(actionError))
    } finally {
      setBusy(false)
    }
  }

  async function addTopicsOnly() {
    const titles = parseTopics(topicsText)
    if (titles.length === 0) {
      throw new Error("请至少输入一个选题。")
    }
    await createContentItems({
      titles,
      initialStatus: "idea",
      languages,
      projectId: projectId ?? undefined,
    })
    toast({ title: `已入池 ${titles.length} 个选题`, variant: "success" })
  }

  async function addTopicsAndDraft() {
    const titles = parseTopics(topicsText)
    if (titles.length === 0) {
      throw new Error("请至少输入一个选题。")
    }
    const chosenLanguages = languages.length > 0 ? languages : ["Chinese"]
    const items = await createContentItems({
      titles,
      initialStatus: "idea",
      languages: chosenLanguages,
      projectId: projectId ?? undefined,
    })
    // 标记起草中 + 后台起草由共享编排负责（后端锁定项目默认配方）。
    await generateDraftsForItems(items, toast, onCreated, {
      projectId: projectId ?? undefined,
    })
  }

  async function addReadyCopy() {
    const blocks = parseCopyBlocks(copyText)
    if (blocks.length === 0) {
      throw new Error("请至少输入一段文案（第一行作为标题）。")
    }
    await createContentItems({
      titles: blocks.map((block) => block.title),
      scripts: blocks.map((block) => block.script),
      initialStatus: "confirmed",
      languages,
      projectId: projectId ?? undefined,
    })
    toast({ title: `已入库 ${blocks.length} 条现成文案`, variant: "success" })
  }

  async function addAssets() {
    if (assetFiles.length === 0) {
      throw new Error("请先选择素材文件。")
    }
    const uploaded = await uploadGenerationAssets(assetFiles)
    await Promise.all(
      uploaded.assets.map((asset) =>
        createContentItems({
          titles: [asset.original_filename],
          kind: "asset",
          assetPaths: [asset.path],
          projectId: projectId ?? undefined,
        })
      )
    )
    toast({ title: `已导入 ${uploaded.count} 个素材`, variant: "success" })
  }

  return (
    <>
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>添加内容</SheetTitle>
            <SheetDescription className="text-left">
              选题入池、导入现成文案，或上传素材。
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 px-4 pb-4">
            <Tabs
              onValueChange={(value) => setTab(value as AddTab)}
              value={tab}
            >
              <TabsList>
                <TabsTrigger value="topic">选题</TabsTrigger>
                <TabsTrigger value="copy">现成文案</TabsTrigger>
                <TabsTrigger value="asset">素材</TabsTrigger>
              </TabsList>

              <TabsContent className="mt-4" value="topic">
                <Textarea
                  onChange={(event) => setTopicsText(event.target.value)}
                  placeholder="每行一个选题"
                  rows={6}
                  value={topicsText}
                />
              </TabsContent>

              <TabsContent className="mt-4" value="copy">
                <Textarea
                  onChange={(event) => setCopyText(event.target.value)}
                  placeholder={
                    "第一行为标题，其余为文案。\n多条之间用单独一行 --- 分隔。"
                  }
                  rows={8}
                  value={copyText}
                />
              </TabsContent>

              <TabsContent className="mt-4" value="asset">
                <FileDropzone
                  accept="image/*,video/*"
                  files={assetFiles}
                  hint="拖入图片或视频素材"
                  id="add-content-assets"
                  onFilesChange={setAssetFiles}
                />
              </TabsContent>
            </Tabs>

            {tab === "topic" && draftingRecipe && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>写稿配方：{draftingRecipe.display_name}</span>
                <SourceChip
                  source="recipe"
                  to={`/create/recipes/${draftingRecipe.id}`}
                />
                <Button
                  aria-label="查看口播提示词"
                  onClick={() => setPeekOpen(true)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Eye />
                </Button>
              </div>
            )}

            {tab !== "asset" && (
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  语言
                  {languagesAreProjectDefault && (
                    <SourceChip
                      source="project"
                      to={settingsLink({ kind: "projects" })}
                    />
                  )}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_LANGUAGES.map((language) => {
                    const active = languages.includes(language)
                    return (
                      <button
                        className={cn(
                          "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                          active
                            ? "border-primary bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted"
                        )}
                        key={language}
                        onClick={() => toggleLanguage(language)}
                        type="button"
                      >
                        {languageLabel(language)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {error && <InlineError title="添加失败" message={error} />}
          </div>

          <SheetFooter className="flex-row justify-end gap-2">
            {tab === "topic" && (
              <>
                <Button
                  disabled={busy}
                  onClick={() => void run(addTopicsOnly)}
                  variant="outline"
                >
                  仅入池
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void run(addTopicsAndDraft)}
                >
                  {busy && (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  )}
                  入池并生成草稿
                </Button>
              </>
            )}
            {tab === "copy" && (
              <Button disabled={busy} onClick={() => void run(addReadyCopy)}>
                {busy && (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                )}
                入库为确认稿
              </Button>
            )}
            {tab === "asset" && (
              <Button disabled={busy} onClick={() => void run(addAssets)}>
                {busy && (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                )}
                导入素材
              </Button>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <PromptPeekSheet
        kind="script"
        name={draftingRecipe?.drafting.script_template_name ?? ""}
        onOpenChange={setPeekOpen}
        open={peekOpen}
      />
    </>
  )
}
