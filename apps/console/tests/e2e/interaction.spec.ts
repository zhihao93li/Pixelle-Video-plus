import { expect, test } from "playwright/test"

import { preparePage } from "./fixtures/app"
import {
  fixtureIds,
  installApiFixtures,
  type ApiFixtureRequest,
} from "./fixtures/api"

test.describe("键盘与浏览器历史", () => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`${viewport.name} skip link 与主导航可用键盘操作`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      const unhandledApi = await installApiFixtures(page)
      await preparePage(page)
      await page.goto("/#/create", { waitUntil: "networkidle" })

      const skipLink = page.getByRole("link", { name: "跳到主要内容" })
      await page.keyboard.press("Tab")
      await expect(skipLink).toBeFocused()
      await page.keyboard.press("Enter")
      await expect(page.locator("#main-content")).toBeFocused()

      const navigation = page
        .locator('nav[aria-label="主导航"]:visible')
        .first()
      const libraryLink = navigation.getByRole("link", { name: "作品库" })
      await libraryLink.focus()
      await page.keyboard.press("Enter")
      await expect(page).toHaveURL(/#\/library/)
      await expect(libraryLink).toHaveAttribute("aria-current", "page")
      expect(unhandledApi).toEqual([])
    })
  }

  test("桌面路由切换后焦点回到主内容", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/create", { waitUntil: "networkidle" })

    const navigation = page.locator('nav[aria-label="主导航"]:visible').first()
    await navigation.getByRole("link", { name: "作品库" }).click()

    await expect(page).toHaveURL(/#\/library/)
    await expect(page.locator("#main-content")).toBeFocused()
    expect(unhandledApi).toEqual([])
  })

  test("破坏性 Dialog 锁定焦点，Escape 后返回触发器", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/settings?view=overview", { waitUntil: "networkidle" })

    const trigger = page.getByRole("button", { name: "重置系统设置" })
    await trigger.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused()

    await page.keyboard.press("Escape")
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(unhandledApi).toEqual([])
  })

  test("Settings view 支持浏览器前进与后退", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/settings?view=overview", { waitUntil: "networkidle" })

    await page
      .getByRole("navigation", { name: "设置分区" })
      .getByRole("link", { name: /生成引擎/ })
      .click()
    await expect(page).toHaveURL(/#\/settings\?view=generation$/)
    await expect(
      page.getByRole("heading", { name: "生成引擎", exact: true })
    ).toBeVisible()

    await page
      .getByRole("navigation", { name: "设置分区" })
      .getByRole("link", { name: /帮助/ })
      .click()
    await expect(page).toHaveURL(/#\/settings\?view=help$/)

    await page.goBack()
    await expect(page).toHaveURL(/#\/settings\?view=generation$/)
    await expect(
      page
        .getByRole("navigation", { name: "设置分区" })
        .getByRole("link", { name: /生成引擎/ })
    ).toHaveAttribute("aria-current", "page")

    await page.goForward()
    await expect(page).toHaveURL(/#\/settings\?view=help$/)
    await expect(page.getByRole("heading", { name: "帮助中心" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("作品库选中项支持浏览器前进与后退", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(`/#/library?task=${fixtureIds.historyImageTask}`, {
      waitUntil: "networkidle",
    })

    const textRow = page
      .getByRole("listitem")
      .filter({ hasText: "第一次养猫的七天准备清单" })
      .getByRole("button")
    await textRow.click()
    await expect(page).toHaveURL(
      new RegExp(`#/library\\?task=${fixtureIds.historyTextTask}$`)
    )

    await page.goBack()
    await expect(page).toHaveURL(
      new RegExp(`#/library\\?task=${fixtureIds.historyImageTask}$`)
    )
    await expect(
      page
        .getByRole("listitem")
        .filter({ hasText: "猫咪为什么喜欢猫薄荷" })
        .getByRole("button")
    ).toHaveAttribute("aria-pressed", "true")

    await page.goForward()
    await expect(page).toHaveURL(
      new RegExp(`#/library\\?task=${fixtureIds.historyTextTask}$`)
    )
    await expect(
      page.getByRole("heading", {
        name: "第一次养猫的七天准备清单",
        exact: true,
      })
    ).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("作品库筛选、页码和选中项共同进入 URL", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, { historyPages: 3 })
    await preparePage(page)
    await page.goto(`/#/library?task=${fixtureIds.historyVideoTask}`, {
      waitUntil: "networkidle",
    })

    await page.getByRole("combobox", { name: "筛选作品形态" }).click()
    await page.getByRole("option", { name: "图集", exact: true }).click()
    await expect(page).toHaveURL(/kind=image_set/)
    await expect(page).toHaveURL(
      new RegExp(`task=${fixtureIds.historyImageTask}`)
    )

    await page.getByRole("combobox", { name: "筛选作品状态" }).click()
    await page.getByRole("option", { name: "已完成", exact: true }).click()
    await expect(page).toHaveURL(/status=completed/)

    await page.getByRole("button", { name: "下一页" }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page).toHaveURL(/kind=image_set/)
    await expect(page).toHaveURL(/status=completed/)
    expect(unhandledApi).toEqual([])
  })

  test("项目分区未保存更改会拦截离开，并支持留下或放弃", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(`/#/settings/projects/${fixtureIds.project}`, {
      waitUntil: "networkidle",
    })

    await page
      .getByLabel("名称", { exact: true })
      .fill("PetWoods 内容计划（未保存）")
    await expect(
      page.getByText("有未保存更改", { exact: true }).first()
    ).toBeVisible()
    const libraryLink = page
      .locator('nav[aria-label="主导航"]:visible')
      .getByRole("link", { name: "作品库" })
    await libraryLink.click()

    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(
      new RegExp(`#/settings/projects/${fixtureIds.project}$`)
    )
    await dialog.getByRole("button", { name: "留在此页" }).click()
    await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
      "PetWoods 内容计划（未保存）"
    )

    await libraryLink.click()
    await page.getByRole("button", { name: "放弃更改并离开" }).click()
    await expect(page).toHaveURL(/#\/library/)
    expect(unhandledApi).toEqual([])
  })
})

test("模板设置直接编辑，并按 Provider 条件展示 Workflow", async ({ page }) => {
  const requests: ApiFixtureRequest[] = []
  const unhandledApi = await installApiFixtures(page, {
    captureJsonRequests: requests,
    imageProvidersReady: true,
  })
  await preparePage(page)
  await page.addInitScript(() => {
    window.localStorage.setItem("pixelle-expert-mode", "true")
  })
  await page.goto(`/#/create/recipes/${fixtureIds.videoTemplate}`, {
    waitUntil: "networkidle",
  })

  await expect(page.getByRole("heading", { name: "内容起草设置" })).toHaveCount(
    0
  )
  await expect(page.getByRole("heading", { name: "1. 分镜" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "2. 每镜画面" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "4. 合成" })).toBeVisible()
  await expect(page.getByText("生产步骤与默认设置")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "调整", exact: true })
  ).toHaveCount(0)

  await expect(
    page.getByRole("combobox", { name: "每镜画面 workflow" })
  ).toBeVisible()
  await page.getByRole("combobox", { name: "图片 Provider" }).click()
  await page.getByRole("option", { name: "阿里云百炼" }).click()
  await expect(
    page.getByRole("combobox", { name: "每镜画面 workflow" })
  ).toHaveCount(0)
  await page.getByRole("combobox", { name: "图片模型" }).click()
  await page.getByRole("option", { name: "Qwen-Image 2.0 Pro" }).click()

  const save = page.getByRole("button", { name: "保存生产设置" })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText("生产设置已保存", { exact: true })).toBeVisible()
  const saved = requests.find(
    (request) =>
      request.method === "PUT" && request.path.endsWith("/generation-config")
  )
  expect(saved?.body).toMatchObject({
    overrides: {
      image_provider: "aliyun_bailian",
      image_model: "qwen-image-2.0-pro",
    },
  })
  expect(unhandledApi).toEqual([])
})
