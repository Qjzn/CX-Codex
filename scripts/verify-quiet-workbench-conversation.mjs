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
const outputDirectory = path.resolve(readArg('--output-directory', 'output/quiet-workbench/conversation-contract'))
const chromePath = readArg('--chrome-path', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
assert(fs.existsSync(chromePath), `Chrome was not found at ${chromePath}.`)
fs.mkdirSync(outputDirectory, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: chromePath })
const context = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce', deviceScaleFactor: 1 })
let page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

async function openFixture(pathname, width, height, readySelector) {
  await page.setViewportSize({ width, height })
  await page.goto('about:blank')
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator(readySelector).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(250)
}

const results = {}
try {
  await openFixture(
    '/#/__regression/conversation-blocks?regression=frontend&uxState=completed',
    1440,
    900,
    '[data-ux-baseline-state="completed"]',
  )
  const summary = page.locator('li.conversation-item[data-message-type="guidedSummary"] .guided-turn-toggle')
  const finalAnswer = page.getByText('检查已完成。页面没有横向溢出，最终结果和执行摘要都可读取。', { exact: true })
  assert(await summary.count() === 1, 'completed turn must render one activity summary')
  assert(await page.locator('.conversation-item .cmd-row').count() === 0, 'completed command must be folded by default')
  assert(await finalAnswer.isVisible(), 'completed turn final answer must remain visible')
  await page.screenshot({ path: path.join(outputDirectory, 'completed-collapsed.png') })
  await summary.click()
  await page.locator('.conversation-item .cmd-row').waitFor({ state: 'visible', timeout: 5_000 })
  assert(await summary.getAttribute('aria-expanded') === 'true', 'activity summary must report its expanded state')
  assert(await finalAnswer.isVisible(), 'expanding activity must not replace the final answer')
  await page.screenshot({ path: path.join(outputDirectory, 'completed-expanded.png') })
  results.completed = { summaryCount: 1, collapsedCommandCount: 0, expandedCommandCount: 1, finalAnswerVisible: true }

  await openFixture(
    '/#/__regression/conversation-blocks?regression=frontend&uxState=waiting',
    393,
    852,
    '[data-ux-baseline-state="waiting"]',
  )
  const directApproval = page.getByRole('button', { name: '仅本次允许', exact: true })
  await directApproval.waitFor({ state: 'visible', timeout: 5_000 })
  assert(await page.locator('.conversation-process-section').count() === 1, 'waiting request must retain one request owner')
  await page.screenshot({ path: path.join(outputDirectory, 'waiting-direct-action.png') })
  results.waiting = { requestOwnerCount: 1, directApprovalVisible: true }

  await openFixture(
    '/#/__regression/conversation-blocks?regression=frontend&uxState=duplicate-identity',
    393,
    852,
    '[data-ux-baseline-state="duplicate-identity"]',
  )
  const matchingUserMessages = page.locator('li.conversation-item[data-role="user"]', {
    hasText: '继续检查这个结果。',
  })
  assert(await matchingUserMessages.count() === 2, 'same-text user inputs must render as two messages')
  const messageIds = await matchingUserMessages.evaluateAll((items) => items.map((item) => item.getAttribute('data-message-id')))
  assert(new Set(messageIds).size === 2 && messageIds.every(Boolean), 'same-text user inputs must retain distinct strong identities')
  results.identity = { renderedCount: 2, messageIds }

  await page.close()
  page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await openFixture(
    '/#/__regression/conversation-blocks?regression=frontend&streamStress=1',
    393,
    852,
    '[data-testid="conversation-streaming-stress-status"]',
  )
  const stressStatus = page.locator('[data-testid="conversation-streaming-stress-status"]')
  await page.waitForFunction(() => {
    const status = document.querySelector('[data-testid="conversation-streaming-stress-status"]')
    return Number(status?.getAttribute('data-update-count') ?? 0) >= 20
      && Number(status?.getAttribute('data-heartbeat-count') ?? 0) >= 20
  }, undefined, { timeout: 5_000 })
  const updatesBeforeAction = Number(await stressStatus.getAttribute('data-update-count') ?? 0)
  await page.locator('[data-testid="conversation-streaming-stress-action"]').click()
  await page.waitForFunction((previous) => {
    const status = document.querySelector('[data-testid="conversation-streaming-stress-status"]')
    return Number(status?.getAttribute('data-action-count') ?? 0) === 1
      && Number(status?.getAttribute('data-update-count') ?? 0) > previous
  }, updatesBeforeAction, { timeout: 3_000 })
  const stressMetrics = await page.evaluate(() => {
    const status = document.querySelector('[data-testid="conversation-streaming-stress-status"]')
    return {
      messageCount: Number(document.querySelector('.conversation-list')?.getAttribute('data-message-count') ?? 0),
      mountedItems: document.querySelectorAll('li.conversation-item').length,
      updateCount: Number(status?.getAttribute('data-update-count') ?? 0),
      heartbeatCount: Number(status?.getAttribute('data-heartbeat-count') ?? 0),
      maxHeartbeatLagMs: Number(status?.getAttribute('data-max-heartbeat-lag-ms') ?? 0),
      actionCount: Number(status?.getAttribute('data-action-count') ?? 0),
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    }
  })
  assert(stressMetrics.messageCount === 1602, `stress fixture rendered ${stressMetrics.messageCount} messages instead of 1602`)
  assert(stressMetrics.mountedItems <= 20, `stress fixture mounted ${stressMetrics.mountedItems} conversation items`)
  assert(stressMetrics.maxHeartbeatLagMs < 80, `stress fixture heartbeat lag reached ${stressMetrics.maxHeartbeatLagMs}ms`)
  assert(stressMetrics.actionCount === 1 && stressMetrics.updateCount > updatesBeforeAction, 'streaming must remain interactive after the action')
  assert(!stressMetrics.hasHorizontalOverflow, 'stress fixture must not overflow horizontally')
  await page.screenshot({ path: path.join(outputDirectory, 'streaming-stress-phone.png') })
  results.stress = stressMetrics

  assert(pageErrors.length === 0, `Page errors detected: ${pageErrors.join(' | ')}`)
  const manifestPath = path.join(outputDirectory, 'manifest.json')
  fs.writeFileSync(manifestPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8')
  process.stdout.write(`Quiet Workbench conversation contract passed: ${manifestPath}\n`)
} finally {
  await context.close()
  await browser.close()
}
