import { expect, test } from "playwright/test"

import { observeRuntimeErrors, preparePage, visitRoute } from "./fixtures/app"
import { installApiFixtures } from "./fixtures/api"
import { FORMAL_SURFACES } from "./fixtures/surfaces"

test.describe("正式路由", () => {
  for (const route of FORMAL_SURFACES) {
    test(`${route.path} 可达`, async ({ page }) => {
      const runtimeErrors = observeRuntimeErrors(page)
      const unhandledApi = await installApiFixtures(page)
      await preparePage(page)

      await visitRoute(page, route.path, route.heading)
      await expect(page).toHaveURL(new RegExp(`#${escapeRegExp(route.path)}$`))
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

  test("设置根路由规范化到概览 view", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/settings", { waitUntil: "domcontentloaded" })
    await expect(page).toHaveURL(/#\/settings\?view=overview$/)
    expect(unhandledApi).toEqual([])
  })
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
