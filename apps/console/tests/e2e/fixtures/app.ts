import { expect, type Page } from "playwright/test"

export type TestTheme = "light" | "dark"

export type SeededRunState =
  | "idle"
  | "uploading"
  | "submitting"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "interrupted"

export type SeededTrackedTask = ReturnType<typeof trackedTaskForState>

export const PRIMARY_ROUTES = [
  { label: "工作台", path: "/board" },
  { label: "快速生产", path: "/create" },
  { label: "作品库", path: "/library" },
  { label: "设置", path: "/settings" },
] as const

export const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "390x844", width: 390, height: 844 },
  { name: "320x568", width: 320, height: 568 },
] as const

export async function preparePage(
  page: Page,
  theme: TestTheme = "light",
  options: { trackedTasks?: SeededTrackedTask[] } = {}
) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
  await page.addInitScript(
    ({ selectedTheme, trackedTasks }) => {
      window.localStorage.setItem("pixelle-theme", selectedTheme)
      window.localStorage.setItem("pixelle.currentProjectId", "project-1")
      window.localStorage.setItem(
        "pixelle-task-center-v1",
        JSON.stringify(trackedTasks)
      )
    },
    { selectedTheme: theme, trackedTasks: options.trackedTasks ?? [] }
  )
}

export function trackedTaskForState(state: SeededRunState) {
  const percentage =
    state === "completed"
      ? 100
      : state === "failed" || state === "cancelled" || state === "interrupted"
        ? 62
        : state === "idle"
          ? 0
          : 38
  return {
    task: {
      task_id: `run-${state}`,
      pipeline_id: "script_to_video",
      status: state,
      progress: {
        stage: state,
        percentage,
        message: `当前状态：${state}`,
        current: null,
        total: null,
        detail: {},
      },
      error:
        state === "failed" || state === "interrupted"
          ? {
              layer: "runtime",
              message: "用于界面状态验收的故障信息。",
              exception_type: "FixtureError",
              detail: {},
            }
          : null,
      created_at: "2026-07-11T08:00:00Z",
      updated_at: "2026-07-11T08:01:00Z",
    },
    templateName: `状态验收·${state}`,
    submittedAt: "2026-07-11T08:00:00Z",
  }
}

export async function visitRoute(page: Page, path: string, heading: string) {
  await page.goto(`/#${path}`, { waitUntil: "domcontentloaded" })
  await expect(page.locator("#root")).not.toBeEmpty()
  await expect(
    page.getByRole("heading", { level: 1, name: heading, exact: true }).first()
  ).toBeVisible()
  await page.waitForLoadState("networkidle")
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const documentElement = document.documentElement
    const body = document.body
    return {
      body: body.scrollWidth - body.clientWidth,
      document: documentElement.scrollWidth - documentElement.clientWidth,
    }
  })
  expect(
    overflow.document,
    `document overflowed horizontally by ${overflow.document}px`
  ).toBeLessThanOrEqual(1)
  expect(
    overflow.body,
    `body overflowed horizontally by ${overflow.body}px`
  ).toBeLessThanOrEqual(1)
}

export function observeRuntimeErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(`console: ${message.text()}`)
    }
  })
  page.on("pageerror", (error) => {
    errors.push(`page: ${error.message}`)
  })
  return errors
}
