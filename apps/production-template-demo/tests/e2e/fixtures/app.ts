import { expect, type Page } from "playwright/test"

export type TestTheme = "light" | "dark"

export const PRIMARY_ROUTES = [
  { label: "工作台", path: "/board" },
  { label: "快速生产", path: "/create" },
  { label: "任务", path: "/tasks" },
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

export async function preparePage(page: Page, theme: TestTheme = "light") {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" })
  await page.addInitScript(
    ({ selectedTheme }) => {
      window.localStorage.setItem("pixelle-theme", selectedTheme)
      window.localStorage.setItem("pixelle.currentProjectId", "project-1")
      window.localStorage.setItem("pixelle-task-center-v1", "[]")
    },
    { selectedTheme: theme }
  )
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
