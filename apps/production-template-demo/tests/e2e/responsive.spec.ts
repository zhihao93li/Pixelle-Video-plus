import { expect, test } from "playwright/test"

import {
  expectNoHorizontalOverflow,
  observeRuntimeErrors,
  preparePage,
  visitRoute,
  VIEWPORTS,
  type TestTheme,
} from "./fixtures/app"
import { installApiFixtures } from "./fixtures/api"
import { FORMAL_SURFACES } from "./fixtures/surfaces"

for (const viewport of VIEWPORTS) {
  for (const theme of [
    "light",
    "dark",
  ] as const satisfies readonly TestTheme[]) {
    test(`${viewport.name} ${theme} 全部正式 surface 无页面级横向溢出`, async ({
      page,
    }) => {
      test.setTimeout(90_000)
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      })
      const runtimeErrors = observeRuntimeErrors(page)
      const unhandledApi = await installApiFixtures(page)
      await preparePage(page, theme)

      for (const route of FORMAL_SURFACES) {
        await visitRoute(page, route.path, route.heading)
        await expect(page.locator("html")).toHaveClass(new RegExp(theme))
        await expectNoHorizontalOverflow(page)
      }

      expect(unhandledApi, "存在未定义的 E2E API fixture").toEqual([])
      expect(runtimeErrors, "响应式路由产生了运行时错误").toEqual([])
    })
  }
}
