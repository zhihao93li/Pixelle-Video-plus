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

  test("作品库列表与详情支持浏览器前进与后退", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/library", {
      waitUntil: "networkidle",
    })

    await page.getByText("猫咪为什么喜欢猫薄荷", { exact: true }).click()
    await expect(page).toHaveURL(
      new RegExp(`#/library\\?task=${fixtureIds.historyImageTask}$`)
    )

    await page.goBack()
    await expect(page).toHaveURL(/#\/library$/)
    await page.getByText("第一次养猫的七天准备清单", { exact: true }).click()
    await expect(page).toHaveURL(
      new RegExp(`#/library\\?task=${fixtureIds.historyTextTask}$`)
    )

    await page.goBack()
    await expect(page).toHaveURL(/#\/library$/)

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

  test("作品库筛选和页码共同进入 URL", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, { historyPages: 3 })
    await preparePage(page)
    await page.goto("/#/library", {
      waitUntil: "networkidle",
    })

    await page.getByRole("combobox", { name: "筛选作品形态" }).click()
    await page.getByRole("option", { name: "图集", exact: true }).click()
    await expect(page).toHaveURL(/kind=image_set/)
    await expect(page).not.toHaveURL(/task=/)

    await page.getByRole("combobox", { name: "筛选作品状态" }).click()
    await page.getByRole("option", { name: "已完成", exact: true }).click()
    await expect(page).toHaveURL(/status=completed/)

    await page.getByRole("button", { name: "下一页" }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page).toHaveURL(/kind=image_set/)
    await expect(page).toHaveURL(/status=completed/)
    expect(unhandledApi).toEqual([])
  })

  test("作品库支持多选并显示批量下载操作", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/library", { waitUntil: "networkidle" })

    await page.getByRole("checkbox", { name: /选择猫咪尾巴语言/ }).check()
    await page
      .getByRole("checkbox", { name: /选择猫咪为什么喜欢猫薄荷/ })
      .check()

    await expect(page.getByText("已选 2 项", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "下载已选" })).toBeVisible()
    expect(unhandledApi).toEqual([])
  })

  test("作品库封面使用竖版比例并完整显示媒体", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/library", { waitUntil: "networkidle" })

    const cover = page.locator('[data-slot="library-cover"]').first()
    await expect(cover).toBeVisible()
    const box = await cover.boundingBox()
    expect(box).not.toBeNull()
    expect((box?.width ?? 0) / (box?.height ?? 1)).toBeCloseTo(0.75, 1)
    expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThan(260)

    const media = cover.locator("img, video")
    await expect(media).toHaveCount(1)
    await expect(media).toHaveCSS("object-fit", "contain")
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

test("模板设置直接编辑，并按图片生成方式切换 Workflow 或模型", async ({
  page,
}) => {
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

  await page.getByRole("button", { name: /^2\. 每镜画面/ }).click()
  await expect(
    page.locator('[data-setting-key="template_params"]')
  ).toBeVisible()
  await expect(
    page.getByRole("combobox", { name: "图片 Workflow" })
  ).toBeVisible()
  await expect(page.getByRole("combobox", { name: "图片模型" })).toHaveCount(0)
  await page.getByRole("combobox", { name: "图片 Workflow" }).click()
  await expect(
    page.getByRole("option", { name: "Flux · RunningHub" })
  ).toBeVisible()
  await expect(
    page.getByRole("option", { name: "Wan 视频 · RunningHub" })
  ).toHaveCount(0)
  await page.getByRole("option", { name: "Flux · RunningHub" }).click()
  await page.getByRole("combobox", { name: "图片生成方式" }).click()
  await page.getByRole("option", { name: "阿里云百炼" }).click()
  await expect(
    page.getByRole("combobox", { name: "图片 Workflow" })
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
      media_workflow: "",
    },
  })
  expect(unhandledApi).toEqual([])
})
