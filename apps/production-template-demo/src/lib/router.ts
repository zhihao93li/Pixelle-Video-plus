import { useSyncExternalStore } from "react"

/**
 * 极简 hash 路由：`#/create/generate/xxx?task=yyy`。
 * 不引入外部依赖；刷新可恢复、可前进后退、可分享。
 */

const DEFAULT_PATH = "/create"

function readPath() {
  const hash = window.location.hash.replace(/^#/, "")
  return hash || DEFAULT_PATH
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback)
  return () => window.removeEventListener("hashchange", callback)
}

/** 当前完整路径（含 query），随 hash 变化自动更新。 */
export function usePath() {
  return useSyncExternalStore(subscribe, readPath)
}

export function navigate(path: string) {
  window.location.hash = path
}

export type ParsedRoute = {
  segments: string[]
  query: URLSearchParams
}

export function parsePath(path: string): ParsedRoute {
  const [pathname, search] = path.split("?")
  return {
    segments: pathname.split("/").filter(Boolean),
    query: new URLSearchParams(search ?? ""),
  }
}
