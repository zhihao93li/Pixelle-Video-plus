import { expect, test } from "playwright/test"

import {
  preparePage,
  trackedTaskForState,
  type SeededRunState,
} from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

test.describe("项目边界与页面异步状态", () => {
  test("ProjectScope loading", async ({ page }) => {
    await installApiFixtures(page, { projectState: "loading", delayMs: 5_000 })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "domcontentloaded" })

    const boundary = page.locator('[data-slot="project-scope-boundary"]')
    await expect(boundary).toHaveAttribute("data-state", "loading")
    await expect(boundary.getByText("正在读取项目…")).toBeVisible()
  })

  test("ProjectScope empty", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      projectState: "empty",
    })
    await preparePage(page)
    await page.goto("/#/board", { waitUntil: "networkidle" })

    const boundary = page.locator('[data-slot="project-scope-boundary"]')
    await expect(boundary).toHaveAttribute("data-state", "empty")
    await expect(page.getByText("暂无可用项目")).toBeVisible()
    await expect(page.getByRole("button", { name: "管理项目" })).toBeVisible()
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
    await expect(page.getByText("项目读取失败")).toBeVisible()
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

    await expect(page.getByText("正在读取可用配方")).toBeVisible()
  })

  test("Production empty 显示无可用配方并给出恢复动作", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      productionState: "empty",
    })
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    await expect(page.getByText("配方读取失败")).toBeVisible()
    await expect(
      page.getByText(
        "指定配方不存在或当前项目无权使用，请返回快速生产重新选择。"
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

    await expect(page.getByText("配方读取失败")).toBeVisible()
    await expect(page.getByText("配方服务暂时不可用。")).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("Production 无效显式配方不回落到默认配方", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/create/generate/no-such-template", {
      waitUntil: "networkidle",
    })

    await expect(page.getByText("配方读取失败")).toBeVisible()
    await expect(page.getByText(/指定配方不存在或当前项目无权使用/)).toBeVisible()
    await expect(page.getByRole("button", { name: "返回快速生产" })).toBeVisible()
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
    await expect(page.getByText("资源读取失败").first()).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("CreateGallery 配方默认值失败不伪装成出厂设置", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, {
      configState: "error",
    })
    await preparePage(page)
    await page.goto("/#/create", { waitUntil: "networkidle" })

    await expect(page.getByText("无法读取配方默认设置")).toBeVisible()
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

  test("Script Review 语音默认值失败可见，但不阻断起草流程", async ({
    page,
  }) => {
    const unhandledApi = await installApiFixtures(page, {
      settingsState: "error",
    })
    await preparePage(page)
    await page.goto("/#/create/script-review", { waitUntil: "networkidle" })

    await expect(page.getByText("全局语音默认值暂未同步")).toBeVisible()
    await page.getByLabel("选题", { exact: true }).fill("猫咪夏天饮水少怎么办")
    await expect(page.getByRole("button", { name: "生成审核草稿" })).toBeEnabled()
    expect(unhandledApi).toEqual([])
  })
})

const RUN_STATES: ReadonlyArray<{
  state: SeededRunState
  label: string
  canCancel?: boolean
}> = [
  { state: "idle", label: "未开始" },
  { state: "uploading", label: "上传中", canCancel: true },
  { state: "submitting", label: "提交中", canCancel: true },
  { state: "queued", label: "排队中", canCancel: true },
  { state: "running", label: "生成中", canCancel: true },
  { state: "completed", label: "已完成" },
  { state: "failed", label: "失败" },
  { state: "cancelling", label: "取消中" },
  { state: "cancelled", label: "已取消" },
  { state: "interrupted", label: "已中断" },
]

test.describe("共享 Task UI 的 RunState 矩阵", () => {
  for (const scenario of RUN_STATES) {
    test(`${scenario.state} 渲染用户状态与恢复动作`, async ({ page }) => {
      const unhandledApi = await installApiFixtures(page, {
        includeBatch: false,
      })
      await preparePage(page, "light", {
        trackedTasks: [trackedTaskForState(scenario.state)],
      })
      await page.goto("/#/tasks", { waitUntil: "networkidle" })

      const detail = page.locator(
        'section[aria-labelledby="selected-run-heading"]'
      )
      await expect(
        detail.getByRole("heading", {
          name: `状态验收·${scenario.state}`,
          exact: true,
        })
      ).toBeVisible()
      await expect(
        detail.getByText(scenario.label, { exact: true })
      ).toBeVisible()
      await expect(
        detail.getByRole("button", { name: "取消运行" })
      ).toHaveCount(scenario.canCancel ? 1 : 0)

      if (scenario.state === "completed") {
        await expect(
          detail.getByRole("link", { name: "查看产物" })
        ).toBeVisible()
      }
      if (scenario.state === "failed" || scenario.state === "interrupted") {
        await expect(detail.getByText("本次运行未完成")).toBeVisible()
      }
      if (scenario.state === "running") {
        await expect(page).toHaveScreenshot("desktop-tasks-running.png", {
          animations: "disabled",
          caret: "hide",
          fullPage: false,
          scale: "css",
        })
      }
      expect(unhandledApi).toEqual([])
    })
  }
})
