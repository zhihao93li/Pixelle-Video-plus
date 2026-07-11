import { expect, test } from "playwright/test"

import { preparePage } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

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
      const tasksLink = navigation.getByRole("link", { name: "任务" })
      await tasksLink.focus()
      await page.keyboard.press("Enter")
      await expect(page).toHaveURL(/#\/tasks$/)
      await expect(tasksLink).toHaveAttribute("aria-current", "page")
      expect(unhandledApi).toEqual([])
    })
  }

  test("桌面路由切换后焦点回到主内容", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/create", { waitUntil: "networkidle" })

    const navigation = page.locator('nav[aria-label="主导航"]:visible').first()
    await navigation.getByRole("link", { name: "任务" }).click()

    await expect(page).toHaveURL(/#\/tasks$/)
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
    const tasksLink = page
      .locator('nav[aria-label="主导航"]:visible')
      .getByRole("link", { name: "任务" })
    await tasksLink.click()

    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(
      new RegExp(`#/settings/projects/${fixtureIds.project}$`)
    )
    await dialog.getByRole("button", { name: "留在此页" }).click()
    await expect(page.getByLabel("名称", { exact: true })).toHaveValue(
      "PetWoods 内容计划（未保存）"
    )

    await tasksLink.click()
    await page.getByRole("button", { name: "放弃更改并离开" }).click()
    await expect(page).toHaveURL(/#\/tasks$/)
    expect(unhandledApi).toEqual([])
  })
})

test("配方设置直接编辑，并按 Provider 条件展示 Workflow", async ({ page }) => {
  const unhandledApi = await installApiFixtures(page)
  await preparePage(page)
  await page.goto(`/#/create/recipes/${fixtureIds.videoTemplate}`, {
    waitUntil: "networkidle",
  })

  await expect(page.getByRole("heading", { name: "文案生成" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "内容处理" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "画面生成" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "配音" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "版式与输出" })).toBeVisible()
  await expect(page.getByText("生产步骤与默认设置")).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "调整", exact: true })
  ).toHaveCount(0)

  await page.getByLabel("生成方式 Provider").click()
  await page.getByRole("option", { name: "RunningHub 云端" }).click()
  await expect(page.getByLabel("生成方式 Workflow")).toBeVisible()

  const save = page.getByRole("button", { name: "保存生产设置" })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(page.getByText("生产设置已保存", { exact: true })).toBeVisible()
  expect(unhandledApi).toEqual([])
})
