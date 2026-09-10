import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Fixture-only browser test. The caller starts Vite; this script never starts a bridge.
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]
  assert.ok(name?.startsWith('--') && value && !value.startsWith('--'), 'Arguments must be --name value pairs')
  assert.ok(['--base-url', '--output-dir'].includes(name), `Unknown argument: ${name}`)
  args.set(name, value)
}
assert.ok(args.has('--base-url'), 'Pass the already-running Vite URL with --base-url')
const fixtureUrl = new URL(args.get('--base-url'))
assert.ok(['http:', 'https:'].includes(fixtureUrl.protocol), '--base-url must be an HTTP(S) URL')
fixtureUrl.hash = '/__regression/conversation-blocks?regression=frontend&fixture=send-feedback'
const outputDir = path.resolve(args.get('--output-dir') ?? 'output/send-feedback-browser')
await mkdir(outputDir, { recursive: true })

const require = createRequire(import.meta.url)
async function loadPlaywright() {
  const configured = process.env.CX_CODEX_PLAYWRIGHT_MODULE?.trim()
  if (configured) {
    const specifier = configured.startsWith('file:')
      ? configured
      : pathToFileURL(require.resolve(configured)).href
    return import(specifier)
  }
  try {
    return await import('playwright')
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error
    try {
      return await import('playwright-core')
    } catch {
      throw new Error('Playwright is unavailable. Install the project test dependency or set CX_CODEX_PLAYWRIGHT_MODULE to an existing module path.')
    }
  }
}

const playwright = await loadPlaywright()
const chromium = playwright.chromium ?? playwright.default?.chromium
assert.ok(chromium, 'The configured module does not export Playwright chromium')
const executablePath = process.env.CX_CODEX_CHROMIUM_EXECUTABLE?.trim()
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
const results = []

async function eventually(check, label) {
  const deadline = Date.now() + 8_000
  let lastError
  while (Date.now() < deadline) {
    try {
      return await check()
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`)
}

function isRuntimeUrl(value) {
  const url = new URL(value)
  return /^\/codex-api(?:\/|$)/u.test(url.pathname)
}

async function verifyViewport({ name, width, height, mobile }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    serviceWorkers: 'block',
  })
  const runtimeRequests = []
  const mockedRequests = []
  const browserErrors = []
  await context.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (route.request().method() === 'GET' && requestUrl.pathname === '/codex-api/favorites') {
      // App initializes favorites even on fixture routes. Match localStateRoutes' read-only response.
      mockedRequests.push('GET /codex-api/favorites')
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
      return
    }
    if (isRuntimeUrl(route.request().url())) {
      runtimeRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  // WebSocket requests are not covered by HTTP routing. Block the bridge before it can connect.
  await context.addInitScript(() => {
    const BrowserWebSocket = window.WebSocket
    window.WebSocket = class FixtureWebSocket extends BrowserWebSocket {
      constructor(url, protocols) {
        if (/^\/codex-api(?:\/|$)/u.test(new URL(url, location.href).pathname)) {
          throw new Error('Send-feedback fixture attempted a runtime WebSocket connection')
        }
        super(url, protocols)
      }
    }
  })
  const page = await context.newPage()
  page.setDefaultTimeout(8_000)
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  const steps = []
  try {
    const response = await page.goto(fixtureUrl.href, { waitUntil: 'domcontentloaded' })
    assert.ok(response?.ok(), `Fixture page returned ${String(response?.status())}`)
    await page.getByTestId('send-feedback-controls').waitFor({ state: 'visible' })
    const transcript = page.locator('.conversation-regression-thread')
    const latestTurn = transcript.locator('.turn-shell').last()
    let submittedText = ''

    async function assertNoDuplicateOrOverflow() {
      const userTexts = await transcript.locator('.user-message .message-markdown--user').allTextContents()
      assert.equal(userTexts.filter((text) => text.trim() === submittedText).length, 1, 'The submitted user message must appear exactly once')
      const overflow = await page.evaluate(() => {
        const candidates = [document.documentElement, document.querySelector('.conversation-regression-thread'), document.querySelector('.transcript-list')]
        return candidates.filter(Boolean).map((element) => ({
          element: element.className || element.tagName,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        })).filter((item) => item.scrollWidth > item.clientWidth + 1)
      })
      assert.deepEqual(overflow, [], 'The fixture must not introduce horizontal page or transcript overflow')
      assert.deepEqual(runtimeRequests, [], 'A pure frontend fixture must not call the runtime')
    }

    async function assertNotExecuting() {
      assert.equal(await latestTurn.locator('.turn-timing[data-status="running"]').count(), 0, 'Unstarted submission must not have an execution clock')
      assert.doesNotMatch(await latestTurn.getAttribute('class') ?? '', /turn-shell--(?:queued|running)\b/u, 'Transport feedback must not imply queue admission or execution')
      assert.doesNotMatch(await latestTurn.innerText(), /正在思考|已处理\s*\d|耗时\s*\d/u, 'Execution feedback needs authoritative execution evidence')
    }

    async function step(state, check, screenshot = false) {
      const startedAt = performance.now()
      await page.getByTestId(`send-feedback-${state}`).click()
      await eventually(check, `${name}/${state}`)
      await assertNoDuplicateOrOverflow()
      steps.push({ state, observedAfterClickMs: Math.round(performance.now() - startedAt) })
      if (screenshot) await page.screenshot({ path: path.join(outputDir, `${name}-${state}.png`), fullPage: true })
    }

    await page.getByTestId('send-feedback-sending').click()
    submittedText = (await transcript.locator('.user-message .message-markdown--user').last().innerText()).trim()
    assert.ok(submittedText, 'The fixture needs a non-empty submitted user message')

    await step('sending', async () => {
      assert.equal((await latestTurn.locator('.delivery-state').innerText()).trim(), '发送中')
      await assertNotExecuting()
      assert.equal(await latestTurn.locator('.turn-live-state').count(), 0, 'Sending feedback should not gain a second live spinner')
    })
    await step('confirming', async () => {
      assert.equal((await latestTurn.locator('.delivery-state').innerText()).trim(), '正在确认送达')
      await assertNotExecuting()
      assert.equal(await latestTurn.locator('.turn-live-state').count(), 0, 'Confirmation feedback should not gain a second live spinner')
    })
    await step('accepted', async () => {
      assert.match(await latestTurn.innerText(), /已送达[，,、\s]*等待启动/u)
      await assertNotExecuting()
    }, true)
    await step('running', async () => {
      assert.match(await latestTurn.getAttribute('class') ?? '', /turn-shell--running\b/u)
      assert.equal(await latestTurn.locator('.turn-live-state').count(), 1, 'Running feedback must have one status owner')
      assert.match(await latestTurn.locator('.turn-live-state').innerText(), /正在处理/u)
      assert.equal(await latestTurn.locator('.turn-timing[data-status="running"]').count(), 1, 'Confirmed execution must expose its execution clock')
    }, true)
    await step('completed', async () => {
      assert.match(await latestTurn.getAttribute('class') ?? '', /turn-shell--completed\b/u)
      assert.equal(await latestTurn.locator('.final-answer').count(), 1)
      assert.ok((await latestTurn.locator('.final-answer .message-markdown').innerText()).trim(), 'Completion must render the final answer')
      assert.equal(await latestTurn.locator('.turn-live-state').count(), 0)
      assert.equal(await latestTurn.locator('.turn-timing[data-status="running"]').count(), 0)
    })
    await step('waiting-network', async () => {
      assert.equal((await latestTurn.locator('.delivery-state').innerText()).trim(), '等待网络')
      await assertNotExecuting()
    })
    await step('failed', async () => {
      assert.equal((await latestTurn.locator('.delivery-state').innerText()).trim(), '发送失败')
      assert.equal(await latestTurn.getByRole('button', { name: '重试', exact: true }).count(), 1)
      await assertNotExecuting()
    }, true)
    assert.deepEqual(browserErrors, [], 'The fixture must have no browser runtime or console errors')
    results.push({ viewport: name, width, height, passed: true, steps, mockedRequests })
    console.log(`PASS send-feedback ${name} ${width}x${height}: ${steps.map((item) => item.state).join(' → ')}`)
  } catch (error) {
    await page.screenshot({ path: path.join(outputDir, `${name}-failure.png`), fullPage: true }).catch(() => {})
    results.push({ viewport: name, width, height, passed: false, steps, error: String(error), runtimeRequests, mockedRequests, browserErrors })
    throw error
  } finally {
    await context.close()
  }
}

try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900, mobile: false },
    { name: 'mobile', width: 393, height: 852, mobile: true },
  ]) {
    await verifyViewport(viewport)
  }
} finally {
  await writeFile(path.join(outputDir, 'results.json'), `${JSON.stringify({ fixtureUrl: fixtureUrl.href, results }, null, 2)}\n`)
  await browser.close()
}
