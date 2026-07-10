import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Eye, Loader2, SlidersHorizontal, Star } from "lucide-react"

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
import { Textarea } from "@/components/ui/textarea"
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
import { InlineError } from "@/components/shared/feedback"
import { PromptPeekSheet } from "@/components/shared/PromptPeekSheet"
import { refreshProjects } from "@/lib/currentProject"
import { formatDate, readableError } from "@/lib/format"
import { languageLabel, PRESET_LANGUAGES } from "@/lib/languages"
import { navigate } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { cn } from "@/lib/utils"
import {
  archiveProject,
  createPromptTemplate,
  getSettingsConfig,
  listContentItems,
  listDraftingProfiles,
  listProjects,
  listPublishPlatforms,
  listScriptReviewTemplates,
  listTemplates,
  loadLlmModels,
  setDefaultProject,
  updateDraftingProfile,
  updatePromptTemplate,
  updateProject,
  type DraftingProfile,
  type Project,
  type ProductionTemplate,
  type PublishPlatform,
  type ScriptReviewPromptTemplate,
} from "@/lib/generationApi"

const NONE = "__none__"

/**
 * 项目详情页（/settings/projects/:id）：项目编辑 Sheet 的继任者
 * （DESIGN.md §2.5：>2 分区 + 长文本编辑必须页面；消灭嵌套 Prompt Sheet）。
 * 分区块保存：基本信息 / 起草配置（Prompt 正文页内展开编辑，copy-on-write）
 * / 语言与音色 各自保存；右栏生产默认与发布平台改动即存。
 */

type PromptKind = "script" | "split"

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const toast = useToast()
  const [project, setProject] = useState<Project | null>(null)
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [profile, setProfile] = useState<DraftingProfile | null>(null)
  const [profiles, setProfiles] = useState<DraftingProfile[]>([])
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [platforms, setPlatforms] = useState<PublishPlatform[]>([])
  const [scriptTemplates, setScriptTemplates] = useState<
    ScriptReviewPromptTemplate[]
  >([])
  const [splitTemplates, setSplitTemplates] = useState<
    ScriptReviewPromptTemplate[]
  >([])
  const [llmModels, setLlmModels] = useState<string[]>([])
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  // 分区块编辑态
  const [basic, setBasic] = useState({ name: "", description: "" })
  const [drafting, setDrafting] = useState({
    scriptTemplateName: "",
    splitTemplateName: "",
    scriptModel: "",
    splitModel: "",
  })
  const [languages, setLanguages] = useState<string[]>([])
  const [voices, setVoices] = useState<Record<string, string>>({})
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [peek, setPeek] = useState<{ kind: PromptKind; name: string } | null>(
    null
  )

  // 页内 Prompt 正文编辑
  const [promptEdit, setPromptEdit] = useState<{
    kind: PromptKind
    name: string
    content: string
    source: string | null
  } | null>(null)
  const [promptBusy, setPromptBusy] = useState(false)
  const [promptError, setPromptError] = useState<string | null>(null)

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listProjects(),
      listDraftingProfiles(),
      listTemplates(),
      listPublishPlatforms(),
      listScriptReviewTemplates(),
    ])
      .then(
        ([
          projectResponse,
          profileResponse,
          templateResponse,
          platformResponse,
          reviewResponse,
        ]) => {
          if (cancelled) {
            return
          }
          const found =
            projectResponse.projects.find(
              (item) => item.project_id === projectId
            ) ?? null
          setProject(found)
          setDefaultId(projectResponse.default_project_id)
          setProfiles(profileResponse.profiles)
          setProfile(
            profileResponse.profiles.find(
              (item) => item.project_id === projectId
            ) ?? null
          )
          setTemplates(templateResponse.templates)
          setPlatforms(platformResponse.platforms)
          setScriptTemplates(reviewResponse.script_templates)
          setSplitTemplates(reviewResponse.split_templates)
          setLoadError(found ? null : "项目不存在，可能已被归档或删除。")
        }
      )
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(readableError(error))
        }
      })
    // 进行中内容数（失败静默）
    void listContentItems({ project: projectId, limit: 500 })
      .then((items) => {
        if (!cancelled) {
          setActiveCount(
            items.filter(
              (item) => !["published", "measured", "archived"].includes(item.status)
            ).length
          )
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [projectId, reloadToken])

  // 模型下拉可选项（拉不到回落文本框）
  useEffect(() => {
    let cancelled = false
    void getSettingsConfig()
      .then((response) => {
        const { api_key, base_url } = response.config.llm
        if (!api_key || !base_url) {
          return null
        }
        return loadLlmModels(api_key, base_url)
      })
      .then((models) => {
        if (models && !cancelled) {
          setLlmModels(models.models)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 数据到达时初始化分区块编辑态（渲染期调整；刷新不冲掉正在编辑的区块——
  // 以「项目 id + 数据版本」为键，保存成功后主动 refresh 重灌）
  const initKey = project ? `${project.project_id}:${reloadToken}` : null
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  if (project && initKey && initializedFor !== initKey) {
    setInitializedFor(initKey)
    setBasic({ name: project.name, description: project.description })
    setLanguages(project.languages.length ? project.languages : ["Chinese"])
    setVoices({ ...project.tts_voice_by_language })
    if (profile) {
      setDrafting({
        scriptTemplateName: profile.script_template_name,
        splitTemplateName: profile.split_template_name,
        scriptModel: profile.script_model,
        splitModel: profile.split_model,
      })
    }
  }

  async function saveSection(section: string, action: () => Promise<void>) {
    setSavingSection(section)
    try {
      await action()
      toast({ title: "已保存", variant: "success" })
      refresh()
      await refreshProjects()
    } catch (error) {
      toast({
        title: "保存失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setSavingSection(null)
    }
  }

  function openPromptEditor(kind: PromptKind) {
    const name =
      kind === "script" ? drafting.scriptTemplateName : drafting.splitTemplateName
    const pool = kind === "script" ? scriptTemplates : splitTemplates
    const template = pool.find((item) => item.name === name)
    setPromptError(null)
    setPromptEdit({
      kind,
      name,
      content: template?.content ?? "",
      source: template?.source ?? null,
    })
  }

  const promptIsBuiltin = promptEdit?.source === "builtin"
  const promptUsedByOthers =
    promptEdit != null &&
    profiles.some(
      (item) =>
        item.project_id !== projectId &&
        (item.script_template_name === promptEdit.name ||
          item.split_template_name === promptEdit.name)
    )
  const promptMustCopy = promptIsBuiltin || promptUsedByOthers

  async function savePrompt() {
    if (!promptEdit || !profile) {
      return
    }
    setPromptBusy(true)
    setPromptError(null)
    try {
      if (promptMustCopy) {
        const created = await createPromptTemplate({
          kind: promptEdit.kind,
          name: `${basic.name || project?.name} · ${promptEdit.name}`,
          content: promptEdit.content,
        })
        // 副本立刻接管本项目引用，避免悬空
        const patch =
          promptEdit.kind === "script"
            ? { script_template_name: created.name }
            : { split_template_name: created.name }
        await updateDraftingProfile(profile.profile_id, patch)
        setDrafting((current) => ({
          ...current,
          [promptEdit.kind === "script"
            ? "scriptTemplateName"
            : "splitTemplateName"]: created.name,
        }))
        toast({
          title: "已为本项目创建副本，不影响其他项目",
          variant: "success",
        })
      } else {
        await updatePromptTemplate({
          kind: promptEdit.kind,
          name: promptEdit.name,
          content: promptEdit.content,
        })
        toast({ title: "提示词已保存", variant: "success" })
      }
      setPromptEdit(null)
      refresh()
    } catch (error) {
      setPromptError(readableError(error))
    } finally {
      setPromptBusy(false)
    }
  }

  function renderModelField(value: string, onChange: (value: string) => void) {
    if (llmModels.length === 0) {
      return (
        <Input
          onChange={(event) => onChange(event.target.value)}
          placeholder="留空用设置页默认模型"
          value={value}
        />
      )
    }
    const options =
      value && !llmModels.includes(value) ? [value, ...llmModels] : llmModels
    return (
      <Select
        onValueChange={(next) => onChange(next === NONE ? "" : next)}
        value={value || NONE}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>默认模型（留空）</SelectItem>
          {options.map((model) => (
            <SelectItem key={model} value={model}>
              {model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  function renderPromptRow(kind: PromptKind) {
    const isScript = kind === "script"
    const value = isScript
      ? drafting.scriptTemplateName
      : drafting.splitTemplateName
    const pool = isScript ? scriptTemplates : splitTemplates
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {isScript ? "口播提示词" : "分镜提示词"}
        </span>
        <div className="flex items-center gap-1.5">
          <Select
            onValueChange={(next) =>
              setDrafting((current) => ({
                ...current,
                [isScript ? "scriptTemplateName" : "splitTemplateName"]: next,
              }))
            }
            value={value}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pool.map((template) => (
                <SelectItem key={template.name} value={template.name}>
                  {template.name}
                  {template.source === "builtin" ? "（内置）" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            aria-label="查看提示词"
            onClick={() => setPeek({ kind, name: value })}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <Eye />
          </Button>
          <Button
            onClick={() => openPromptEditor(kind)}
            size="sm"
            type="button"
            variant="outline"
          >
            编辑正文
          </Button>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
        <BackRow />
        <InlineError title="项目读取失败" message={loadError} />
      </main>
    )
  }

  if (!project) {
    return (
      <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
        <BackRow />
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在读取项目
        </div>
      </main>
    )
  }

  const isDefault = project.project_id === defaultId
  const selectedTemplate =
    templates.find(
      (template) => template.id === project.default_production_template_id
    ) ?? null
  const missingTopic =
    promptEdit != null && !promptEdit.content.includes("{topic}")

  return (
    <main className="flex max-w-[1240px] flex-col gap-4 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <BackRow />
          <h1 className="truncate text-lg font-semibold">{project.name}</h1>
          {isDefault && (
            <Badge variant="secondary">
              <Star data-icon="inline-start" />
              默认项目
            </Badge>
          )}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={isDefault} variant="outline">
              归档项目
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>归档「{project.name}」？</AlertDialogTitle>
              <AlertDialogDescription>
                归档后从切换器隐藏，数据保留，可在设置页恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void saveSection("archive", async () => {
                    await archiveProject(project.project_id)
                    navigate(settingsLink({ kind: "projects" }))
                  })
                }
              >
                归档
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {isDefault && (
        <p className="-mt-2 text-right text-xs text-muted-foreground">
          默认项目不能归档，请先把默认转移到其他项目
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-4">
          {/* 基本信息 */}
          <section className="rounded-lg border bg-background p-4">
            <SectionHeader
              busy={savingSection === "basic"}
              onSave={() =>
                void saveSection("basic", async () => {
                  if (!basic.name.trim()) {
                    throw new Error("项目名称不能为空。")
                  }
                  await updateProject(project.project_id, {
                    name: basic.name.trim(),
                    description: basic.description.trim(),
                  })
                })
              }
              title="基本信息"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr]">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">名称</span>
                <Input
                  onChange={(event) =>
                    setBasic((current) => ({ ...current, name: event.target.value }))
                  }
                  value={basic.name}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">描述（可选）</span>
                <Input
                  onChange={(event) =>
                    setBasic((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  value={basic.description}
                />
              </label>
            </div>
          </section>

          {/* 起草配置 */}
          <section className="rounded-lg border bg-background p-4">
            <SectionHeader
              busy={savingSection === "drafting"}
              disabled={!profile}
              onSave={() =>
                void saveSection("drafting", async () => {
                  if (!profile) {
                    throw new Error("起草配置尚未就绪，请刷新重试。")
                  }
                  await updateDraftingProfile(profile.profile_id, {
                    script_template_name: drafting.scriptTemplateName,
                    split_template_name: drafting.splitTemplateName,
                    script_model: drafting.scriptModel,
                    split_model: drafting.splitModel,
                  })
                })
              }
              title="起草配置"
            />
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              决定 AI 怎么把选题写成文案。与本项目一对一，改动不影响其他项目。
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {renderPromptRow("script")}
              {renderPromptRow("split")}
            </div>

            {promptEdit && (
              <div className="mt-3 rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    正在编辑：{promptEdit.name}
                    <Badge variant="outline">
                      {promptIsBuiltin ? "内置" : "自定义"}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {promptEdit.content.length} 字符
                  </span>
                </div>
                <Textarea
                  className="mt-2 min-h-60 resize-y font-mono text-xs leading-5"
                  onChange={(event) =>
                    setPromptEdit((current) =>
                      current ? { ...current, content: event.target.value } : current
                    )
                  }
                  value={promptEdit.content}
                />
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    占位符 <code className="rounded bg-muted px-1">{"{topic}"}</code>{" "}
                    = 选题，<code className="rounded bg-muted px-1">{"{language}"}</code>{" "}
                    = 语言
                  </span>
                  {missingTopic && (
                    <span className="text-destructive">
                      缺少 {"{topic}"} 占位符，选题将无法注入
                    </span>
                  )}
                </div>
                {promptMustCopy && (
                  <div className="mt-2 rounded-lg border bg-muted/30 p-2.5 text-xs leading-5 text-muted-foreground">
                    {promptIsBuiltin
                      ? "这是内置提示词。保存会为本项目创建可编辑副本，不影响内置模板与其他项目。"
                      : "这份提示词被其他项目使用中。保存会为本项目创建副本，不影响其他项目。"}
                  </div>
                )}
                {promptError && (
                  <div className="mt-2">
                    <InlineError title="保存失败" message={promptError} />
                  </div>
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    disabled={promptBusy}
                    onClick={() => setPromptEdit(null)}
                    size="sm"
                    variant="ghost"
                  >
                    取消
                  </Button>
                  <Button
                    disabled={promptBusy}
                    onClick={() => void savePrompt()}
                    size="sm"
                  >
                    {promptBusy && (
                      <Loader2 className="animate-spin" data-icon="inline-start" />
                    )}
                    保存正文
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">口播模型</span>
                {renderModelField(drafting.scriptModel, (value) =>
                  setDrafting((current) => ({ ...current, scriptModel: value }))
                )}
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">分镜模型</span>
                {renderModelField(drafting.splitModel, (value) =>
                  setDrafting((current) => ({ ...current, splitModel: value }))
                )}
              </label>
            </div>
          </section>

          {/* 语言与音色 */}
          <section className="rounded-lg border bg-background p-4">
            <SectionHeader
              busy={savingSection === "languages"}
              onSave={() =>
                void saveSection("languages", async () => {
                  if (languages.length === 0) {
                    throw new Error("至少选择一种语言。")
                  }
                  const cleaned: Record<string, string> = {}
                  for (const language of languages) {
                    const voice = (voices[language] ?? "").trim()
                    if (voice) {
                      cleaned[language] = voice
                    }
                  }
                  await updateProject(project.project_id, {
                    languages,
                    ttsVoiceByLanguage: cleaned,
                  })
                })
              }
              title="语言与音色"
            />
            <div className="mt-3 flex flex-wrap gap-1.5">
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
                    onClick={() =>
                      setLanguages((current) =>
                        current.includes(language)
                          ? current.filter((value) => value !== language)
                          : [...current, language]
                      )
                    }
                    type="button"
                  >
                    {languageLabel(language)}
                  </button>
                )
              })}
            </div>
            {languages.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">
                  每语言 Fish 音色（reference_id，可留空用引擎默认）
                </span>
                {languages.map((language) => (
                  <label className="flex items-center gap-2 text-sm" key={language}>
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">
                      {languageLabel(language)}
                    </span>
                    <Input
                      onChange={(event) =>
                        setVoices((current) => ({
                          ...current,
                          [language]: event.target.value,
                        }))
                      }
                      placeholder="reference_id"
                      value={voices[language] ?? ""}
                    />
                  </label>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* 右栏 */}
        <aside className="flex flex-col gap-3">
          <div className="rounded-lg border bg-background p-3">
            <div className="mb-2 text-xs text-muted-foreground">生产默认</div>
            <Select
              onValueChange={(value) =>
                void saveSection("template", async () => {
                  await updateProject(project.project_id, {
                    // 「用内置默认」发空串清空（勿用 undefined/??）
                    defaultProductionTemplateId: value === NONE ? "" : value,
                  })
                })
              }
              value={project.default_production_template_id || NONE}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>用内置默认模板</SelectItem>
                {templates
                  .filter(
                    (template) =>
                      template.enabled && template.product_entry === "generate"
                  )
                  .map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.display_name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {selectedTemplate && (
              <Button
                className="mt-2 w-full"
                onClick={() =>
                  navigate(`/create/recipes/${selectedTemplate.id}`)
                }
                size="sm"
                variant="outline"
              >
                <SlidersHorizontal data-icon="inline-start" />
                看这套配方的产线
              </Button>
            )}
          </div>

          <div className="rounded-lg border bg-background p-3">
            <div className="mb-2 text-xs text-muted-foreground">发布平台预选</div>
            <div className="flex flex-wrap gap-1.5">
              {platforms.map((platform) => {
                const active = project.publish_platforms.includes(platform.id)
                return (
                  <button
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                    key={platform.id}
                    onClick={() =>
                      void saveSection("platforms", async () => {
                        const next = active
                          ? project.publish_platforms.filter(
                              (value) => value !== platform.id
                            )
                          : [...project.publish_platforms, platform.id]
                        await updateProject(project.project_id, {
                          publishPlatforms: next,
                        })
                      })
                    }
                    type="button"
                  >
                    {platform.label}
                  </button>
                )
              })}
              {platforms.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  暂无可用发布平台
                </span>
              )}
            </div>
          </div>

          <div className="rounded-lg border bg-background p-3">
            <div className="mb-2 text-xs text-muted-foreground">项目</div>
            <div className="text-xs leading-6 text-muted-foreground">
              创建于 {formatDate(project.created_at)}
              {activeCount != null && (
                <>
                  <br />
                  {activeCount} 条内容进行中
                </>
              )}
            </div>
            {!isDefault && (
              <Button
                className="mt-2 w-full"
                disabled={savingSection === "default"}
                onClick={() =>
                  void saveSection("default", async () => {
                    await setDefaultProject(project.project_id)
                  })
                }
                size="sm"
                variant="outline"
              >
                <Star data-icon="inline-start" />
                设为默认项目
              </Button>
            )}
          </div>
        </aside>
      </div>

      <PromptPeekSheet
        kind={peek?.kind ?? "script"}
        name={peek?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            setPeek(null)
          }
        }}
        open={peek != null}
      />
    </main>
  )
}

function SectionHeader({
  title,
  onSave,
  busy,
  disabled,
}: {
  title: string
  onSave: () => void
  busy: boolean
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">{title}</span>
      <Button disabled={busy || disabled} onClick={onSave} size="sm" variant="outline">
        {busy && <Loader2 className="animate-spin" data-icon="inline-start" />}
        保存
      </Button>
    </div>
  )
}

function BackRow() {
  return (
    <Button
      onClick={() => navigate(settingsLink({ kind: "projects" }))}
      size="sm"
      variant="ghost"
    >
      <ArrowLeft data-icon="inline-start" />
      设置
    </Button>
  )
}
