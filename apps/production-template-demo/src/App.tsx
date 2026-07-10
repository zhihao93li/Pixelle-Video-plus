import { useEffect } from "react"

import { AppShell } from "@/components/AppShell"
import { CreateGallery } from "@/components/CreateGallery"
import { GenerateWorkspace } from "@/components/ProductionStudio"
import { HistoryWorkspace } from "@/components/HistoryWorkspace"
import { ScriptReviewWorkspace } from "@/components/ScriptReviewWorkspace"
import { SettingsWorkspace } from "@/components/SettingsWorkspace"
import {
  SpecialPipelinesWorkspace,
  type SpecialPipelineMode,
} from "@/components/SpecialPipelinesWorkspace"
import { TaskCenterWorkspace } from "@/components/TaskCenterWorkspace"
import { WorkbenchBoard } from "@/components/WorkbenchBoard"
import { ContentItemDetailPage } from "@/components/ContentItemDetailPage"
import { ProjectDetailPage } from "@/components/ProjectDetailPage"
import { RecipeDetailPage } from "@/components/RecipeDetailPage"
import { navigate, parsePath, usePath } from "@/lib/router"

const SPECIAL_MODES: SpecialPipelineMode[] = [
  "image_to_video",
  "action_transfer",
  "digital_human",
]

function isSpecialMode(value: string): value is SpecialPipelineMode {
  return (SPECIAL_MODES as string[]).includes(value)
}

export function App() {
  const path = usePath()
  const { segments, query } = parsePath(path)

  let title = "快速生产"
  let content = <CreateGallery />

  if (segments[0] === "batch") {
    // 旧顶层 /batch 书签重定向到快速生产
    title = "快速生产"
    content = <RedirectTo path="/create" />
  } else if (segments[0] === "board") {
    if (segments[1] === "item" && segments[2]) {
      title = "内容详情"
      content = <ContentItemDetailPage itemId={segments[2]} key={segments[2]} />
    } else {
      title = "工作台"
      content = <WorkbenchBoard />
    }
  } else if (segments[0] === "create") {
    if (segments[1] === "generate" && segments[2]) {
      // 产物已非仅视频（图文/长文直跑也走这条路由），标题用中性「生成」
      title = "生成"
      content = (
        <GenerateWorkspace key={segments[2]} templateId={segments[2]} />
      )
    } else if (segments[1] === "recipes" && segments[2]) {
      title = "配方详情"
      content = (
        <RecipeDetailPage key={segments[2]} templateId={segments[2]} />
      )
    } else if (segments[1] === "special" && isSpecialMode(segments[2] ?? "")) {
      const mode = segments[2] as SpecialPipelineMode
      title = "特殊视频生成"
      content = <SpecialPipelinesWorkspace initialMode={mode} key={mode} />
    } else if (segments[1] === "script-review") {
      title = "多语言审核出片"
      content = <ScriptReviewWorkspace />
    } else if (segments[1] === "batch") {
      // 批量已改为生成页的提交模式；旧入口重定向到快速生产（防书签断链）
      title = "快速生产"
      content = <RedirectTo path="/create" />
    }
  } else if (segments[0] === "tasks") {
    title = "任务"
    content = <TaskCenterWorkspace />
  } else if (segments[0] === "library") {
    title = "作品库"
    content = (
      <HistoryWorkspace
        key={query.get("task") ?? "library"}
        latestTaskId={query.get("task")}
      />
    )
  } else if (segments[0] === "settings") {
    if (segments[1] === "projects" && segments[2]) {
      title = "项目详情"
      content = <ProjectDetailPage key={segments[2]} projectId={segments[2]} />
    } else {
      title = "设置"
      content = <SettingsWorkspace />
    }
  }

  return (
    <AppShell path={path} title={title}>
      {content}
    </AppShell>
  )
}

/** 极简重定向：hash 路由下挂载即跳转到目标路径。 */
function RedirectTo({ path }: { path: string }) {
  useEffect(() => {
    navigate(path)
  }, [path])
  return null
}

export default App
