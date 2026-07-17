import { expect, test } from "playwright/test"

import { preparePage } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

test.describe("项目边界与页面异步状态", () => {
  test("ProjectScope loading", async ({ page }) => {
    await installApiFixtures(page, { projectState: "loading", delayMs: 5_000 })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "domcontentloaded" })

    const boundary = page.locator('[data-slot="project-scope-boundary"]')
    await expect(boundary).toHaveAttribute("data-state", "loading")
    await expect(boundary.getByText("正在读取内容空间…")).toBeVisible()
  })

  test("ProjectScope empty", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      projectState: "empty",
    })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "networkidle" })

    const boundary = page.locator('[data-slot="project-scope-boundary"]')
    await expect(boundary).toHaveAttribute("data-state", "empty")
    await expect(page.getByText("暂无可用内容空间")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "管理内容空间" })
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("ProjectScope error", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      projectState: "error",
    })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "networkidle" })

    const boundary = page.locator('[data-slot="project-scope-boundary"]')
    await expect(boundary).toHaveAttribute("data-state", "error")
    await expect(page.getByText("内容空间读取失败")).toBeVisible()
    await expect(
      page.getByRole("button", { name: "重新读取" }).last()
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("Production loading", async ({ page }) => {
    await installApiFixtures(page, {
      productionState: "loading",
      delayMs: 5_000,
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "domcontentloaded",
    })

    await expect(page.getByText("正在读取可用模板")).toBeVisible()
  })

  test("Production empty 显示无可用模板并给出恢复动作", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      productionState: "empty",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    await expect(page.getByText("模板读取失败")).toBeVisible()
    await expect(
      page.getByText(
        "指定模板不存在或当前项目无权使用，请返回快速生产重新选择。"
      )
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("Production error", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      productionState: "error",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    await expect(page.getByText("模板读取失败")).toBeVisible()
    await expect(page.getByText("模板服务暂时不可用。")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("Production 无效显式模板不回落到默认模板", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/create/generate/no-such-template", {
      waitUntil: "networkidle",
    })

    await expect(page.getByText("模板读取失败")).toBeVisible()
    await expect(
      page.getByText(/指定模板不存在或当前项目无权使用/)
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "返回快速生产" })
    ).toBeVisible()
    await expect(page.getByLabel("视频文案", { exact: true })).toHaveCount(0)
    expect(unhandledApi).toEqual([])
  })

  test("Production 资源降级时保留可编辑主表面", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      productionState: "resource-error",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    await expect(page.getByLabel("视频文案", { exact: true })).toBeVisible()
    await expect(page.getByText("部分资源未同步")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("CreateGallery 模板默认值失败不伪装成出厂设置", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      configState: "error",
    })
    await preparePage(page)
    await page.goto("/#/create", { waitUntil: "networkidle" })

    await expect(page.getByText("无法读取模板默认设置")).toBeVisible()
    await expect(
      page.getByText("默认设置暂时无法读取", { exact: true }).first()
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "重新读取默认设置" })
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("Settings loading", async ({ page }) => {
    await installApiFixtures(page, { settingsState: "loading", delayMs: 5_000 })
    await preparePage(page)
    await page.goto("/#/settings?view=overview", {
      waitUntil: "domcontentloaded",
    })

    await expect(page.getByText("正在读取系统设置")).toBeVisible()
  })

  test("Settings help empty", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, { helpState: "empty" })
    await preparePage(page)
    await page.goto("/#/settings?view=help", { waitUntil: "networkidle" })

    await expect(page.getByText("暂无帮助内容")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("Settings error", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      settingsState: "error",
    })
    await preparePage(page)
    await page.goto("/#/settings?view=overview", { waitUntil: "networkidle" })

    await expect(page.getByText("系统设置读取失败")).toBeVisible()
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("Settings stale 保留旧数据并提供重读", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      settingsState: "stale",
    })
    await preparePage(page)
    await page.goto("/#/settings?view=overview", { waitUntil: "networkidle" })
    await expect(page.getByText("系统概览")).toBeVisible()

    await page.getByRole("button", { name: "刷新系统设置" }).click()
    await expect(page.getByText("系统设置可能不是最新状态")).toBeVisible()
    await expect(page.getByText("系统概览")).toBeVisible()
    await expect(page.getByRole("button", { name: "重新读取" })).toBeVisible()
    await expect(page).toHaveScreenshot("desktop-settings-stale.png", {
      animations: "disabled",
      caret: "hide",
      fullPage: false,
      scale: "css",
    })
    expect(unhandledApi).toEqual([])
  })
})

test.describe("内容工作台异步状态", () => {
  test("工作台 loading", async ({ page }) => {
    await installApiFixtures(page, {
      contentState: "loading",
      delayMs: 5_000,
    })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "domcontentloaded" })

    await expect(page.getByText("正在读取任务…")).toBeVisible()
  })

  test("工作台 empty", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      contentState: "empty",
    })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "networkidle" })

    await expect(page.getByText("还没有生产任务")).toBeVisible()
    await expect(page.getByRole("link", { name: "去快速生产" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("工作台 error", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      contentState: "error",
    })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "networkidle" })

    await expect(page.getByText("任务读取失败")).toBeVisible()
    await expect(page.getByRole("button", { name: "重新读取" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("工作台 stale 保留上次内容", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      contentState: "stale",
    })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "networkidle" })

    await expect(page.getByText("猫咪为什么喜欢猫薄荷").last()).toBeVisible()
    await page.getByRole("button", { name: "刷新" }).click()
    await expect(page.getByText("任务状态可能已过期")).toBeVisible()
    await expect(page.getByText("猫咪为什么喜欢猫薄荷").last()).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("内容详情 loading 与 error 都有就地反馈", async ({ page }) => {
    await installApiFixtures(page, {
      contentDetailState: "loading",
      delayMs: 5_000,
    })
    await preparePage(page)
    await page.goto(`/#/board/item/${fixtureIds.contentItem}`, {
      waitUntil: "domcontentloaded",
    })
    await expect(page.getByText("正在读取内容…")).toBeVisible()

    const errorPage = await page.context().newPage()
    const unhandledApi = await installApiFixtures(errorPage, {
      contentDetailState: "error",
    })
    await preparePage(errorPage)
    await errorPage.goto(`/#/board/item/${fixtureIds.contentItem}`, {
      waitUntil: "networkidle",
    })
    await expect(errorPage.getByText("内容读取失败")).toBeVisible()
    await expect(
      errorPage.getByRole("button", { name: "重新读取" })
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("内容详情 stale 保留当前阶段和唯一下一步", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      contentDetailState: "stale",
      contentItemStatus: "drafting",
    })
    await preparePage(page)
    await page.goto(`/#/board/item/${fixtureIds.contentItem}`, {
      waitUntil: "networkidle",
    })

    const lifecycle = page
      .locator("[data-slot=workspace-panel]")
      .filter({ hasText: "生命周期" })
      .filter({ visible: true })
      .first()
    await expect(lifecycle.getByText("起草中", { exact: true })).toBeVisible()
    await lifecycle.getByRole("button", { name: "刷新状态" }).click()
    await expect(page.getByText("内容可能已过期")).toBeVisible()
    await expect(
      lifecycle.getByRole("button", { name: "刷新状态" })
    ).toHaveCount(1)
    expect(unhandledApi).toEqual([])
  })
})

test.describe("作品异步状态", () => {
  for (const scenario of [
    { state: "empty" as const, title: "还没有作品" },
    { state: "error" as const, title: "无法读取作品库" },
  ]) {
    test(`作品库 ${scenario.state}`, async ({ page }) => {
      const unhandledApi = await installApiFixtures(page, {
        historyState: scenario.state,
      })
      await preparePage(page)
      await page.goto("/#/library", { waitUntil: "networkidle" })
      await expect(page.getByText(scenario.title)).toBeVisible()
      expect(unhandledApi).toEqual([])
    })
  }

  test("作品库 loading", async ({ page }) => {
    await installApiFixtures(page, {
      historyState: "loading",
      delayMs: 5_000,
    })
    await preparePage(page)
    await page.goto("/#/library", { waitUntil: "domcontentloaded" })
    await expect(page.getByText("正在读取作品库")).toBeVisible()
  })

  test("作品库 stale 保留列表与选中项", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      historyState: "stale",
    })
    await preparePage(page)
    await page.goto(`/#/library?task=${fixtureIds.historyVideoTask}`, {
      waitUntil: "networkidle",
    })

    await page.getByRole("button", { name: "刷新作品详情" }).click()
    await expect(page.getByText("作品列表可能不是最新状态")).toBeVisible()
    await expect(
      page.getByRole("heading", { name: "猫咪尾巴语言", exact: true })
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  for (const scenario of [
    { state: "scheduled" as const, label: "已排期" },
    { state: "published" as const, label: "已发布" },
    { state: "failed" as const, label: "失败" },
  ]) {
    test(`发布状态 ${scenario.state} 有明确语义与恢复操作`, async ({
      page,
    }) => {
      const unhandledApi = await installApiFixtures(page, {
        publishAttemptState: scenario.state,
      })
      await preparePage(page)
      await page.goto(`/#/library?task=${fixtureIds.historyVideoTask}`, {
        waitUntil: "networkidle",
      })

      const publishSection = page.locator(
        'section[aria-labelledby="detail-publish-heading"]'
      )
      await expect(
        publishSection.getByText(scenario.label, { exact: true })
      ).toBeVisible()
      if (scenario.state === "failed") {
        await expect(page.getByText("渠道暂时拒绝了这次发布。")).toBeVisible()
        await page.getByRole("button", { name: "查看与调整" }).click()
        await expect(
          page.getByRole("button", { name: "重试失败发布" })
        ).toBeVisible()
      }
      expect(unhandledApi).toEqual([])
    })
  }
})
