import { expect, test } from "playwright/test"

import {
  observeRuntimeErrors,
  preparePage,
  PRIMARY_ROUTES,
} from "./fixtures/app"
import { installApiFixtures } from "./fixtures/api"

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`${viewport.name} 四项主导航为真实链接并标记当前路由`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    })
    const runtimeErrors = observeRuntimeErrors(page)
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page)
    await page.goto("/#/create", { waitUntil: "domcontentloaded" })

    const navigation = page.locator('nav[aria-label="主导航"]:visible').first()
    await expect(navigation).toBeVisible()

    for (const route of PRIMARY_ROUTES) {
      const link = navigation.locator(`a[href="#${route.path}"]`)
      await expect(link, `${route.label} 必须使用真实链接`).toBeVisible()
      await link.click()
      await expect(page).toHaveURL(new RegExp(`#${route.path}$`))
      await expect(
        page
          .getByRole("heading", {
            level: 1,
            name: route.label,
            exact: true,
          })
          .first()
      ).toBeVisible()
      await page.waitForLoadState("networkidle")
      await expect(link).toHaveAttribute("aria-current", "page")
    }

    await expect(navigation.locator("a")).toHaveCount(PRIMARY_ROUTES.length)
    expect(unhandledApi, "存在未定义的 E2E API fixture").toEqual([])
    expect(runtimeErrors, "主导航交互产生了运行时错误").toEqual([])
  })
}
