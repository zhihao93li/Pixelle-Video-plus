import { expect, test } from "playwright/test"

import { observeRuntimeErrors, preparePage, visitRoute } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

const FORMAL_ROUTES = [
  { path: "/board", heading: "工作台" },
  {
    path: `/board/item/${fixtureIds.contentItem}`,
    heading: "内容详情",
  },
  { path: "/create", heading: "快速生产" },
  {
    path: `/create/generate/${fixtureIds.videoTemplate}`,
    heading: "生成",
  },
  {
    path: `/create/recipes/${fixtureIds.videoTemplate}`,
    heading: "配方详情",
  },
  {
    path: `/create/special/image_to_video/${fixtureIds.specialTemplate}`,
    heading: "特殊视频生成",
  },
  { path: "/create/script-review", heading: "多语言审核出片" },
  { path: "/tasks", heading: "任务" },
  { path: "/library", heading: "作品库" },
  { path: "/settings", heading: "设置" },
  {
    path: `/settings/projects/${fixtureIds.project}`,
    heading: "项目详情",
  },
] as const

test.describe("正式路由", () => {
  for (const route of FORMAL_ROUTES) {
    test(`${route.path} 可达`, async ({ page }) => {
      const runtimeErrors = observeRuntimeErrors(page)
      const unhandledApi = await installApiFixtures(page)
      await preparePage(page)

      await visitRoute(page, route.path, route.heading)
      await expect(page).toHaveURL(
        new RegExp(`#${route.path.replace("?", "\\?")}`)
      )
      await expect(page.locator("html")).toHaveClass(/light/)
      expect(unhandledApi, "存在未定义的 E2E API fixture").toEqual([])
      expect(runtimeErrors, "页面产生了运行时错误").toEqual([])
    })
  }

  test("未知路由显示 404，不回落快速生产", async ({ page }) => {
    const runtimeErrors = observeRuntimeErrors(page)
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)

    await visitRoute(page, "/route-that-does-not-exist", "页面不存在")
    await expect(page).toHaveURL(/#\/route-that-does-not-exist$/)
    await expect(
      page.getByRole("heading", { level: 1, name: "快速生产", exact: true })
    ).toHaveCount(0)
    expect(unhandledApi, "404 页不应请求业务 API").toEqual([])
    expect(runtimeErrors, "404 页产生了运行时错误").toEqual([])
  })
})
