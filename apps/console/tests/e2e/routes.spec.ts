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

  test("提示词库可独立管理写稿与分镜提示词", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/settings?view=prompts", { waitUntil: "networkidle" })
    await expect(page.getByRole("heading", { name: "提示词库", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "写稿提示词" })).toBeVisible()
    await expect(page.getByRole("button", { name: "分镜提示词" })).toBeVisible()
    await expect(page.getByRole("button", { name: "复制并编辑" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("设置中心展示多条真实 LLM 服务", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/settings?view=ai-voice", { waitUntil: "networkidle" })
    await expect(page.getByRole("heading", { name: "LLM 服务" })).toBeVisible()
    await expect(page.getByRole("button", { name: /AiHubMix 主账号/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /OpenAI 直连/ })).toBeVisible()
    await expect(page.getByRole("button", { name: "添加 LLM 服务" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })
})

test("工作台生产任务卡进入同一稳定任务详情", async ({ page }) => {
  const unhandledApi = await installApiFixtures(page)
  await preparePage(page)
  await page.goto("/#/board/tasks/production-needs_user", {
    waitUntil: "networkidle",
  })

  await expect(
    page.getByRole("heading", { name: "猫咪为什么喜欢猫薄荷", level: 2 })
  ).toBeVisible()
  await expect(page.getByText("待你处理", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: /确认文案/ })).toHaveAttribute(
    "href",
    "#/board/item/content-1"
  )
  expect(unhandledApi).toEqual([])
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
