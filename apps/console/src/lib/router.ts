import { useSyncExternalStore } from "react"

/**
 * 轻量 hash 路由：`#/create/generate/xxx?task=yyy`。
 *
 * 路由清单是页面标题、布局和项目作用域的唯一来源。页面组件仍由 App
 * 负责装配，避免把组件依赖带进路由基础层。
 */

const DEFAULT_PATH = "/create"

export type RouteLayout = "standard" | "wide" | "narrow" | "workspace"

export type RouteId =
  | "board"
  | "board-task"
  | "board-item"
  | "create"
  | "create-generate"
  | "create-recipe"
  | "create-special"
  | "library"
  | "settings"
  | "settings-project"

export type RouteParams = Record<string, string>

export type RouteDefinition = {
  id: RouteId
  path: string
  title: string
  layout: RouteLayout
  projectScoped: boolean
  nav?: {
    label: string
    path: string
    order: number
  }
  match: (segments: string[]) => RouteParams | null
}

export type ParsedRoute = {
  pathname: string
  segments: string[]
  query: URLSearchParams
}

export type ResolvedRoute = {
  id: RouteId | "not-found"
  title: string
  layout: RouteLayout
  projectScoped: boolean
  params: RouteParams
  pathname: string
  query: URLSearchParams
}

const SPECIAL_MODES = new Set([
  "image_to_video",
  "action_transfer",
  "digital_human",
])

function exact(...expected: string[]) {
  return (segments: string[]) =>
    segments.length === expected.length &&
    expected.every((segment, index) => segments[index] === segment)
      ? {}
      : null
}

export const ROUTE_MANIFEST: readonly RouteDefinition[] = [
  {
    id: "board-task",
    path: "/board/tasks/:taskId",
    title: "生产任务",
    layout: "standard",
    projectScoped: true,
    match: (segments) =>
      segments.length === 3 &&
      segments[0] === "board" &&
      segments[1] === "tasks"
        ? { taskId: segments[2] }
        : null,
  },
  {
    id: "board-item",
    path: "/board/item/:itemId",
    title: "内容详情",
    layout: "standard",
    projectScoped: true,
    match: (segments) =>
      segments.length === 3 && segments[0] === "board" && segments[1] === "item"
        ? { itemId: segments[2] }
        : null,
  },
  {
    id: "board",
    path: "/board",
    title: "工作台",
    layout: "wide",
    projectScoped: true,
    nav: { label: "工作台", path: "/board", order: 1 },
    match: exact("board"),
  },
  {
    id: "create-generate",
    path: "/create/generate/:templateId",
    title: "生成",
    layout: "workspace",
    projectScoped: true,
    match: (segments) =>
      segments.length === 3 &&
      segments[0] === "create" &&
      segments[1] === "generate"
        ? { templateId: segments[2] }
        : null,
  },
  {
    id: "create-recipe",
    path: "/create/recipes/:templateId",
    title: "模板详情",
    layout: "standard",
    projectScoped: true,
    match: (segments) =>
      segments.length === 3 &&
      segments[0] === "create" &&
      segments[1] === "recipes"
        ? { templateId: segments[2] }
        : null,
  },
  {
    id: "create-special",
    path: "/create/special/:mode/:templateId",
    title: "特殊视频生成",
    layout: "workspace",
    projectScoped: true,
    match: (segments) => {
      const mode = segments[2]
      if (
        segments.length !== 4 ||
        segments[0] !== "create" ||
        segments[1] !== "special" ||
        !SPECIAL_MODES.has(mode)
      ) {
        return null
      }
      return { mode, templateId: segments[3] }
    },
  },
  {
    id: "create",
    path: "/create",
    title: "快速生产",
    layout: "wide",
    projectScoped: true,
    nav: { label: "快速生产", path: "/create", order: 2 },
    match: exact("create"),
  },
  {
    id: "library",
    path: "/library",
    title: "作品库",
    layout: "wide",
    projectScoped: true,
    nav: { label: "作品库", path: "/library", order: 3 },
    match: exact("library"),
  },
  {
    id: "settings-project",
    path: "/settings/projects/:projectId",
    title: "内容空间详情",
    layout: "standard",
    projectScoped: true,
    match: (segments) =>
      segments.length === 3 &&
      segments[0] === "settings" &&
      segments[1] === "projects"
        ? { projectId: segments[2] }
        : null,
  },
  {
    id: "settings",
    path: "/settings",
    title: "设置",
    layout: "standard",
    projectScoped: false,
    nav: { label: "设置", path: "/settings", order: 4 },
    match: exact("settings"),
  },
] as const

export const PRIMARY_NAV_ROUTES = ROUTE_MANIFEST.filter(
  (
    route
  ): route is RouteDefinition & {
    nav: NonNullable<RouteDefinition["nav"]>
  } => route.nav != null
).sort((left, right) => left.nav.order - right.nav.order)

function readPath() {
  const hash = window.location.hash.replace(/^#/, "")
  return normalizePath(hash || DEFAULT_PATH)
}

function subscribe(callback: () => void) {
  window.addEventListener("hashchange", callback)
  return () => window.removeEventListener("hashchange", callback)
}

/** 当前完整路径（含 query），随 hash 变化自动更新。 */
export function usePath() {
  return useSyncExternalStore(subscribe, readPath, () => DEFAULT_PATH)
}

export function navigate(path: string) {
  window.location.hash = normalizePath(path)
}

/** 可用于真实链接的 hash href；保留浏览器前进、后退和新窗口语义。 */
export function routeHref(path: string) {
  return `#${normalizePath(path)}`
}

export function parsePath(path: string): ParsedRoute {
  const questionMark = path.indexOf("?")
  const rawPathname = questionMark >= 0 ? path.slice(0, questionMark) : path
  const search = questionMark >= 0 ? path.slice(questionMark + 1) : ""
  const pathname = normalizePath(rawPathname)
  return {
    pathname,
    segments: pathname.split("/").filter(Boolean).map(decodeSegment),
    query: new URLSearchParams(search),
  }
}

export function resolveRoute(path: string): ResolvedRoute {
  const parsed = parsePath(path)
  for (const route of ROUTE_MANIFEST) {
    const params = route.match(parsed.segments)
    if (params) {
      return {
        id: route.id,
        title: route.title,
        layout: route.layout,
        projectScoped: route.projectScoped,
        params,
        pathname: parsed.pathname,
        query: parsed.query,
      }
    }
  }
  return {
    id: "not-found",
    title: "页面不存在",
    layout: "standard",
    projectScoped: false,
    params: {},
    pathname: parsed.pathname,
    query: parsed.query,
  }
}

export function isNavigationActive(path: string, navigationPath: string) {
  const { pathname } = parsePath(path)
  return (
    pathname === navigationPath || pathname.startsWith(`${navigationPath}/`)
  )
}

function normalizePath(path: string) {
  const trimmed = path.trim()
  if (!trimmed || trimmed === "/") {
    return DEFAULT_PATH
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

function decodeSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
