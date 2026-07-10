/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { useToast } from "@/components/ui/toast"
import {
  getTask,
  isTerminalStatus,
  type GenerationTask,
} from "@/lib/generationApi"

/**
 * 全局任务中心：本会话（及历史会话）提交的生成任务统一在这里跟踪。
 * - 单一轮询源：所有页面共享，切页不丢任务
 * - 终态 toast 通知
 * - localStorage 持久化，刷新后恢复并继续轮询
 */

export type TrackedTask = {
  task: GenerationTask
  templateName: string | null
  submittedAt: string
}

type TaskCenterValue = {
  tasks: TrackedTask[]
  runningCount: number
  trackTask: (task: GenerationTask, templateName?: string | null) => void
  updateTask: (task: GenerationTask) => void
  removeTask: (taskId: string) => void
  getTask: (taskId: string) => TrackedTask | undefined
}

const STORAGE_KEY = "pixelle-task-center-v1"
const MAX_TRACKED = 50
const POLL_INTERVAL_MS = 2500

const TaskCenterContext = createContext<TaskCenterValue | null>(null)

export function useTaskCenter() {
  const value = useContext(TaskCenterContext)
  if (!value) {
    throw new Error("useTaskCenter 必须在 TaskCenterProvider 内使用")
  }
  return value
}

function loadStoredTasks(): TrackedTask[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      return []
    }
    const parsed = JSON.parse(stored) as TrackedTask[]
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item) => item?.task?.task_id)
  } catch {
    return []
  }
}

export function TaskCenterProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const toast = useToast()
  const [tasks, setTasks] = useState<TrackedTask[]>(loadStoredTasks)
  const notifiedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(tasks.slice(0, MAX_TRACKED))
      )
    } catch {
      // 存储不可用时静默失败
    }
  }, [tasks])

  const notifyIfTerminal = useCallback(
    (task: GenerationTask) => {
      if (!isTerminalStatus(task.status)) {
        return
      }
      const key = `${task.task_id}:${task.status}`
      if (notifiedRef.current.has(key)) {
        return
      }
      notifiedRef.current.add(key)
      if (task.status === "completed") {
        toast({ title: "视频生成完成", variant: "success" })
      } else if (task.status === "failed") {
        toast({
          title: "生成失败",
          description: task.error?.message,
          variant: "error",
        })
      } else if (task.status === "cancelled") {
        toast({ title: "任务已取消" })
      }
    },
    [toast]
  )

  // 恢复的历史任务不重复通知
  useEffect(() => {
    for (const item of loadStoredTasks()) {
      if (isTerminalStatus(item.task.status)) {
        notifiedRef.current.add(`${item.task.task_id}:${item.task.status}`)
      }
    }
  }, [])

  const trackTask = useCallback(
    (task: GenerationTask, templateName: string | null = null) => {
      setTasks((current) => {
        const rest = current.filter(
          (item) => item.task.task_id !== task.task_id
        )
        return [
          { task, templateName, submittedAt: new Date().toISOString() },
          ...rest,
        ].slice(0, MAX_TRACKED)
      })
    },
    []
  )

  const updateTask = useCallback(
    (task: GenerationTask) => {
      notifyIfTerminal(task)
      setTasks((current) =>
        current.map((item) =>
          item.task.task_id === task.task_id ? { ...item, task } : item
        )
      )
    },
    [notifyIfTerminal]
  )

  const removeTask = useCallback((taskId: string) => {
    setTasks((current) =>
      current.filter((item) => item.task.task_id !== taskId)
    )
  }, [])

  const activeIds = tasks
    .filter((item) => !isTerminalStatus(item.task.status))
    .map((item) => item.task.task_id)
    .join(",")

  useEffect(() => {
    if (!activeIds) {
      return undefined
    }

    let cancelled = false
    const ids = activeIds.split(",")
    const interval = window.setInterval(async () => {
      const results = await Promise.allSettled(ids.map((id) => getTask(id)))
      if (cancelled) {
        return
      }
      const updated = results
        .filter(
          (result): result is PromiseFulfilledResult<GenerationTask> =>
            result.status === "fulfilled"
        )
        .map((result) => result.value)
      if (updated.length === 0) {
        return
      }
      for (const task of updated) {
        notifyIfTerminal(task)
      }
      setTasks((current) =>
        current.map((item) => {
          const next = updated.find(
            (task) => task.task_id === item.task.task_id
          )
          return next ? { ...item, task: next } : item
        })
      )
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [activeIds, notifyIfTerminal])

  const value = useMemo<TaskCenterValue>(
    () => ({
      tasks,
      runningCount: tasks.filter(
        (item) => !isTerminalStatus(item.task.status)
      ).length,
      trackTask,
      updateTask,
      removeTask,
      getTask: (taskId: string) =>
        tasks.find((item) => item.task.task_id === taskId),
    }),
    [tasks, trackTask, updateTask, removeTask]
  )

  return (
    <TaskCenterContext.Provider value={value}>
      {children}
    </TaskCenterContext.Provider>
  )
}
