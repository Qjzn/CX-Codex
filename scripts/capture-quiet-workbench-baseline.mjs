import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

function readArg(name, fallback = '') {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] ?? '') : fallback
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const playwrightModule = process.env.CX_CODEX_PLAYWRIGHT_MODULE?.trim() ?? ''
assert(playwrightModule, 'CX_CODEX_PLAYWRIGHT_MODULE must point to an installed Playwright package.')
const require = createRequire(import.meta.url)
const { chromium } = require(playwrightModule)

const baseUrl = readArg('--base-url', 'http://127.0.0.1:7420').replace(/\/+$/u, '')
const fixtureBaseUrl = readArg('--fixture-base-url', baseUrl).replace(/\/+$/u, '')
const outputDirectory = path.resolve(readArg('--output-directory', 'output/quiet-workbench/ux00-baseline'))
const scope = readArg('--scope', 'all')
const theme = readArg('--theme', 'light')
const motion = readArg('--motion', 'normal')
const threadTitle = readArg('--thread-title', '').trim()
const chromePath = readArg('--chrome-path', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')

assert(['all', 'home', 'fixtures', 'thread', 'sidebar', 'composer'].includes(scope), `Unsupported scope: ${scope}`)
assert(['light', 'dark', 'forced'].includes(theme), `Unsupported theme: ${theme}`)
assert(['normal', 'reduced'].includes(motion), `Unsupported motion: ${motion}`)
if (scope === 'thread') assert(threadTitle, '--thread-title is required for thread scope.')
assert(fs.existsSync(chromePath), `Chrome was not found at ${chromePath}.`)
fs.mkdirSync(outputDirectory, { recursive: true })

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 884, height: 1104 },
  { name: 'compact', width: 768, height: 1024 },
  { name: 'phone', width: 393, height: 852 },
  { name: 'phone-landscape', width: 852, height: 393 },
]

const allStates = [
  { name: 'home', path: '/#/', expected: '' },
  { name: 'running', path: '/#/__regression/conversation-blocks?regression=frontend&uxState=running', expected: 'running' },
  { name: 'completed', path: '/#/__regression/conversation-blocks?regression=frontend&uxState=completed', expected: 'completed' },
  { name: 'waiting-input', path: '/#/__regression/conversation-blocks?regression=frontend&uxState=waiting', expected: 'waiting' },
]
const states = scope === 'home'
  ? allStates.filter((state) => state.name === 'home')
  : scope === 'fixtures'
    ? allStates.filter((state) => state.name !== 'home')
    : scope === 'thread'
      ? [{ name: 'thread', path: '/#/', expected: '' }]
    : scope === 'sidebar'
      ? [{ name: 'sidebar', path: '/#/__regression/sidebar-rows?regression=frontend', expected: '' }]
      : scope === 'composer'
        ? [{ name: 'composer', path: '/#/__regression/composer-shell?regression=frontend', expected: '' }]
    : allStates

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
})
const context = await browser.newContext({
  colorScheme: theme === 'dark' ? 'dark' : 'light',
  forcedColors: theme === 'forced' ? 'active' : 'none',
  reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference',
  deviceScaleFactor: 1,
})
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

const results = []
let resolvedThreadId = ''
try {
  for (const state of states) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      const stateBaseUrl = state.name === 'home' || state.name === 'thread' ? baseUrl : fixtureBaseUrl
      const url = stateBaseUrl + state.path
      // Hash-query changes reuse the same Vue route component, while the fixture
      // intentionally reads its deterministic state once at module mount. Start
      // from a fresh document so every screenshot proves the requested state.
      await page.goto('about:blank')
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (state.name === 'home' || state.name === 'thread') {
        await page.locator('#app .content-root').waitFor({ state: 'visible', timeout: 30_000 })
        if (viewport.width >= 1200) {
          await page.locator('.thread-tree-root').waitFor({ state: 'visible', timeout: 15_000 })
          await page.waitForFunction(
            () => document.querySelectorAll('.thread-loading-skeleton').length === 0,
            undefined,
            { timeout: 15_000 },
          )
        }
        if (state.name === 'thread') {
          if (!resolvedThreadId) {
            const matchingTitle = page.locator('.thread-row-title').filter({ hasText: threadTitle }).first()
            await matchingTitle.waitFor({ state: 'visible', timeout: 15_000 })
            resolvedThreadId = await matchingTitle.locator('xpath=ancestor::*[@data-thread-id][1]').getAttribute('data-thread-id') ?? ''
            assert(resolvedThreadId, `Could not resolve a thread id for title containing: ${threadTitle}`)
          }
          await page.goto(`${baseUrl}/#/thread/${encodeURIComponent(resolvedThreadId)}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          })
          await page.locator('.thread-composer-shell').waitFor({ state: 'visible', timeout: 30_000 })
          await page.locator('.conversation-list').waitFor({ state: 'visible', timeout: 30_000 })
          await page.waitForTimeout(750)
        }
      } else if (state.name === 'sidebar') {
        await page.locator('.sidebar-regression-tree').waitFor({ state: 'visible', timeout: 30_000 })
      } else if (state.name === 'composer') {
        await page.locator('.composer-regression-fixture .thread-composer-shell').waitFor({ state: 'visible', timeout: 30_000 })
      } else {
        await page.locator(`[data-ux-baseline-state="${state.expected}"]`).waitFor({ state: 'visible', timeout: 30_000 })
      }
      await page.waitForTimeout(750)

      const metrics = await page.evaluate(() => {
        const visibleThreadRows = Array.from(document.querySelectorAll('.thread-row')).filter((row) => {
          const rect = row.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        const idleThreadRows = visibleThreadRows.filter((row) => row.getAttribute('data-detail') === 'false')
        const detailThreadRows = visibleThreadRows.filter((row) => row.getAttribute('data-detail') === 'true')
        const composerControls = Array.from(document.querySelectorAll('.thread-composer-controls button')).filter((button) => {
          const rect = button.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        })
        const composerControlRects = composerControls.map((button) => button.getBoundingClientRect())
        const composerControlsOverlap = composerControlRects.some((rect, index) => (
          composerControlRects.slice(index + 1).some((candidate) => !(
            rect.right <= candidate.left || candidate.right <= rect.left || rect.bottom <= candidate.top || candidate.bottom <= rect.top
          ))
        ))
        const visibleInteractiveElements = Array.from(document.querySelectorAll('button, a[href], input, textarea, select, [role="button"]')).filter((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
        })
        const accessibleName = (element) => {
          const labelledBy = element.getAttribute('aria-labelledby')
          const labelledText = labelledBy
            ? labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
            : ''
          return (
            element.getAttribute('aria-label')
            || labelledText
            || element.getAttribute('title')
            || element.getAttribute('placeholder')
            || element.textContent
            || ''
          ).replace(/\s+/gu, ' ').trim()
        }
        const visibleContinuousAnimationCount = Array.from(document.querySelectorAll('*')).filter((element) => {
          const rect = element.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) return false
          const style = getComputedStyle(element)
          const durations = style.animationDuration.split(',').map((value) => Number.parseFloat(value) || 0)
          return style.animationIterationCount.split(',').some((value) => value.trim() === 'infinite')
            && durations.some((duration) => duration > 0)
        }).length
        return ({
        url: location.href,
        title: document.title,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        mainLandmarkCount: document.querySelectorAll('main, [role="main"]').length,
        unnamedVisibleControlCount: visibleInteractiveElements.filter((element) => !accessibleName(element)).length,
        visibleContinuousAnimationCount,
        forcedColorsActive: window.matchMedia('(forced-colors: active)').matches,
        reducedMotionActive: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        alertCount: document.querySelectorAll('[role="alert"]').length,
        dialogCount: document.querySelectorAll('[role="dialog"]').length,
        composerCount: document.querySelectorAll('.thread-composer-shell').length,
        conversationCount: document.querySelectorAll('.conversation-list').length,
        baselineState: document.querySelector('[data-ux-baseline-state]')?.getAttribute('data-ux-baseline-state') ?? '',
        liveOverlayCount: document.querySelectorAll('.live-overlay-inline').length,
        requestPanelCount: document.querySelectorAll('.conversation-process-section').length,
        activitySummaryCount: document.querySelectorAll('li.conversation-item[data-message-type="guidedSummary"]').length,
        detailedLiveOverlayCount: document.querySelectorAll('.live-overlay-inline:not(.live-overlay-inline-compact)').length,
        visibleRequestActionCount: Array.from(document.querySelectorAll('.request-actions button, .request-user-input button')).filter((button) => {
          const rect = button.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }).length,
        visibleCommandRowCount: Array.from(document.querySelectorAll('.conversation-item .cmd-row')).filter((row) => {
          const rect = row.getBoundingClientRect()
          return rect.width > 0 && rect.height > 0
        }).length,
        shellMode: document.querySelector('.desktop-layout')?.className ?? '',
        sidebarWidth: Math.round(document.querySelector('.desktop-sidebar')?.getBoundingClientRect().width ?? 0),
        headerHeight: Math.round(document.querySelector('.content-header')?.getBoundingClientRect().height ?? 0),
        headerMainWidth: Math.round(document.querySelector('.content-header-main')?.getBoundingClientRect().width ?? 0),
        composerWidth: Math.round(document.querySelector('.thread-composer-shell')?.getBoundingClientRect().width ?? 0),
        composerHeight: Math.round(document.querySelector('.thread-composer-shell')?.getBoundingClientRect().height ?? 0),
        composerRadius: Math.round(Number.parseFloat(getComputedStyle(document.querySelector('.thread-composer-shell') ?? document.documentElement).borderRadius) || 0),
        composerInputHeight: Math.round(document.querySelector('.thread-composer-input')?.getBoundingClientRect().height ?? 0),
        composerControlsOverlap,
        composerControlCount: composerControls.length,
        composerControlMinHeight: composerControlRects.length > 0
          ? Math.round(Math.min(...composerControlRects.map((rect) => rect.height)))
          : 0,
        composerRuntimeTriggerCount: document.querySelectorAll('.thread-composer-runtime-trigger').length,
        composerSubmitCount: document.querySelectorAll('.thread-composer-submit, .thread-composer-stop').length,
        threadRowCount: visibleThreadRows.length,
        idleThreadRowCount: idleThreadRows.length,
        detailThreadRowCount: detailThreadRows.length,
        idleThreadRowHeights: [...new Set(idleThreadRows.map((row) => Math.round(row.getBoundingClientRect().height)))],
        detailThreadRowHeights: [...new Set(detailThreadRows.map((row) => Math.round(row.getBoundingClientRect().height)))],
        visibleThreadPreviewCount: visibleThreadRows.filter((row) => {
          const preview = row.querySelector('.thread-row-preview')
          if (!(preview instanceof HTMLElement)) return false
          const style = getComputedStyle(preview)
          return style.display !== 'none' && preview.getBoundingClientRect().height > 0
        }).length,
      })
      })

      assert(metrics.viewportWidth === viewport.width && metrics.viewportHeight === viewport.height,
        `${state.name} rendered ${metrics.viewportWidth}x${metrics.viewportHeight} instead of ${viewport.width}x${viewport.height}.`)
      assert(!metrics.hasHorizontalOverflow,
        `${state.name} at ${viewport.width}x${viewport.height} has horizontal overflow.`)
      assert(metrics.mainLandmarkCount === 1,
        `${state.name} at ${viewport.width}x${viewport.height} rendered ${metrics.mainLandmarkCount} main landmarks.`)
      assert(metrics.unnamedVisibleControlCount === 0,
        `${state.name} at ${viewport.width}x${viewport.height} exposed unnamed visible controls.`)
      assert(metrics.forcedColorsActive === (theme === 'forced'),
        `${state.name} at ${viewport.width}x${viewport.height} did not apply the requested forced-colors mode.`)
      assert(metrics.reducedMotionActive === (motion === 'reduced'),
        `${state.name} at ${viewport.width}x${viewport.height} did not apply the requested motion mode.`)
      if (motion === 'reduced') {
        assert(metrics.visibleContinuousAnimationCount === 0,
          `${state.name} at ${viewport.width}x${viewport.height} retained ${metrics.visibleContinuousAnimationCount} continuous animations.`)
      }
      if (state.name === 'home' || state.name === 'thread') {
        assert(metrics.headerHeight > 0 && metrics.headerHeight <= 45,
          `${state.name} at ${viewport.width}x${viewport.height} rendered a ${metrics.headerHeight}px header.`)
        assert(metrics.headerMainWidth <= 800,
          `${state.name} at ${viewport.width}x${viewport.height} rendered a ${metrics.headerMainWidth}px header axis.`)
        assert(metrics.composerWidth <= 800,
          `${state.name} at ${viewport.width}x${viewport.height} rendered a ${metrics.composerWidth}px composer axis.`)
        if (state.name === 'home' && viewport.width >= 1200) {
          assert(metrics.sidebarWidth === 288,
            `desktop home rendered a ${metrics.sidebarWidth}px new-user sidebar instead of 288px.`)
          assert(metrics.threadRowCount > 0,
            'desktop home did not settle its sidebar rows before capture.')
          assert(metrics.idleThreadRowHeights.every((height) => height === 32),
            `desktop idle sidebar rows drifted from 32px: ${metrics.idleThreadRowHeights.join(', ')}`)
          assert(metrics.detailThreadRowHeights.every((height) => height === 48),
            `desktop detail sidebar rows drifted from 48px: ${metrics.detailThreadRowHeights.join(', ')}`)
          assert(metrics.visibleThreadPreviewCount === metrics.detailThreadRowCount,
            `desktop sidebar exposed ${metrics.visibleThreadPreviewCount} previews for ${metrics.detailThreadRowCount} detail rows.`)
        } else if (state.name === 'home' && viewport.width >= 768) {
          assert(metrics.sidebarWidth === 0 && metrics.shellMode.includes('is-overlay-sidebar'),
            `compact home kept a persistent ${metrics.sidebarWidth}px sidebar.`)
        }
      }
      if (!['home', 'thread', 'sidebar', 'composer'].includes(state.name)) {
        assert(metrics.baselineState === state.expected,
          `${state.name} at ${viewport.width}x${viewport.height} rendered ${metrics.baselineState || '<empty>'} instead of ${state.expected}.`)
      }
      if (state.name === 'running') {
        assert(metrics.liveOverlayCount >= 1 && metrics.detailedLiveOverlayCount === 1 && metrics.requestPanelCount === 0,
          `running at ${viewport.width}x${viewport.height} lost its unique running owner.`)
      } else if (state.name === 'completed') {
        assert(metrics.liveOverlayCount === 0 && metrics.requestPanelCount === 0,
          `completed at ${viewport.width}x${viewport.height} retained a live or waiting owner.`)
        assert(metrics.activitySummaryCount === 1 && metrics.visibleCommandRowCount === 0,
          `completed at ${viewport.width}x${viewport.height} did not collapse process rows into one activity summary.`)
      } else if (state.name === 'waiting-input') {
        assert(metrics.liveOverlayCount === 0 && metrics.requestPanelCount >= 1 && metrics.visibleRequestActionCount > 0,
          `waiting-input at ${viewport.width}x${viewport.height} lost its request owner.`)
      } else if (state.name === 'sidebar') {
        const usesTouchSizedRows = viewport.width < 768 || (viewport.height <= 480 && viewport.width <= 932)
        const expectedIdleHeight = usesTouchSizedRows ? 44 : 32
        const expectedDetailHeight = usesTouchSizedRows ? 52 : 48
        assert(metrics.idleThreadRowCount > 0 && metrics.detailThreadRowCount > 0,
          `sidebar at ${viewport.width}x${viewport.height} did not expose both row densities.`)
        assert(metrics.idleThreadRowHeights.every((height) => height === expectedIdleHeight),
          `sidebar idle rows at ${viewport.width}x${viewport.height} drifted from ${expectedIdleHeight}px.`)
        assert(metrics.detailThreadRowHeights.every((height) => height === expectedDetailHeight),
          `sidebar detail rows at ${viewport.width}x${viewport.height} drifted from ${expectedDetailHeight}px.`)
        assert(metrics.visibleThreadPreviewCount === metrics.detailThreadRowCount,
          `sidebar exposed ${metrics.visibleThreadPreviewCount} previews for ${metrics.detailThreadRowCount} detail rows.`)
      } else if (state.name === 'composer') {
        const usesTouchSizedControls = viewport.width < 768 || (viewport.height <= 480 && viewport.width <= 932)
        assert(metrics.composerHeight >= 80 && metrics.composerHeight <= 96,
          `composer at ${viewport.width}x${viewport.height} rendered at ${metrics.composerHeight}px.`)
        assert(metrics.composerRadius === 14,
          `composer at ${viewport.width}x${viewport.height} rendered a ${metrics.composerRadius}px radius.`)
        assert(!metrics.composerControlsOverlap,
          `composer controls overlap at ${viewport.width}x${viewport.height}.`)
        assert(metrics.composerRuntimeTriggerCount === 1 && metrics.composerSubmitCount === 1,
          `composer at ${viewport.width}x${viewport.height} lost runtime or submit controls.`)
        if (usesTouchSizedControls) {
          assert(metrics.composerControlMinHeight >= 44,
            `composer touch controls at ${viewport.width}x${viewport.height} fell below 44px.`)
        }
      }

      const fileName = `baseline-${state.name}-${viewport.width}x${viewport.height}.png`
      await page.screenshot({ path: path.join(outputDirectory, fileName) })
      results.push({
        state: state.name,
        viewport: `${viewport.width}x${viewport.height}`,
        screenshot: fileName,
        ...metrics,
      })
      process.stdout.write(`[quiet-workbench] ${state.name} ${viewport.width}x${viewport.height} ok\n`)
    }
  }

  assert(pageErrors.length === 0, `Page errors detected: ${pageErrors.join(' | ')}`)
  const manifestName = scope === 'all' ? 'manifest.json' : `manifest-${scope}.json`
  const manifestPath = path.join(outputDirectory, manifestName)
  fs.writeFileSync(manifestPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8')
  process.stdout.write(`Quiet Workbench Playwright baseline captured: ${manifestPath}\n`)
} finally {
  await context.close()
  await browser.close()
}
