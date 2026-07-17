import { useCallback, useEffect, useState } from "react"
import { ArrowLeft, Archive, Loader2 } from "lucide-react"

import { UnsavedChangesGuard } from "@/components/settings/UnsavedChangesGuard"
import { AsyncState } from "@/components/shared/AsyncState"
import { PageFrame } from "@/components/shared/PageFrame"
import { WorkspaceHeader } from "@/components/shared/WorkspaceHeader"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/toast"
import { refreshProjects } from "@/lib/currentProject"
import { formatDate, readableError } from "@/lib/format"
import {
  archiveProject,
  listContentItems,
  listProjects,
  updateProject,
  type Project,
} from "@/lib/generationApi"
import { navigate, usePath } from "@/lib/router"
import { settingsLink } from "@/lib/settingsLinks"

export function ProjectDetailPage({ projectId }: { projectId: string }) {
  const toast = useToast()
  const path = usePath()
  const [project, setProject] = useState<Project | null>(null)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [contentCount, setContentCount] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  const refresh = useCallback(() => setReloadToken((value) => value + 1), [])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listProjects(),
      listContentItems({ project: projectId, limit: 500 }),
    ])
      .then(([projectResponse, items]) => {
        if (cancelled) return
        const found =
          projectResponse.projects.find(
            (item) => item.project_id === projectId
          ) ?? null
        setProject(found)
        setLoadError(found ? null : "内容空间不存在或已经被移除。")
        setContentCount(items.length)
        if (found) {
          setName(found.name)
          setDescription(found.description)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(readableError(error))
      })
    return () => {
      cancelled = true
    }
  }, [projectId, reloadToken])

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
          title="内容空间读取失败"
        />
      </PageFrame>
    )
  }

  if (!project) {
    return (
      <PageFrame>
        <BackRow />
        <AsyncState
          description="正在读取内容空间。"
          state="loading"
          title="正在读取"
        />
      </PageFrame>
    )
  }

  const dirty = name !== project.name || description !== project.description
  const currentProjectId = project.project_id

  async function save() {
    const cleanedName = name.trim()
    if (isSaving) return
    if (!cleanedName) {
      setNameError("内容空间名称不能为空。")
      return
    }
    setIsSaving(true)
    try {
      const updated = await updateProject(currentProjectId, {
        name: cleanedName,
        description: description.trim(),
      })
      setProject(updated)
      setName(updated.name)
      setDescription(updated.description)
      setNameError(null)
      await refreshProjects()
      toast({ title: "内容空间已保存", variant: "success" })
    } catch (error) {
      toast({
        title: "保存失败",
        description: readableError(error),
        variant: "error",
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <PageFrame>
      <BackRow />
      <WorkspaceHeader
        actions={
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={dirty || isSaving} variant="outline">
                <Archive data-icon="inline-start" />
                归档
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>归档“{project.name}”？</AlertDialogTitle>
                <AlertDialogDescription>
                  归档后将从切换器隐藏，已有内容、任务和作品都会保留。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void archiveProject(project.project_id)
                      .then(async () => {
                        await refreshProjects()
                        navigate(settingsLink({ kind: "projects" }))
                      })
                      .catch((error) =>
                        toast({
                          title: "归档失败",
                          description: readableError(error),
                          variant: "error",
                        })
                      )
                  }}
                >
                  确认归档
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        }
        description="内容空间只负责区分内容、任务、作品和运营记录，不保存生产默认。"
        title={project.name}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Card>
          <CardHeader>
            <CardTitle>基本信息</CardTitle>
            <CardDescription>
              给这个内容空间一个容易识别的名称和说明。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="project-name">名称</FieldLabel>
                <Input
                  aria-describedby={nameError ? "project-name-error" : undefined}
                  aria-invalid={Boolean(nameError)}
                  id="project-name"
                  onChange={(event) => {
                    setName(event.target.value)
                    if (event.target.value.trim()) setNameError(null)
                  }}
                  value={name}
                />
                <FieldDescription>
                  用于顶部切换、工作台和作品归属。
                </FieldDescription>
                {nameError ? (
                  <p
                    className="text-sm text-destructive"
                    id="project-name-error"
                    role="alert"
                  >
                    {nameError}
                  </p>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="project-description">
                  说明（可选）
                </FieldLabel>
                <Textarea
                  id="project-description"
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  value={description}
                />
              </Field>
              <div className="flex justify-end border-t pt-4">
                {dirty ? (
                  <span aria-live="polite" className="mr-auto text-sm text-warning">
                    有未保存更改
                  </span>
                ) : null}
                <Button disabled={!dirty || isSaving} onClick={save}>
                  {isSaving ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : null}
                  保存更改
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>空间信息</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">内容记录</dt>
                <dd className="mt-1 font-medium">
                  {contentCount == null ? "读取中" : `${contentCount} 条`}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">创建时间</dt>
                <dd className="mt-1 font-medium">
                  {formatDate(project.created_at)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">状态</dt>
                <dd className="mt-1 font-medium">
                  {project.status === "active" ? "使用中" : "已归档"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <UnsavedChangesGuard currentPath={path} dirty={dirty} />
    </PageFrame>
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
      内容空间
    </Button>
  )
}
