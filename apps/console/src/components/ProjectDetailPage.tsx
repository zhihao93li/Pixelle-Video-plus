import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Loader2, SlidersHorizontal, Star } from "lucide-react"

import { UnsavedChangesGuard } from "@/components/settings/UnsavedChangesGuard"
import { AsyncState } from "@/components/shared/AsyncState"
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
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
import { refreshProjects } from "@/lib/currentProject"
import { formatDate, readableError } from "@/lib/format"
import { languageLabel, PRESET_LANGUAGES } from "@/lib/languages"
import { navigate, usePath } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"
import { cn } from "@/lib/utils"
import {
  archiveProject,
  listContentItems,
  listProjects,
  listPublishPlatforms,
  listTemplates,
  setDefaultProject,
  updateProject,
  type Project,
  type ProductionTemplate,
  type PublishPlatform,
} from "@/lib/generationApi"

const NONE = "__none__"

/**
 * 项目详情页（/settings/projects/:id）：项目编辑 Sheet 的继任者
 * （DESIGN.md §2.5：>2 分区 + 长文本编辑必须页面；消灭嵌套 Prompt Sheet）。
 * 分区块保存：基本信息 / 语言与音色 / 生产与发布默认各自保存。
 */

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const toast = useToast()
  const path = usePath()
  const [project, setProject] = useState<Project | null>(null)
  const [defaultId, setDefaultId] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProductionTemplate[]>([])
  const [platforms, setPlatforms] = useState<PublishPlatform[]>([])
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [auxiliaryErrors, setAuxiliaryErrors] = useState<
    Partial<Record<"content", string>>
  >({})
  const [reloadToken, setReloadToken] = useState(0)

  // 分区块编辑态
  const [basic, setBasic] = useState({ name: "", description: "" })
  const [languages, setLanguages] = useState<string[]>([])
  const [voices, setVoices] = useState<Record<string, string>>({})
  const [productionTemplateId, setProductionTemplateId] = useState(NONE)
  const [publishPlatformIds, setPublishPlatformIds] = useState<string[]>([])
  const [savingSection, setSavingSection] = useState<string | null>(null)
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({})

  const refresh = useCallback(() => setReloadToken((token) => token + 1), [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([listProjects(), listTemplates(), listPublishPlatforms()])
      .then(([projectResponse, templateResponse, platformResponse]) => {
        if (cancelled) {
          return
        }
        const found =
          projectResponse.projects.find(
            (item) => item.project_id === projectId
          ) ?? null
        setProject(found)
        setDefaultId(projectResponse.default_project_id)
        setTemplates(templateResponse.templates)
        setPlatforms(platformResponse.platforms)
        setLoadError(found ? null : "项目不存在，可能已被归档或删除。")
        if (found) {
          setBasic({ name: found.name, description: found.description })
          setLanguages(effectiveLanguages(found))
          setVoices({ ...found.tts_voice_by_language })
          setProductionTemplateId(found.default_production_template_id || NONE)
          setPublishPlatformIds([...found.publish_platforms])
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(readableError(error))
        }
      })
    // 进行中内容数是辅助信息，失败不阻断编辑，但必须显式告知。
    void listContentItems({ project: projectId, limit: 500 })
      .then((items) => {
        if (!cancelled) {
          setActiveCount(
            items.filter(
              (item) =>
                !["published", "measured", "archived"].includes(item.status)
            ).length
          )
          setAuxiliaryErrors((current) => {
            const next = { ...current }
            delete next.content
            return next
          })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAuxiliaryErrors((current) => ({
            ...current,
            content: readableError(error),
          }))
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadToken])

  async function saveSection(section: string, action: () => Promise<void>) {
    setSavingSection(section)
    setSectionErrors((current) => {
      const next = { ...current }
      delete next[section]
      return next
    })
    try {
      await action()
      if (section === "basic") {
        const savedBasic = {
          name: basic.name.trim(),
          description: basic.description.trim(),
        }
        setBasic(savedBasic)
        setProject((current) =>
          current
            ? {
                ...current,
                ...savedBasic,
              }
            : current
        )
      } else if (section === "languages") {
        setProject((current) =>
          current
            ? {
                ...current,
                languages: [...languages],
                tts_voice_by_language: normalizedVoices(languages, voices),
              }
            : current
        )
      } else if (section === "defaults") {
        setProject((current) =>
          current
            ? {
                ...current,
                default_production_template_id:
                  productionTemplateId === NONE ? null : productionTemplateId,
                publish_platforms: [...publishPlatformIds],
              }
            : current
        )
      } else if (section === "default") {
        setDefaultId(projectId)
      }
      toast({ title: "已保存", variant: "success" })
      await refreshProjects()
    } catch (error) {
      const message = readableError(error)
      setSectionErrors((current) => ({ ...current, [section]: message }))
      toast({
        title: "保存失败",
        description: message,
        variant: "error",
      })
    } finally {
      setSavingSection(null)
    }
  }

  if (loadError && !project) {
    return (
      <PageFrame>
        <BackRow />
        <AsyncState
          action={
            <Button onClick={refresh} size="sm" variant="outline">
              重新读取
            </Button>
          }
          description={loadError}
          state="error"
          title="项目读取失败"
        />
      </PageFrame>
    )
  }

  if (!project) {
    return (
      <PageFrame>
        <BackRow />
        <AsyncState
          description="正在同步项目、生产模板与发布平台。"
          state="loading"
          title="正在读取项目"
        />
      </PageFrame>
    )
  }

  const isDefault = project.project_id === defaultId
  const basicDirty =
    basic.name !== project.name || basic.description !== project.description
  const languagesDirty =
    JSON.stringify(languages) !== JSON.stringify(effectiveLanguages(project)) ||
    JSON.stringify(normalizedVoices(languages, voices)) !==
      JSON.stringify(
        normalizedVoices(
          effectiveLanguages(project),
          project.tts_voice_by_language
        )
      )
  const defaultsDirty =
    productionTemplateId !== (project.default_production_template_id || NONE) ||
    JSON.stringify(publishPlatformIds) !==
      JSON.stringify(project.publish_platforms)
  const hasDirty = basicDirty || languagesDirty || defaultsDirty
  const selectedTemplate =
    templates.find((template) => template.id === productionTemplateId) ?? null

  return (
    <PageFrame>
      <BackRow />
      <WorkspaceHeader
        actions={
          <>
            {isDefault ? (
              <Badge variant="secondary">
                <Star data-icon="inline-start" />
                默认项目
              </Badge>
            ) : null}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button disabled={isDefault || hasDirty} variant="outline">
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
          </>
        }
        description="分区保存品牌信息、语言音色与生产发布默认。写稿规则在模板中管理。"
        title={project.name}
      />
      {isDefault && (
        <p className="text-xs text-muted-foreground">
          默认项目不能归档，请先把默认转移到其他项目
        </p>
      )}
      {!isDefault && hasDirty ? (
        <p className="text-xs text-muted-foreground">
          保存或放弃当前更改后才能归档项目。
        </p>
      ) : null}
      {loadError ? (
        <AsyncState
          action={
            <Button onClick={refresh} size="sm" variant="outline">
              重新读取
            </Button>
          }
          description={loadError}
          state="stale"
          title="项目详情可能不是最新状态"
        />
      ) : null}
      {Object.keys(auxiliaryErrors).length > 0 ? (
        <AsyncState
          action={
            <Button onClick={refresh} size="sm" variant="outline">
              重新读取
            </Button>
          }
          description={Object.values(auxiliaryErrors).join("；")}
          state="stale"
          title="部分辅助信息未同步"
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-4">
          {/* 基本信息 */}
          <section className="rounded-lg border bg-background p-4">
            <SectionHeader
              busy={savingSection === "basic"}
              dirty={basicDirty}
              error={sectionErrors.basic}
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
                    setBasic((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  value={basic.name}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">
                  描述（可选）
                </span>
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

          {/* 语言与音色 */}
          <section className="rounded-lg border bg-background p-4">
            <SectionHeader
              busy={savingSection === "languages"}
              dirty={languagesDirty}
              error={sectionErrors.languages}
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
                  <label
                    className="flex items-center gap-2 text-sm"
                    key={language}
                  >
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
            <SectionHeader
              busy={savingSection === "defaults"}
              dirty={defaultsDirty}
              error={sectionErrors.defaults}
              onSave={() =>
                void saveSection("defaults", async () => {
                  await updateProject(project.project_id, {
                    defaultProductionTemplateId:
                      productionTemplateId === NONE ? "" : productionTemplateId,
                    publishPlatforms: publishPlatformIds,
                  })
                })
              }
              title="生产与发布默认"
            />
            <div className="mt-3 text-xs text-muted-foreground">生产模板</div>
            <Select
              onValueChange={setProductionTemplateId}
              value={productionTemplateId}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>用内置默认模板</SelectItem>
                {templates
                  .filter((template) => template.enabled)
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
                看这套模板的产线
              </Button>
            )}
            <div className="mt-4 text-xs text-muted-foreground">
              发布平台预选
            </div>
            <div className="flex flex-wrap gap-1.5">
              {platforms.map((platform) => {
                const active = publishPlatformIds.includes(platform.id)
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
                      setPublishPlatformIds((current) =>
                        active
                          ? current.filter((value) => value !== platform.id)
                          : [...current, platform.id]
                      )
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

      <UnsavedChangesGuard currentPath={path} dirty={hasDirty} />
    </PageFrame>
  )
}

function SectionHeader({
  title,
  onSave,
  busy,
  dirty,
  disabled,
  error,
}: {
  title: string
  onSave: () => void
  busy: boolean
  dirty: boolean
  disabled?: boolean
  error?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{title}</span>
        <Button
          disabled={busy || disabled || !dirty}
          onClick={onSave}
          size="sm"
          variant="outline"
        >
          {busy && (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          )}
          保存
        </Button>
      </div>
      <p className="mt-1 text-right text-xs text-muted-foreground">
        {dirty ? "有未保存更改" : "没有未保存更改"}
      </p>
      {error ? <InlineError message={error} title="保存失败" /> : null}
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

function normalizedVoices(languages: string[], voices: Record<string, string>) {
  const normalized: Record<string, string> = {}
  for (const language of languages) {
    const value = (voices[language] ?? "").trim()
    if (value) normalized[language] = value
  }
  return normalized
}

function effectiveLanguages(project: Project) {
  return project.languages.length > 0 ? project.languages : ["Chinese"]
}
