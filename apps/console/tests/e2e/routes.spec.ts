import { expect, test } from "playwright/test"

import { observeRuntimeErrors, preparePage, visitRoute } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"
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
    await expect(
      page.getByRole("heading", { name: "提示词库", exact: true })
    ).toBeVisible()
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
    await expect(
      page.getByRole("button", { name: /AiHubMix 主账号/ })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: /OpenAI 直连/ })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "添加 LLM 服务" })
    ).toBeVisible()
    const platformSelect = page.getByLabel("接入平台")
    await expect(platformSelect).toHaveValue("aihubmix")
    await expect(platformSelect).toContainText("DeepSeek")
    await expect(platformSelect).toContainText("MiniMax")
    await expect(platformSelect).toContainText("Kimi / Moonshot AI")
    await expect(platformSelect).toContainText("Anthropic / Claude")
    await expect(platformSelect).toContainText("xAI / Grok")
    await expect(page.getByLabel("服务名称")).toHaveValue("AiHubMix 主账号")
    await expect(page.getByText("服务 ID", { exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "添加 LLM 服务" }).click()
    await page.getByLabel("接入平台").selectOption("xai")
    await expect(page.getByLabel("服务名称")).toHaveValue("xAI / Grok")
    await expect(page.getByLabel("API 地址")).toHaveValue("https://api.x.ai/v1")
    expect(unhandledApi).toEqual([])
  })
})

test("工作台生产任务卡进入同一稳定任务详情", async ({ page }) => {
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  const unhandledApi = await installApiFixtures(page, {
    contentItemStatus: "pending_review",
    captureJsonRequests: requests,
  })
  await preparePage(page)
  await page.goto("/#/board/tasks/production-needs_user", {
    waitUntil: "networkidle",
  })

  await expect(
    page.getByRole("heading", { name: "猫咪为什么喜欢猫薄荷", level: 2 })
  ).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "确认文案", level: 2 })
  ).toBeVisible()
  await expect(page.getByLabel("正文")).toHaveValue(
    "猫薄荷会通过嗅觉让一部分猫咪短暂兴奋。"
  )
  await expect(page.getByRole("group", { name: "分镜" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "加一镜" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "让系统重写" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "确认文案并继续" })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "审核中文版" })).toHaveCount(0)
  await expect(page.getByRole("heading", { name: "最新记录" })).toBeVisible()
  await expect(page.locator('[data-event-id^="revision:"]')).toHaveCount(0)
  await expect(page.getByRole("link", { name: "内容详情" })).toHaveCount(0)

  await page.getByRole("button", { name: "确认文案并继续" }).click()
  await expect
    .poll(
      () =>
        requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/content-items/content-1/confirm"
        ).length
    )
    .toBe(1)
  expect(
    requests.find(
      (request) =>
        request.method === "POST" &&
        request.path === "/content-items/content-1/confirm"
    )?.body
  ).toMatchObject({
    review_id: "revision-script-1",
    content_version: "v1",
  })
  expect(unhandledApi).toEqual([])
})

test("已关联生产任务的旧内容链接自动归一到任务详情", async ({ page }) => {
  const unhandledApi = await installApiFixtures(page, {
    contentItemStatus: "pending_review",
    linkContentToProductionTask: true,
  })
  await preparePage(page)
  await page.goto(`/#/board/item/${fixtureIds.contentItem}`, {
    waitUntil: "networkidle",
  })

  await expect(page).toHaveURL(/#\/board\/tasks\/production-needs_user$/)
  await expect(
    page.getByRole("heading", { name: "确认文案", level: 2 })
  ).toBeVisible()
  await expect(page.getByRole("heading", { name: "内容版本" })).toHaveCount(0)
  expect(unhandledApi).toEqual([])
})

test("同为待确认状态时从文案站切到分镜站会载入新的服务端版本", async ({
  page,
}) => {
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  const unhandledApi = await installApiFixtures(page, {
    captureJsonRequests: requests,
    productionReviewKind: "script",
    transitionScriptToScenes: true,
  })
  await preparePage(page)
  await page.goto("/#/board/tasks/production-needs_user", {
    waitUntil: "networkidle",
  })

  await page.getByRole("button", { name: "确认文案并继续" }).click()
  await expect(page.getByText("确认分镜 · 2 镜", { exact: true })).toBeVisible()
  await expect(page.getByLabel("第 1 镜文案")).toHaveValue("猫咪先闻到猫薄荷。")

  const confirmScenes = page.getByRole("button", {
    name: "确认分镜并继续",
  })
  await expect(confirmScenes).toBeEnabled()
  await confirmScenes.click()
  await expect
    .poll(
      () =>
        requests.filter(
          (request) =>
            request.method === "POST" &&
            request.path === "/content-items/content-1/confirm"
        ).length
    )
    .toBe(2)
  expect(
    requests.filter((request) => request.path.endsWith("/revise-review"))
  ).toEqual([])
  expect(unhandledApi).toEqual([])
})

test("生产任务只在分镜确认站展示分镜编辑", async ({ page }) => {
  const unhandledApi = await installApiFixtures(page, {
    productionReviewKind: "scenes",
  })
  await preparePage(page)
  await page.goto("/#/board/tasks/production-needs_user", {
    waitUntil: "networkidle",
  })

  await expect(page.getByText("确认分镜 · 2 镜", { exact: true })).toBeVisible()
  await expect(page.getByLabel("第 1 镜文案")).toBeVisible()
  await expect(page.getByLabel("正文")).toHaveCount(0)
  await expect(page.getByText("查看原始文案", { exact: true })).toBeVisible()
  await expect(
    page.getByText("猫薄荷会通过嗅觉让一部分猫咪短暂兴奋。", {
      exact: true,
    })
  ).not.toBeVisible()
  await page.getByText("查看原始文案", { exact: true }).click()
  await expect(
    page.getByText("猫薄荷会通过嗅觉让一部分猫咪短暂兴奋。", {
      exact: true,
    })
  ).toBeVisible()
  await expect(page.getByRole("button", { name: "整套重新生成" })).toBeVisible()
  await expect(
    page.getByRole("button", { name: "确认分镜并继续" })
  ).toHaveCount(1)
  await expect(
    page.getByRole("button", { name: "确认完整分镜", exact: true })
  ).toHaveCount(0)
  expect(unhandledApi).toEqual([])
})

test("图文任务只在分页确认站展示分页编辑", async ({ page }) => {
  const unhandledApi = await installApiFixtures(page, {
    productionReviewKind: "pages",
  })
  await preparePage(page)
  await page.goto("/#/board/tasks/production-needs_user", {
    waitUntil: "networkidle",
  })

  await expect(page.getByText("确认分页 · 2 页", { exact: true })).toBeVisible()
  await expect(page.getByLabel("第 1 页文案")).toBeVisible()
  await expect(page.getByLabel("正文")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "确认分页并继续" })
  ).toHaveCount(1)
  await expect(
    page.getByRole("button", { name: "确认分页", exact: true })
  ).toHaveCount(0)
  expect(unhandledApi).toEqual([])
})

test("修改分镜后用新版本确认同一审核对象", async ({ page }) => {
  const requests: Array<{ method: string; path: string; body: unknown }> = []
  const unhandledApi = await installApiFixtures(page, {
    captureJsonRequests: requests,
    productionReviewKind: "scenes",
  })
  await preparePage(page)
  await page.goto("/#/board/tasks/production-needs_user", {
    waitUntil: "networkidle",
  })

  await page.getByLabel("第 1 镜文案").fill("修改后的第一镜。")
  await page.getByRole("button", { name: "确认分镜并继续" }).click()

  await expect
    .poll(
      () =>
        requests.filter((request) => request.path.endsWith("/revise-review"))
          .length
    )
    .toBe(1)
  await expect
    .poll(
      () =>
        requests.filter((request) => request.path.endsWith("/confirm")).length
    )
    .toBe(1)
  expect(requests[0]?.body).toMatchObject({
    review_id: "revision-video_scenes-1",
    content_version: "v1",
  })
  expect(requests[1]?.body).toMatchObject({
    review_id: "revision-video_scenes-2",
    content_version: "v2",
  })
  expect(unhandledApi).toEqual([])
})

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
