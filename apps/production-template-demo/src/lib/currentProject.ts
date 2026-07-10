import { useEffect } from "react"
import { useSyncExternalStore } from "react"

import { listProjects, type Project } from "@/lib/generationApi"

/**
 * 当前项目（全局作用域）：localStorage 记住选择 + CustomEvent 广播 + hook。
 * 仿 lib/expertMode.ts。"当前项目"是纯前端状态；所有 API 调用显式带 project id。
 * localStorage 值失效（归档/不存在）时回落 default_project_id 并写回。
 */

const STORAGE_KEY = "pixlle.currentProjectId"
const EVENT_NAME = "pixlle-current-project-change"

type Snapshot = {
  projectId: string | null
  defaultProjectId: string | null
  projects: Project[]
  loaded: boolean
}

let snapshot: Snapshot = {
  projectId: null,
  defaultProjectId: null,
  projects: [],
  loaded: false,
}

let loadPromise: Promise<void> | null = null

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredId(projectId: string | null) {
  try {
    if (projectId) {
      window.localStorage.setItem(STORAGE_KEY, projectId)
    } else {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // 存储不可用时静默失败
  }
}

function emit() {
  window.dispatchEvent(new Event(EVENT_NAME))
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(EVENT_NAME, callback)
    window.removeEventListener("storage", callback)
  }
}

function getSnapshot() {
  return snapshot
}

function resolveProjectId(
  stored: string | null,
  projects: Project[],
  defaultId: string | null
): string | null {
  const active = projects.filter((project) => project.status === "active")
  if (stored && active.some((project) => project.project_id === stored)) {
    return stored
  }
  if (defaultId && active.some((project) => project.project_id === defaultId)) {
    return defaultId
  }
  return active[0]?.project_id ?? null
}

export async function refreshProjects(): Promise<void> {
  const response = await listProjects()
  const stored = readStoredId()
  const projectId = resolveProjectId(
    stored,
    response.projects,
    response.default_project_id
  )
  if (projectId !== stored) {
    writeStoredId(projectId)
  }
  snapshot = {
    projectId,
    defaultProjectId: response.default_project_id,
    projects: response.projects,
    loaded: true,
  }
  emit()
}

function ensureLoaded() {
  if (snapshot.loaded || loadPromise) {
    return
  }
  loadPromise = refreshProjects()
    .catch(() => {
      // 拉取失败：标记已加载避免死循环，保持空列表
      snapshot = { ...snapshot, loaded: true }
      emit()
    })
    .finally(() => {
      loadPromise = null
    })
}

export function setCurrentProjectId(projectId: string) {
  writeStoredId(projectId)
  snapshot = { ...snapshot, projectId }
  emit()
}

export function useCurrentProject() {
  const current = useSyncExternalStore(subscribe, getSnapshot)

  useEffect(() => {
    ensureLoaded()
  }, [])

  const project =
    current.projects.find((item) => item.project_id === current.projectId) ??
    null

  return {
    projectId: current.projectId,
    project,
    projects: current.projects,
    loaded: current.loaded,
    setProjectId: setCurrentProjectId,
    refresh: refreshProjects,
  }
}
