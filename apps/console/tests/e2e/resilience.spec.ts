import { expect, test } from "playwright/test"

import { expectNoHorizontalOverflow, preparePage } from "./fixtures/app"
import { fixtureIds, installApiFixtures } from "./fixtures/api"

const LONG_PROJECT_NAME =
  "PetWoods 全球多语言宠物健康内容计划·七月超长项目名称·不应挤掉导航与主操作"
const LONG_BODY = Array.from(
  { length: 5_000 },
  (_, index) => "猫咪健康饮水观察记录。"[index % 11]
).join("")

test.describe("极端内容与移动安全区", () => {
  test("长项目名在 320px 下不会挤掉项目切换与导航", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 })
    const unhandledApi = await installApiFixtures(page, {
      projectName: LONG_PROJECT_NAME,
    })
    await preparePage(page)
    await page.goto("/#/create", { waitUntil: "networkidle" })

    const projectSwitcher = page.getByRole("combobox", {
      name: `切换内容空间，当前：${LONG_PROJECT_NAME}`,
    })
    await expect(projectSwitcher).toBeVisible()
    await expect(projectSwitcher).toHaveAttribute("title", LONG_PROJECT_NAME)
    await expect(page.locator('nav[aria-label="主导航"]:visible')).toBeVisible()
    const overflow = await horizontalOverflowReport(page)
    expect(
      overflow.delta,
      `长项目名导致横向溢出：${JSON.stringify(overflow.offenders)}`
    ).toBeLessThanOrEqual(1)
    expect(unhandledApi).toEqual([])
  })

  test("5000 字生成文案保持完整，移动主操作仍可达", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    const script = page.getByLabel("视频文案", { exact: true })
    await script.fill(LONG_BODY)
    expect((await script.inputValue()).length).toBe(5_000)
    await expect(
      page.getByRole("button", { name: "开始生成" }).last()
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expect(unhandledApi).toEqual([])
  })

  test("5000 字长文产物保持完整且操作可达", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page, { article: LONG_BODY })
    await preparePage(page)
    await page.goto(`/#/library?task=${fixtureIds.historyTextTask}`, {
      waitUntil: "networkidle",
    })

    const article = page
      .locator("pre")
      .filter({ hasText: LONG_BODY.slice(0, 40) })
    await expect(article).toBeVisible()
    expect((await article.textContent())?.length).toBe(5_000)
    await expect(page.getByRole("button", { name: "下载 .md" })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expect(unhandledApi).toEqual([])
  })

  test("34px safe-area 下 sticky CTA 与底部导航不重叠", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page, "dark")
    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })

    const mobileSubmit = page.getByRole("button", { name: "开始生成" }).last()
    const mobileNavigation = page.locator('nav[aria-label="主导航"]:visible')
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--safe-area-bottom", "34px")
    })

    await expect(mobileSubmit).toBeVisible()
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          "--safe-area-bottom"
        )
      )
    ).toBe("34px")
    const [submitBox, navigationBox] = await Promise.all([
      mobileSubmit.boundingBox(),
      mobileNavigation.boundingBox(),
    ])
    expect(submitBox).not.toBeNull()
    expect(navigationBox).not.toBeNull()
    expect(submitBox!.y + submitBox!.height).toBeLessThanOrEqual(
      navigationBox!.y
    )
    await expect(page).toHaveScreenshot("mobile-dark-safe-area-34.png", {
      animations: "disabled",
      caret: "hide",
      fullPage: false,
      scale: "css",
    })
    expect(unhandledApi).toEqual([])
  })
})

async function horizontalOverflowReport(page: import("playwright/test").Page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth
    const offenders = Array.from(
      document.querySelectorAll<HTMLElement>("body *")
    )
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          element,
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        }
      })
      .filter(
        (item) =>
          item.right > viewportWidth + 1 || item.width > viewportWidth + 1
      )
      .sort((left, right) => right.right - left.right)
      .slice(0, 8)
      .map(({ element, right, width }) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        className: element.className.toString().slice(0, 180),
        text: element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80),
        right,
        width,
      }))
    return {
      delta: document.documentElement.scrollWidth - viewportWidth,
      offenders,
    }
  })
}

test.describe("200% reflow 近似", () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 720, height: 450 } })

  test("项目切换、生成主操作与设置分区在高缩放下可达", async ({ page }) => {
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)

    await page.goto(`/#/create/generate/${fixtureIds.videoTemplate}`, {
      waitUntil: "networkidle",
    })
    await expect(
      page.getByRole("combobox", { name: /切换内容空间/ })
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: "开始生成" }).last()
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.goto("/#/settings?view=overview", { waitUntil: "networkidle" })
    await expect(
      page.getByRole("navigation", { name: "设置分区" })
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expect(unhandledApi).toEqual([])
  })
})
