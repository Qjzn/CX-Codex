import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

function readArg(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] ?? fallback) : fallback
}

const playwrightModule = process.env.CX_CODEX_PLAYWRIGHT_MODULE?.trim() ?? ''
assert(playwrightModule, 'CX_CODEX_PLAYWRIGHT_MODULE must point to an installed Playwright package.')
const require = createRequire(import.meta.url)
const { chromium } = require(playwrightModule)

const baseUrl = readArg('--base-url', 'http://127.0.0.1:7420').replace(/\/+$/u, '')
const outputDirectory = path.resolve(readArg('--output-directory', 'output/sidebar-quick-actions'))
const chromePath = readArg('--chrome-path', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
fs.mkdirSync(outputDirectory, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: chromePath })
const context = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce', deviceScaleFactor: 1 })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

async function openHome(width, height) {
  await page.setViewportSize({ width, height })
  await page.goto(`${baseUrl}/#/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('#app .content-root').waitFor({ state: 'visible', timeout: 30_000 })
}

async function readVisibleSidebarMetrics(rootSelector) {
  return page.locator(rootSelector).evaluate((root) => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const topButtons = Array.from(root.querySelectorAll('.sidebar-thread-controls-host button')).filter(visible)
    const actionButtons = Array.from(root.querySelectorAll('.sidebar-action-grid > .sidebar-action-tile')).filter(visible)
    const labels = (elements) => elements.map((element) => (
      element.getAttribute('aria-label') || element.textContent || ''
    ).replace(/\s+/gu, ' ').trim())
    const topRects = topButtons.map((button) => button.getBoundingClientRect())
    return {
      topLabels: labels(topButtons),
      actionLabels: labels(actionButtons),
      newThreadIsRightmost: topRects.length === 3 && topRects[2].left > topRects[1].left,
      minActionHeight: actionButtons.length > 0 ? Math.min(...actionButtons.map((button) => button.getBoundingClientRect().height)) : 0,
      minTopHeight: topButtons.length > 0 ? Math.min(...topButtons.map((button) => button.getBoundingClientRect().height)) : 0,
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    }
  })
}

async function ensureMobileDrawer() {
  if (await page.locator('.mobile-drawer').count()) return
  await page.locator('.sidebar-thread-controls-header-host button').first().click()
  await page.locator('.mobile-drawer').waitFor({ state: 'visible', timeout: 10_000 })
}

const results = {}
try {
  await openHome(1440, 900)
  await page.locator('.sidebar-action-grid').waitFor({ state: 'visible', timeout: 15_000 })
  results.desktop = await readVisibleSidebarMetrics('.sidebar-root')
  assert.deepEqual(results.desktop.topLabels, ['收起侧栏', '全部已读', '新建会话'])
  assert.deepEqual(results.desktop.actionLabels, ['搜索会话', '技能', 'GitHub'])
  assert.equal(results.desktop.newThreadIsRightmost, true)
  assert.equal(results.desktop.hasHorizontalOverflow, false)
  await page.screenshot({ path: path.join(outputDirectory, 'sidebar-desktop.png'), fullPage: true })

  await openHome(393, 852)
  await ensureMobileDrawer()
  results.phone = await readVisibleSidebarMetrics('.mobile-drawer .sidebar-root')
  assert.deepEqual(results.phone.topLabels, ['收起侧栏', '全部已读', '新建会话'])
  assert.deepEqual(results.phone.actionLabels, ['搜索会话', '技能', 'GitHub'])
  assert.equal(results.phone.newThreadIsRightmost, true)
  assert(results.phone.minActionHeight >= 43.5, `phone shortcut target is too short: ${String(results.phone.minActionHeight)}`)
  assert(results.phone.minTopHeight >= 35.5, `phone top utility target is too short: ${String(results.phone.minTopHeight)}`)
  assert.equal(results.phone.hasHorizontalOverflow, false)

  await page.getByRole('button', { name: '搜索会话', exact: true }).click()
  await page.locator('.mobile-drawer .sidebar-search-input').waitFor({ state: 'visible', timeout: 5_000 })
  results.phone.searchOpened = true
  await page.screenshot({ path: path.join(outputDirectory, 'sidebar-phone.png'), fullPage: true })

  await page.getByRole('button', { name: '技能', exact: true }).click()
  await page.locator('.skills-hub').waitFor({ state: 'visible', timeout: 15_000 })
  results.phone.skillsOpened = true

  await ensureMobileDrawer()
  await page.getByRole('button', { name: 'GitHub', exact: true }).click()
  await page.locator('.trending-hub').waitFor({ state: 'visible', timeout: 15_000 })
  results.phone.githubOpened = true

  for (const removedRoute of ['workbench', 'diagnostics']) {
    await page.goto(`${baseUrl}/#/${removedRoute}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForFunction(() => location.hash === '#/' || location.hash === '', undefined, { timeout: 5_000 })
  }
  results.removedRoutesRedirectHome = true

  assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join(' | ')}`)
  fs.writeFileSync(path.join(outputDirectory, 'result.json'), `${JSON.stringify(results, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`)
} finally {
  await browser.close()
}
