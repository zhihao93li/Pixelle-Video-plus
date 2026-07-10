import { useSyncExternalStore } from "react"

/**
 * 专家模式：开启后才显示 workflow / provider 级别的覆盖项。
 * 落实产品原则「普通用户不选择 provider、workflow、runtime」。
 */

const STORAGE_KEY = "pixelle-expert-mode"
const EVENT_NAME = "pixelle-expert-mode-change"

function read() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT_NAME, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(EVENT_NAME, callback)
    window.removeEventListener("storage", callback)
  }
}

export function setExpertMode(enabled: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled))
  } catch {
    // 存储不可用时静默失败
  }
  window.dispatchEvent(new Event(EVENT_NAME))
}

export function useExpertMode() {
  return useSyncExternalStore(subscribe, read)
}
