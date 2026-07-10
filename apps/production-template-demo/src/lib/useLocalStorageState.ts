import { useEffect, useState } from "react"

/** 带 localStorage 持久化的 useState，用于表单草稿等轻量状态。 */
export function useLocalStorageState<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored != null) {
        return JSON.parse(stored) as T
      }
    } catch {
      // 忽略损坏的存档
    }
    return initialValue
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 存储满/隐私模式时静默失败
    }
  }, [key, value])

  return [value, setValue] as const
}
