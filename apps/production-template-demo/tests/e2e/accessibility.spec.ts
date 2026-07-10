import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "playwright/test"

import {
  preparePage,
  PRIMARY_ROUTES,
  type TestTheme,
  visitRoute,
} from "./fixtures/app"
import { installApiFixtures } from "./fixtures/api"

type SeriousViolation = {
  help: string
  id: string
  impact: string | null | undefined
  nodes: string[]
  route: string
}

async function seriousViolations(page: Page, route: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  return results.violations
    .filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical"
    )
    .map<SeriousViolation>((violation) => ({
      help: violation.help,
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
      route,
    }))
}

for (const scenario of [
  {
    name: "desktop light",
    width: 1440,
    height: 900,
    theme: "light" as TestTheme,
  },
  {
    name: "mobile dark",
    width: 390,
    height: 844,
    theme: "dark" as TestTheme,
  },
]) {
  test(`${scenario.name} 主路由无 serious/critical axe 问题`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: scenario.width,
      height: scenario.height,
    })
    const unhandledApi = await installApiFixtures(page)
    await preparePage(page, scenario.theme)
    const violations: SeriousViolation[] = []

    for (const route of PRIMARY_ROUTES) {
      await visitRoute(page, route.path, route.label)
      violations.push(...(await seriousViolations(page, route.path)))
    }

    expect(unhandledApi, "存在未定义的 E2E API fixture").toEqual([])
    expect(
      violations,
      `axe serious/critical violations:\n${JSON.stringify(violations, null, 2)}`
    ).toEqual([])
  })
}
