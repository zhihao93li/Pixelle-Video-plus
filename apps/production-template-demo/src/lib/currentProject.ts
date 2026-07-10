import { useEffect, useSyncExternalStore } from "react"

import { readableError } from "@/lib/format"
import { listProjects, type Project } from "@/lib/generationApi"

/**
 * 当前项目（全局作用域）：localStorage 记住选择，CustomEvent 同步当前页，
 * storage 事件同步其他标签页。所有 API 调用仍由业务页面显式携带 project id。
 */

const STORAGE_KEY = "pixelle.currentProjectId"
const EVENT_NAME = "pixelle-current-project-change"

export type ProjectLoadStatus = "idle" | "loading" | "ready" | "error"

type Snapshot = {
  projectId: string | null
  defaultProjectId: string | null
  projects: Project[]
  status: ProjectLoadStatus
  error: string | null
}

let snapshot: Snapshot = {
  projectId: null,
  defaultProjectId: null,
  projects: [],
  status: "idle",
  error: null,
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
    // 存储不可用不影响当前会话中的项目状态。
  }
}

function emit() {
  window.dispatchEvent(new Event(EVENT_NAME))
}

function subscribe(callback: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) {
      return
    }
    const projectId = resolveProjectId(
      event.newValue,
      snapshot.projects,
      snapshot.defaultProjectId
    )
    if (projectId !== snapshot.projectId) {
      snapshot = { ...snapshot, projectId }
    }
    callback()
  }

  window.addEventListener(EVENT_NAME, callback)
  window.addEventListener("storage", handleStorage)
  return () => {
    window.removeEventListener(EVENT_NAME, callback)
    window.removeEventListener("storage", handleStorage)
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

export function refreshProjects(): Promise<void> {
  if (loadPromise) {
    return loadPromise
  }

  snapshot = { ...snapshot, status: "loading", error: null }
  emit()

  loadPromise = listProjects()
    .then((response) => {
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
        status: "ready",
        error: null,
      }
      emit()
    })
    .catch((error: unknown) => {
      snapshot = {
        ...snapshot,
        status: "error",
        error: readableError(error),
      }
      emit()
    })
    .finally(() => {
      loadPromise = null
    })

  return loadPromise
}

function ensureLoaded() {
  if (snapshot.status !== "idle") {
    return
  }
  void refreshProjects()
}

export function setCurrentProjectId(projectId: string) {
  const isActive = snapshot.projects.some(
    (project) => project.project_id === projectId && project.status === "active"
  )
  if (!isActive || projectId === snapshot.projectId) {
    return
  }
  writeStoredId(projectId)
  snapshot = { ...snapshot, projectId }
  emit()
}

export function useCurrentProject() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

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
    defaultProjectId: current.defaultProjectId,
    status: current.status,
    error: current.error,
    loaded: current.status === "ready" || current.status === "error",
    setProjectId: setCurrentProjectId,
    refresh: refreshProjects,
  }
}
