import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import WebSocket from 'ws'

const argumentsByName = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]
  if (name?.startsWith('--') && value) argumentsByName.set(name.slice(2), value)
}

const cdpPort = Number(argumentsByName.get('cdp-port') ?? '9334')
const baseUrl = argumentsByName.get('base-url') ?? 'http://127.0.0.1:4175'
const outputDir = path.resolve(argumentsByName.get('output-dir') ?? '.tmp/conversation-visual')
const mode = argumentsByName.get('mode') ?? 'fixture'
const threadId = argumentsByName.get('thread-id')?.trim() ?? ''
const requireFileSummary = readBooleanArgument('require-file-summary', true)
const requireCacheReload = readBooleanArgument('require-cache-reload', mode === 'real')
const allowIsolatedRpcErrors = readBooleanArgument('allow-isolated-rpc-errors', false)
const fixtureUrl = `${baseUrl}/#/__regression/conversation-blocks?regression=frontend`
const syncDegradedUrl = `${fixtureUrl}&streamStress=1&syncDegraded=1`
const longTurnsUrl = `${fixtureUrl}&longTurns=1`
const longHistoryUrl = `${longTurnsUrl}&longHistory=1`
const queueReorderUrl = `${fixtureUrl}&queueReorder=1`
const composerUrl = `${baseUrl}/#/__regression/composer-shell?regression=frontend`
const composerGoalUrl = `${composerUrl}&goal=1&goalEmpty=1`
const shellUrl = `${baseUrl}/#/__regression/docs-showcase?regression=frontend`
const homeUrl = `${baseUrl}/#/?regression=frontend`
const realSessionUrl = `${baseUrl}/#/thread/${encodeURIComponent(threadId)}`

function readBooleanArgument(name, fallback) {
  const value = argumentsByName.get(name)?.trim().toLowerCase()
  if (!value) return fallback
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  throw new Error(`--${name} must be true or false`)
}

class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.events = []
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (!message.id) {
        const isFailedResponse = message.method === 'Network.responseReceived'
          && Number(message.params?.response?.status ?? 0) >= 400
        if (
          message.method === 'Runtime.exceptionThrown'
          || message.method === 'Log.entryAdded'
          || message.method === 'Runtime.consoleAPICalled'
          || isFailedResponse
          || message.method === 'Network.loadingFailed'
        ) {
          this.events.push(message)
          if (this.events.length > 200) this.events.shift()
        }
        return
      }
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result ?? {})
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, 15_000)
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function openSocket(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP websocket open timed out')), 10_000)
    socket.once('open', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
  return socket
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  return result.result?.value
}

async function waitFor(client, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error(`Browser condition timed out: ${expression}`)
}

async function configureViewport(client, width, height, mobile) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  })
  await client.send('Emulation.setTouchEmulationEnabled', {
    enabled: mobile,
    maxTouchPoints: mobile ? 5 : 1,
  })
}

async function clickBrowserElement(client, selector) {
  const serializedSelector = JSON.stringify(selector)
  const point = await evaluate(client, `(() => {
    const element = document.querySelector(${serializedSelector});
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element?.getBoundingClientRect();
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
  })()`)
  assert(point, `Browser click target not found: ${selector}`)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: point.x, y: point.y }] })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  return point
}

async function navigate(
  client,
  url,
  readyExpression = `Boolean(document.querySelector('.conversation-regression-fixture .transcript-list'))`,
) {
  await client.send('Page.navigate', { url: 'about:blank' })
  await waitFor(client, `location.href === 'about:blank'`)
  const navigation = await client.send('Page.navigate', { url })
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`)
  try {
    await waitFor(client, readyExpression, 20_000)
  } catch (error) {
    const pageState = await evaluate(client, `({ url: location.href, title: document.title, text: document.body?.innerText?.slice(0, 500) ?? '', html: document.body?.innerHTML?.slice(0, 500) ?? '' })`)
    throw new Error(`${error.message}\n${JSON.stringify(pageState)}\n${JSON.stringify(summarizeBrowserErrors(client.events).slice(0, 20))}`)
  }
  await new Promise((resolve) => setTimeout(resolve, 250))
}

async function readMetrics(client, rootSelector = '.conversation-regression-thread') {
  const serializedRootSelector = JSON.stringify(rootSelector)
  return evaluate(client, `(() => {
    const root = document.documentElement;
    const transcript = document.querySelector(${serializedRootSelector});
    const toggles = Array.from(transcript?.querySelectorAll('.process-toggle') ?? []);
    const mobileTargets = Array.from(transcript?.querySelectorAll('.quiet-button, .process-toggle, .activity-details > summary, .file-summary > summary, .file-row > summary') ?? [])
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < innerHeight
          && rect.left < innerWidth;
      })
      .map((element) => ({
        height: Math.round(element.getBoundingClientRect().height),
        className: element.className,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      }));
    const activityCounts = Array.from(transcript?.querySelectorAll('.turn-shell') ?? [])
      .map((element) => Number(element.getAttribute('data-activity-count') || '0'));
    const finalsPerTurn = Array.from(transcript?.querySelectorAll('.turn-shell') ?? [])
      .map((turn) => ({
        turnId: turn.getAttribute('data-turn-id') || '',
        count: turn.querySelectorAll('.final-answer').length,
      }));
    const transcriptText = transcript?.textContent || '';
    const internalMarkers = ['<codex_internal_context', '<recommended_plugins', '<permissions', '<environment_context', '<skills_instructions'];
    return {
      viewportWidth: innerWidth,
      threadId: transcript?.querySelector('.transcript-list')?.getAttribute('data-thread-id') || '',
      turnCount: Number(transcript?.querySelector('.transcript-list')?.getAttribute('data-turn-count') || '0'),
      projectedMessageCount: Number(transcript?.querySelector('.transcript-list')?.getAttribute('data-message-count') || '0'),
      mountedTurnCount: transcript?.querySelectorAll('.turn-shell').length ?? 0,
      mountedMessageCount: transcript?.querySelectorAll('[data-message-id]').length ?? 0,
      virtualized: transcript?.querySelector('.transcript-list')?.getAttribute('data-virtualized') ?? '',
      firstMountedTurnIndex: Number(transcript?.querySelector('.turn-shell')?.getAttribute('data-turn-index') || '-1'),
      lastMountedTurnIndex: Number(Array.from(transcript?.querySelectorAll('.turn-shell') ?? []).at(-1)?.getAttribute('data-turn-index') || '-1'),
      finalCount: transcript?.querySelectorAll('.final-answer').length ?? 0,
      finalsPerTurn,
      multipleFinalTurnIds: finalsPerTurn.filter((entry) => entry.count > 1).map((entry) => entry.turnId),
      commentaryCount: transcript?.querySelectorAll('.commentary-block').length ?? 0,
      mountedActivityCount: transcript?.querySelectorAll('.activity-block').length ?? 0,
      activityGroupCount: transcript?.querySelectorAll('.activity-group[data-activity-group-id]').length ?? 0,
      projectedActivityCount: Math.max(0, ...activityCounts),
      fileSummaryCount: transcript?.querySelectorAll('.file-summary').length ?? 0,
      openFileSummaryCount: transcript?.querySelectorAll('.file-summary[open]').length ?? 0,
      maximumFileSummaryHeight: Math.round(Math.max(0, ...Array.from(transcript?.querySelectorAll('.file-summary') ?? [])
        .map((summary) => summary.getBoundingClientRect().height))),
      visibleFileRowCount: Array.from(transcript?.querySelectorAll('.file-row') ?? [])
        .filter((row) => row.closest('details.file-summary')?.open && row.getClientRects().length > 0).length,
      requestCardCount: transcript?.querySelectorAll('.request-card').length ?? 0,
      interactionTypes: Array.from(transcript?.querySelectorAll('.request-card[data-interaction-type]') ?? [])
        .map((card) => card.getAttribute('data-interaction-type') || ''),
      mcpPersistenceScopes: Array.from(transcript?.querySelectorAll('.request-card[data-interaction-type="mcp-approval"] [data-persistence-scope]') ?? [])
        .map((button) => button.getAttribute('data-persistence-scope') || ''),
      mcpContextText: Array.from(transcript?.querySelectorAll('.request-card[data-interaction-type="mcp-approval"] .request-context-row') ?? [])
        .map((row) => (row.textContent || '').trim().replace(/\\s+/g, ' ')),
      userInputSelectCount: transcript?.querySelectorAll('.request-card[data-interaction-type="user-input"] select').length ?? 0,
      userInputSelectedText: transcript?.querySelector('.request-card[data-interaction-type="user-input"] select')?.selectedOptions?.[0]?.textContent?.trim() ?? '',
      userInputOtherCount: transcript?.querySelectorAll('.request-card[data-interaction-type="user-input"] input').length ?? 0,
      userInputSubmitDisabled: transcript?.querySelector('.request-card[data-interaction-type="user-input"] [data-request-action="submit-user-input"]')?.disabled ?? false,
      mcpAuthorizationTextareaCount: transcript?.querySelectorAll('.request-card[data-interaction-type="mcp-input"] textarea').length ?? 0,
      safeAuthorizationLinkCount: Array.from(transcript?.querySelectorAll('.request-card[data-interaction-type="mcp-input"] .request-link') ?? [])
        .filter((link) => link instanceof HTMLAnchorElement && link.protocol === 'https:' && link.target === '_blank' && link.rel.includes('noopener')).length,
      missingFinalCount: transcript?.querySelectorAll('.final-status[data-status="missing"]').length ?? 0,
      streamingFinalCount: transcript?.querySelectorAll('.final-answer.is-streaming').length ?? 0,
      terminalStreamingFinalCount: transcript?.querySelectorAll('.turn-shell:not(.is-active) .final-answer.is-streaming').length ?? 0,
      activeTurnCount: transcript?.querySelectorAll('.turn-shell.is-active').length ?? 0,
      syncDegradedActiveTurnCount: transcript?.querySelectorAll('.turn-shell--sync-degraded.is-active').length ?? 0,
      activeProcessExpanded: transcript?.querySelector('.turn-shell.is-active .process-toggle')?.getAttribute('aria-expanded') ?? '',
      activeProcessDisabled: transcript?.querySelector('.turn-shell.is-active .process-toggle')?.disabled ?? false,
      activeCollapsedProcessCount: toggles.filter((toggle) => toggle.closest('.turn-shell.is-active') && toggle.getAttribute('aria-expanded') !== 'true').length,
      completedExpandedCount: toggles.filter((toggle) => toggle.closest('.turn-shell:not(.is-active)') && toggle.getAttribute('aria-expanded') === 'true').length,
      legacyOverlayCount: document.querySelectorAll('.live-overlay-inline, .live-overlay-sheet, .conversation-live-overlay').length,
      internalContextLeakCount: internalMarkers.filter((marker) => transcriptText.toLowerCase().includes(marker)).length,
      horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
      touchTargetCount: mobileTargets.length,
      minimumTouchTargetHeight: mobileTargets.length > 0 ? Math.min(...mobileTargets.map((target) => target.height)) : 0,
      undersizedTouchTargets: mobileTargets.filter((target) => target.height < 44).slice(0, 12),
      timingCount: transcript?.querySelectorAll('.turn-timing').length ?? 0,
      turnDividerCount: transcript?.querySelectorAll('.turn-divider').length ?? 0,
      unavailableTimingCopyCount: Array.from(transcript?.querySelectorAll('.turn-timing') ?? [])
        .filter((entry) => entry.textContent?.includes('执行耗时不可用')).length,
      legacyTurnHeadingCount: transcript?.querySelectorAll('.turn-heading, .assistant-mark, .turn-state').length ?? 0,
      liveStateCount: transcript?.querySelectorAll('.turn-live-state').length ?? 0,
      syncDegradedStateCount: transcript?.querySelectorAll('.turn-live-state[data-state="sync-degraded"]').length ?? 0,
    };
  })()`)
}

async function readMotionMetrics(client) {
  return evaluate(client, `(() => {
    const chevron = document.querySelector('.conversation-regression-thread .process-toggle-icon');
    const liveDot = document.querySelector('.conversation-regression-thread .turn-live-dot, .conversation-regression-thread .activity-block--in-progress .process-rail-dot');
    return {
      chevronTransitionDuration: chevron ? getComputedStyle(chevron).transitionDuration : '',
      liveAnimationName: liveDot ? getComputedStyle(liveDot).animationName : '',
      liveAnimationDuration: liveDot ? getComputedStyle(liveDot).animationDuration : '',
    };
  })()`)
}

async function verifyMotionPreference(client) {
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  const normal = await readMotionMetrics(client)
  assert(normal.chevronTransitionDuration && normal.chevronTransitionDuration !== '0s', `Sema disclosure motion is missing: ${JSON.stringify(normal)}`)
  assert(normal.liveAnimationName && normal.liveAnimationName !== 'none', `running-state feedback is missing: ${JSON.stringify(normal)}`)
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  const reduced = await readMotionMetrics(client)
  assert(reduced.liveAnimationName === 'none', `reduced-motion kept a continuous running animation: ${JSON.stringify(reduced)}`)
  assert(reduced.chevronTransitionDuration === '0.001s', `reduced-motion disclosure duration is not bounded to 1ms: ${JSON.stringify(reduced)}`)
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  return { normal, reduced }
}

async function capture(client, fileName, focusSelector) {
  await evaluate(client, `document.querySelector(${JSON.stringify(focusSelector)})?.scrollIntoView({ block: 'center', inline: 'nearest' })`)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const target = path.join(outputDir, fileName)
  await fs.writeFile(target, Buffer.from(screenshot.data, 'base64'))
  return target
}

async function captureViewport(client, fileName) {
  const screenshot = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const target = path.join(outputDir, fileName)
  await fs.writeFile(target, Buffer.from(screenshot.data, 'base64'))
  return target
}

async function verifyCompletedDetails(client) {
  const opened = await evaluate(client, `(() => {
    const completedTurns = Array.from(document.querySelectorAll('.conversation-regression-thread .turn-shell:not(.is-active)'));
    let opened = 0;
    for (const turn of completedTurns) {
      const toggle = turn.querySelector('.process-toggle');
      if (toggle instanceof HTMLButtonElement) {
        toggle.click();
        opened += 1;
      }
      const fileSummary = turn.querySelector('.file-summary');
      if (fileSummary instanceof HTMLDetailsElement && !fileSummary.open) fileSummary.querySelector('summary')?.click();
    }
    return opened;
  })()`)
  assert(opened >= 1, 'completed process could not be expanded')
  await new Promise((resolve) => setTimeout(resolve, 80))
  const historyOpened = await evaluate(client, `(() => {
    const buttons = Array.from(document.querySelectorAll('.conversation-regression-thread .turn-shell:not(.is-active) .process-history-action[aria-expanded="false"]'));
    for (const button of buttons) button.click();
    return buttons.length;
  })()`)
  assert(historyOpened >= 1, 'completed process history could not be expanded')
  await new Promise((resolve) => setTimeout(resolve, 80))
  const details = await evaluate(client, `(() => {
    const root = document.querySelector('.conversation-regression-thread');
    const expandedTurns = Array.from(root?.querySelectorAll('.turn-shell:not(.is-active) .process-toggle[aria-expanded="true"]') || [])
      .map((toggle) => toggle.closest('.turn-shell'))
      .filter(Boolean);
    const text = root?.textContent || '';
    return {
      activityCount: expandedTurns.reduce((total, turn) => total + turn.querySelectorAll('.activity-block').length, 0),
      hasMcp: text.includes('get_pull_request'),
      hasSearch: text.includes('sema-code-core conversation event model'),
      searchStatus: root?.querySelector('[data-activity-id="fixture-search-activity"]')?.textContent || '',
      hasCollaboration: text.includes('创建协同子任务') && text.includes('检查会话事件归并与最终回复识别'),
      hasDynamicTool: text.includes('创建任务') && text.includes('codex_app'),
      hasImageGeneration: text.includes('生成图片') && text.includes('output/regression-7420/generated-diagram.png'),
      leakedInternalActivityPayload: text.includes('fixture hook prompt must stay internal')
        || text.includes('fixture dynamic arguments must stay internal')
        || text.includes('fixture revised image prompt must stay internal')
        || text.includes('fixture-image-payload-must-stay-internal'),
      hasFilePath: text.includes('src/conversation-transcript/projectConversation.ts'),
      hasFinal: Boolean(root?.querySelector('.final-answer')),
    };
  })()`)
  assert(details.activityCount >= 8 && details.hasMcp && details.hasSearch && details.hasCollaboration && details.hasDynamicTool && details.hasImageGeneration, `completed process lost structured detail: ${JSON.stringify(details)}`)
  assert(!details.leakedInternalActivityPayload, `internal activity payload leaked into the transcript: ${JSON.stringify(details)}`)
  assert(details.searchStatus.includes('完成') && !details.searchStatus.includes('等待中'), `completed status-less search remained pending after refresh: ${JSON.stringify(details)}`)
  assert(details.hasFilePath && details.hasFinal, `completed turn lost file detail or final: ${JSON.stringify(details)}`)
  const collaborationScreenshot = await capture(
    client,
    'conversation-current-schema-activities.png',
    '[data-activity-id="fixture-dynamic-tool-activity"]',
  )
  await evaluate(client, `(() => { for (const toggle of document.querySelectorAll('.conversation-regression-thread .turn-shell:not(.is-active) .process-toggle[aria-expanded="true"]')) toggle.click(); return true })()`)
  return collaborationScreenshot
}

async function verifyMcpPersistenceResponse(client, scope) {
  const clicked = await evaluate(client, `(() => {
    const button = document.querySelector('[data-persistence-scope="${scope}"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`)
  assert(clicked, `MCP ${scope} action is missing`)
  await new Promise((resolve) => setTimeout(resolve, 40))
  const response = await evaluate(client, `(() => {
    const raw = document.querySelector('.conversation-regression-server-response')?.getAttribute('data-last-response') || 'null';
    return JSON.parse(raw);
  })()`)
  assert(response?.id === 742001, `MCP ${scope} response used the wrong request: ${JSON.stringify(response)}`)
  assert(response?.result?.action === 'accept' && response?.result?.content && Object.keys(response.result.content).length === 0, `MCP ${scope} response lost the accept payload: ${JSON.stringify(response)}`)
  assert(response?.result?._meta?.persist === scope, `MCP ${scope} response lost its advertised persistence scope: ${JSON.stringify(response)}`)
  return response
}

async function verifyUserInputResponse(client) {
  const controlsReady = await evaluate(client, `(() => {
    const card = document.querySelector('.request-card[data-interaction-type="user-input"]');
    const select = card?.querySelector('select');
    const input = card?.querySelector('input');
    if (!(select instanceof HTMLSelectElement) || !(input instanceof HTMLInputElement)) return false;
    select.value = '桌面、手机和折叠屏';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    input.value = '保留低动态效果';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
  assert(controlsReady, 'user-input controls are missing')
  await new Promise((resolve) => setTimeout(resolve, 40))
  const submitted = await evaluate(client, `(() => {
    const button = document.querySelector('[data-request-action="submit-user-input"]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
    button.click();
    return true;
  })()`)
  assert(submitted, 'completed user-input could not be submitted')
  await new Promise((resolve) => setTimeout(resolve, 40))
  const response = await evaluate(client, `JSON.parse(document.querySelector('.conversation-regression-server-response')?.getAttribute('data-last-response') || 'null')`)
  assert(response?.id === 742004, `user-input response used the wrong request: ${JSON.stringify(response)}`)
  assert(JSON.stringify(response?.result?.answers?.['verification-scope']?.answers) === JSON.stringify(['桌面、手机和折叠屏', '保留低动态效果']), `user-input response lost explicit answers: ${JSON.stringify(response)}`)
  return response
}

async function readComposerMetrics(client) {
  return evaluate(client, `(() => {
    const root = document.documentElement;
    const fixture = document.querySelector('.composer-regression-frame');
    const composer = document.querySelector('.thread-composer');
    const shell = document.querySelector('.thread-composer-shell');
    const input = document.querySelector('.thread-composer-input');
    const controls = document.querySelector('.thread-composer-controls');
    const targets = Array.from(document.querySelectorAll('.thread-composer-attach-trigger, .thread-composer-runtime-trigger, .thread-composer-expand, .thread-composer-mic, .thread-composer-submit, .thread-composer-stop'))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      })
      .map((element) => ({
        element,
        className: element.className,
        width: Math.round(element.getBoundingClientRect().width),
        height: Math.round(element.getBoundingClientRect().height),
        rect: element.getBoundingClientRect(),
      }));
    const overlappingTargets = [];
    for (let index = 0; index < targets.length; index += 1) {
      for (let candidate = index + 1; candidate < targets.length; candidate += 1) {
        const first = targets[index];
        const second = targets[candidate];
        const overlaps = first.rect.left < second.rect.right - 0.5
          && first.rect.right > second.rect.left + 0.5
          && first.rect.top < second.rect.bottom - 0.5
          && first.rect.bottom > second.rect.top + 0.5;
        if (overlaps) overlappingTargets.push([first.className, second.className]);
      }
    }
    const hitTargetFailures = targets.flatMap((target) => {
      const hit = document.elementFromPoint(
        target.rect.left + target.rect.width / 2,
        target.rect.top + target.rect.height / 2,
      );
      return hit && (target.element === hit || target.element.contains(hit))
        ? []
        : [{ className: target.className, hit: hit?.className || hit?.tagName || '' }];
    });
    const shellStyle = shell ? getComputedStyle(shell) : null;
    const inputRect = input?.getBoundingClientRect();
    const controlsRect = controls?.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      fixtureWidth: Math.round(fixture?.getBoundingClientRect().width || 0),
      composerWidth: Math.round(composer?.getBoundingClientRect().width || 0),
      shellWidth: Math.round(shell?.getBoundingClientRect().width || 0),
      shellHeight: Math.round(shell?.getBoundingClientRect().height || 0),
      shellRadius: shellStyle?.borderTopLeftRadius || '',
      shellShadow: shellStyle?.boxShadow || '',
      shellBorderColor: shellStyle?.borderTopColor || '',
      inputHeight: Math.round(inputRect?.height || 0),
      controlsHeight: Math.round(controlsRect?.height || 0),
      inputAboveControls: Boolean(inputRect && controlsRect && inputRect.bottom <= controlsRect.top + 1),
      targetCount: targets.length,
      minimumTargetWidth: targets.length ? Math.min(...targets.map((target) => target.width)) : 0,
      minimumTargetHeight: targets.length ? Math.min(...targets.map((target) => target.height)) : 0,
      undersizedTargets: targets
        .filter((target) => target.width < 44 || target.height < 44)
        .map((target) => ({ className: target.className, width: target.width, height: target.height })),
      overlappingTargets,
      hitTargetFailures,
      horizontalOverflowPx: Math.max(0, root.scrollWidth - innerWidth),
    };
  })()`)
}

async function readComposerFocusMetrics(client) {
  return evaluate(client, `(() => {
    const shell = document.querySelector('.thread-composer-shell');
    const input = document.querySelector('.thread-composer-input');
    if (!(input instanceof HTMLTextAreaElement) || !shell) return null;
    input.focus();
    return new Promise((resolve) => setTimeout(() => {
      const style = getComputedStyle(shell);
      resolve({ borderColor: style.borderTopColor, boxShadow: style.boxShadow });
    }, 240));
  })()`)
}

function assertComposerMetrics(metrics, viewportName, requireTouchTargets) {
  assert(metrics.shellWidth > 0 && metrics.inputAboveControls, `${viewportName} composer lost its two-level hierarchy: ${JSON.stringify(metrics)}`)
  assert(metrics.shellRadius === '12px', `${viewportName} composer radius drifted from the Sema shell: ${JSON.stringify(metrics)}`)
  assert(metrics.shellShadow === 'none', `${viewportName} composer restored a default floating-card shadow: ${JSON.stringify(metrics)}`)
  assert(metrics.horizontalOverflowPx <= 1, `${viewportName} composer overflowed horizontally by ${metrics.horizontalOverflowPx}px`)
  assert(metrics.targetCount >= 4, `${viewportName} composer lost expected primary controls: ${JSON.stringify(metrics)}`)
  assert(metrics.overlappingTargets.length === 0, `${viewportName} composer controls overlap: ${JSON.stringify(metrics.overlappingTargets)}`)
  assert(metrics.hitTargetFailures.length === 0, `${viewportName} composer controls are visually present but not hit-testable: ${JSON.stringify(metrics.hitTargetFailures)}`)
  if (requireTouchTargets) {
    assert(metrics.minimumTargetWidth >= 44 && metrics.minimumTargetHeight >= 44, `${viewportName} composer touch target is undersized: ${JSON.stringify(metrics.undersizedTargets)}`)
  } else {
    assert(metrics.minimumTargetWidth >= 32 && metrics.minimumTargetHeight >= 32, `${viewportName} composer desktop control is undersized: ${JSON.stringify(metrics)}`)
  }
}

async function setComposerDraft(client, value) {
  return evaluate(client, `(() => {
    const input = document.querySelector('.composer-regression-fixture .thread-composer-input');
    if (!(input instanceof HTMLTextAreaElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: ${value ? "'insertText'" : "'deleteContentBackward'"},
      data: ${value ? JSON.stringify(value) : 'null'},
    }));
    input.focus();
    return true;
  })()`)
}

async function dispatchComposerKey(client, key, modifiers = 0) {
  const keyCode = key === 'Enter' ? 13 : 0
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key,
    modifiers,
    text: key === 'Enter' ? '\r' : '',
    unmodifiedText: key === 'Enter' ? '\r' : '',
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  })
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: key,
    modifiers,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
  })
}

async function waitForComposerFrames(client) {
  await evaluate(client, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
}

async function readComposerDraftState(client) {
  return evaluate(client, `(() => {
    const input = document.querySelector('.composer-regression-fixture .thread-composer-input');
    const submitCount = document.querySelector('.composer-regression-submit-count');
    return {
      value: input instanceof HTMLTextAreaElement ? input.value : '',
      submitCount: Number.parseInt(submitCount?.textContent || '0', 10),
      focused: document.activeElement === input,
      inputHeight: Math.round(input?.getBoundingClientRect().height || 0),
    };
  })()`)
}

async function probeComposerAutoGrow(client, viewportName) {
  const result = await evaluate(client, `(async () => {
    const input = document.querySelector('.composer-regression-fixture .thread-composer-input');
    const shell = document.querySelector('.composer-regression-fixture .thread-composer-shell');
    const expand = document.querySelector('.composer-regression-fixture .thread-composer-expand');
    if (!(input instanceof HTMLTextAreaElement) || !(shell instanceof HTMLElement) || !(expand instanceof HTMLButtonElement)) {
      return { inputFound: false };
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const update = async (value) => {
      setter?.call(input, value);
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: value ? 'insertText' : 'deleteContentBackward',
        data: value || null,
      }));
      await settle();
      return { clientHeight: input.clientHeight, scrollHeight: input.scrollHeight };
    };
    const initial = await update('');
    const multiline = await update(['第一行', '第二行', '第三行', '第四行', '第五行'].join('\\n'));
    const capped = await update(Array.from({ length: 20 }, (_, index) => '第 ' + (index + 1) + ' 行内容').join('\\n'));
    const shrunk = await update('');
    expand.click();
    await settle();
    const expanded = {
      active: shell.classList.contains('thread-composer-shell--expanded'),
      inputHeight: input.clientHeight,
    };
    expand.click();
    await settle();
    return {
      inputFound: true,
      supported: CSS.supports('field-sizing', 'content'),
      fieldSizing: getComputedStyle(input).fieldSizing,
      initial,
      multiline,
      capped,
      shrunk,
      expanded,
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  })()`)
  assert(result.inputFound, `${viewportName} composer auto-grow input is missing`)
  assert(result.supported && result.fieldSizing === 'content', `${viewportName} composer lost layout-owned auto-grow: ${JSON.stringify(result)}`)
  assert(result.multiline.clientHeight >= result.initial.clientHeight + 40, `${viewportName} composer did not grow for five lines: ${JSON.stringify(result)}`)
  assert(result.multiline.scrollHeight <= result.multiline.clientHeight + 1, `${viewportName} composer scrolled before its compact cap: ${JSON.stringify(result)}`)
  assert(result.capped.clientHeight >= result.multiline.clientHeight && result.capped.clientHeight <= 132, `${viewportName} composer long-input cap drifted: ${JSON.stringify(result)}`)
  assert(result.capped.scrollHeight > result.capped.clientHeight + 100, `${viewportName} composer long input lost internal scrolling: ${JSON.stringify(result)}`)
  assert(result.shrunk.clientHeight <= result.initial.clientHeight + 1, `${viewportName} composer did not shrink after clearing: ${JSON.stringify(result)}`)
  assert(result.expanded.active && result.expanded.inputHeight > result.capped.clientHeight, `${viewportName} composer expanded editor no longer overrides the compact cap: ${JSON.stringify(result)}`)
  assert(result.horizontalOverflowPx <= 1, `${viewportName} composer auto-grow introduced horizontal overflow: ${JSON.stringify(result)}`)
  return result
}

async function probeComposerImeAndDictation(client) {
  assert(await setComposerDraft(client, '@Th'), 'composer IME probe could not find the input')
  await waitFor(client, `document.querySelectorAll('.thread-composer-file-mention-row').length > 0`, 3_000)
  const ime = await evaluate(client, `(async () => {
    const input = document.querySelector('.composer-regression-fixture .thread-composer-input');
    const submitCount = document.querySelector('.composer-regression-submit-count');
    const composingEnter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      isComposing: true,
    });
    input.dispatchEvent(composingEnter);
    const processEnter = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 229,
      which: 229,
    });
    input.dispatchEvent(processEnter);
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      composingPrevented: composingEnter.defaultPrevented,
      processPrevented: processEnter.defaultPrevented,
      processKeyCode: processEnter.keyCode,
      value: input.value,
      suggestionCount: document.querySelectorAll('.thread-composer-file-mention-row').length,
      attachmentCount: document.querySelectorAll('.thread-composer-file-chip').length,
      submitCount: Number.parseInt(submitCount?.textContent || '0', 10),
    };
  })()`)
  assert(!ime.composingPrevented && !ime.processPrevented && ime.processKeyCode === 229, `composer intercepted an IME-owned Enter: ${JSON.stringify(ime)}`)
  assert(ime.value === '@Th' && ime.suggestionCount > 0 && ime.attachmentCount === 0 && ime.submitCount === 0, `composer IME confirmation changed or submitted the draft: ${JSON.stringify(ime)}`)

  await setComposerDraft(client, '')
  const dictation = await evaluate(client, `(async () => {
    document.querySelector('.composer-regression-dictation-insert')?.click();
    await new Promise((resolve) => setTimeout(resolve, 220));
    return {
      value: document.querySelector('.thread-composer-input')?.value || '',
      submitCount: Number.parseInt(document.querySelector('.composer-regression-submit-count')?.textContent || '0', 10),
      status: document.querySelector('.thread-composer-dictation-statusbar-text')?.textContent?.trim() || '',
    };
  })()`)
  assert(dictation.value.includes('语音转文字回归测试') && dictation.submitCount === 0, `dictation did not remain an editable draft: ${JSON.stringify(dictation)}`)
  assert(dictation.status === '已转成文字，可编辑后发送。', `dictation feedback drifted: ${JSON.stringify(dictation)}`)
  await setComposerDraft(client, '')
  return { ime, dictation }
}

async function probeComposerEnterBehavior(client, viewportName, expectEnterSubmit) {
  const before = await readComposerDraftState(client)
  assert(await setComposerDraft(client, `${viewportName} 第一行`), `${viewportName} composer input is missing`)
  await dispatchComposerKey(client, 'Enter')
  await waitForComposerFrames(client)
  const afterEnter = await readComposerDraftState(client)
  if (expectEnterSubmit) {
    assert(afterEnter.submitCount === before.submitCount + 1 && afterEnter.value === '' && afterEnter.focused, `${viewportName} default Enter did not submit and restore focus: ${JSON.stringify({ before, afterEnter })}`)
    assert(await setComposerDraft(client, '桌面换行'), 'desktop composer input disappeared before Shift+Enter')
    await dispatchComposerKey(client, 'Enter', 8)
    await waitForComposerFrames(client)
    const afterShiftEnter = await readComposerDraftState(client)
    assert(afterShiftEnter.submitCount === afterEnter.submitCount && afterShiftEnter.value.includes('\n'), `desktop Shift+Enter did not insert a newline: ${JSON.stringify(afterShiftEnter)}`)
  } else {
    assert(afterEnter.submitCount === before.submitCount && afterEnter.value.includes('\n') && afterEnter.focused, `${viewportName} default Enter did not remain newline-first: ${JSON.stringify({ before, afterEnter })}`)
    await dispatchComposerKey(client, 'Enter', 2)
    await waitForComposerFrames(client)
    const afterCtrlEnter = await readComposerDraftState(client)
    assert(afterCtrlEnter.submitCount === before.submitCount + 1 && afterCtrlEnter.value === '', `${viewportName} Ctrl+Enter did not submit: ${JSON.stringify(afterCtrlEnter)}`)
  }

  await setComposerDraft(client, '本地反馈预算')
  const localFeedback = await evaluate(client, `(async () => {
    const input = document.querySelector('.thread-composer-input');
    const counter = document.querySelector('.composer-regression-submit-count');
    const beforeCount = Number.parseInt(counter?.textContent || '0', 10);
    const startedAt = performance.now();
    input.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      ctrlKey: true,
    }));
    while (performance.now() - startedAt < 500) {
      if (Number.parseInt(counter?.textContent || '0', 10) > beforeCount && input.value === '') break;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return {
      latencyMs: Math.round((performance.now() - startedAt) * 10) / 10,
      submitCount: Number.parseInt(counter?.textContent || '0', 10),
      beforeCount,
      value: input.value,
    };
  })()`)
  assert(localFeedback.submitCount === localFeedback.beforeCount + 1 && localFeedback.value === '', `${viewportName} local send feedback did not commit: ${JSON.stringify(localFeedback)}`)
  assert(localFeedback.latencyMs <= 100, `${viewportName} local send feedback exceeded 100ms: ${JSON.stringify(localFeedback)}`)
  return { afterEnter, localFeedback }
}

async function probeComposerPanels(client, viewportName, expectModal) {
  const results = []
  for (const [triggerSelector, panelSelector] of [
    ['.thread-composer-attach-trigger', '.thread-composer-attach-menu'],
    ['.thread-composer-runtime-trigger', '.thread-composer-runtime-panel'],
  ]) {
    const overflowBefore = await evaluate(client, 'document.body.style.overflow')
    await evaluate(client, `document.querySelector(${JSON.stringify(triggerSelector)})?.click()`)
    await waitFor(client, `Boolean(document.querySelector(${JSON.stringify(panelSelector)}))`, 3_000)
    await new Promise((resolve) => setTimeout(resolve, 220))
    const opened = await evaluate(client, `(() => {
      const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
      const panel = document.querySelector(${JSON.stringify(panelSelector)});
      const rect = panel?.getBoundingClientRect();
      return {
        ariaModal: panel?.getAttribute('aria-modal') || '',
        containsFocus: panel?.contains(document.activeElement) === true,
        bodyOverflow: document.body.style.overflow,
        expanded: trigger?.getAttribute('aria-expanded') || '',
        fitsViewport: Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1),
        horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      };
    })()`)
    assert(opened.containsFocus && opened.expanded === 'true' && opened.fitsViewport && opened.horizontalOverflowPx <= 1, `${viewportName} composer panel is not safely owned: ${JSON.stringify({ panelSelector, opened })}`)
    if (expectModal) {
      assert(opened.ariaModal === 'true' && opened.bodyOverflow === 'hidden', `${viewportName} compact Composer panel lost modal/scroll ownership: ${JSON.stringify({ panelSelector, opened })}`)
    } else {
      assert(opened.ariaModal === '' && opened.bodyOverflow === overflowBefore, `${viewportName} desktop Composer popover incorrectly became modal: ${JSON.stringify({ panelSelector, opened, overflowBefore })}`)
    }
    await dispatchComposerKey(client, 'Escape')
    await waitFor(client, `!document.querySelector(${JSON.stringify(panelSelector)})`, 3_000)
    const closed = await evaluate(client, `(() => ({
      triggerFocused: document.activeElement === document.querySelector(${JSON.stringify(triggerSelector)}),
      expanded: document.querySelector(${JSON.stringify(triggerSelector)})?.getAttribute('aria-expanded') || '',
      bodyOverflow: document.body.style.overflow,
    }))()`)
    assert(closed.triggerFocused && closed.expanded === 'false' && closed.bodyOverflow === overflowBefore, `${viewportName} Composer panel did not restore its environment: ${JSON.stringify({ panelSelector, closed, overflowBefore })}`)
    results.push({ panel: panelSelector, opened, closed })
  }
  return results
}

async function probeQueueReorder(client) {
  await configureViewport(client, 393, 852, true)
  await navigate(client, queueReorderUrl, `document.querySelectorAll('.conversation-regression-queue .queued-row-move').length === 2`)
  const readQueue = () => evaluate(client, `(() => {
    const root = document.querySelector('.conversation-regression-queue');
    const rows = Array.from(root?.querySelectorAll('.queued-row') || []);
    const moveButtons = Array.from(root?.querySelectorAll('.queued-row-move') || []);
    return {
      rows: rows.map((row) => row.querySelector('.queued-row-text')?.textContent?.trim() || ''),
      moveLabels: moveButtons.map((button) => button.getAttribute('aria-label') || ''),
      moveTargets: moveButtons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height) };
      }),
      horizontalOverflowPx: root ? Math.max(0, root.scrollWidth - root.clientWidth) : -1,
    };
  })()`)
  const initial = await readQueue()
  assert(initial.rows.length === 2, `queue reorder fixture must render two rows: ${JSON.stringify(initial)}`)
  assert(initial.moveLabels.length === 2 && initial.moveLabels[0]?.startsWith('下移第 1') && initial.moveLabels[1]?.startsWith('上移第 2'), `queue reorder controls do not expose the bounded directions: ${JSON.stringify(initial)}`)
  assert(initial.moveTargets.every((target) => target.width >= 44 && target.height >= 44), `queue reorder touch target is undersized: ${JSON.stringify(initial)}`)
  assert(initial.horizontalOverflowPx <= 1, `queue reorder fixture overflowed horizontally by ${initial.horizontalOverflowPx}px`)

  const movedDown = await evaluate(client, `(() => {
    const button = document.querySelector('.conversation-regression-queue .queued-row-move[aria-label^="下移第 1"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`)
  assert(movedDown, 'queue reorder down control was not reachable')
  await new Promise((resolve) => setTimeout(resolve, 80))
  const reversed = await readQueue()
  assert(reversed.rows.join('\n') === [...initial.rows].reverse().join('\n'), `queue order did not move down: ${JSON.stringify({ initial, reversed })}`)

  const movedUp = await evaluate(client, `(() => {
    const button = document.querySelector('.conversation-regression-queue .queued-row-move[aria-label^="上移第 2"]');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`)
  assert(movedUp, 'queue reorder up control was not reachable')
  await new Promise((resolve) => setTimeout(resolve, 80))
  const restored = await readQueue()
  assert(restored.rows.join('\n') === initial.rows.join('\n'), `queue order did not restore: ${JSON.stringify({ initial, restored })}`)
  const screenshot = await capture(client, 'composer-queue-reorder-mobile.png', '.conversation-regression-queue')
  return { initial, reversed, restored, screenshot }
}

async function probePersistentGoalMenu(client, viewportName, expectTouchTarget) {
  await navigate(client, composerGoalUrl, `Boolean(document.querySelector('.composer-regression-fixture .thread-composer-shell'))`)
  const before = await evaluate(client, `(() => ({
    standaloneCreateCount: document.querySelectorAll('.thread-goal-create').length,
    editorCount: document.querySelectorAll('.thread-goal-editor').length,
  }))()`)
  assert(before.standaloneCreateCount === 0 && before.editorCount === 0, `${viewportName} persistent goal occupies space before the plus menu opens: ${JSON.stringify(before)}`)
  await evaluate(client, `document.querySelector('.thread-composer-attach-trigger')?.click()`)
  await waitFor(client, `Boolean(document.querySelector('.thread-composer-attach-menu'))`, 3_000)
  const menu = await evaluate(client, `(() => {
    const button = Array.from(document.querySelectorAll('.thread-composer-attach-item'))
      .find((entry) => entry.querySelector('.thread-composer-attach-item-title')?.textContent?.trim() === '设置持续目标');
    const rect = button?.getBoundingClientRect();
    return {
      found: button instanceof HTMLButtonElement,
      width: Math.round(rect?.width || 0),
      height: Math.round(rect?.height || 0),
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    };
  })()`)
  assert(menu.found && menu.horizontalOverflowPx <= 1, `${viewportName} plus menu lost the persistent goal action: ${JSON.stringify(menu)}`)
  if (expectTouchTarget) assert(menu.height >= 44, `${viewportName} persistent goal action is smaller than 44px: ${JSON.stringify(menu)}`)
  const menuScreenshot = await captureViewport(client, `composer-persistent-goal-menu-${viewportName}.png`)
  const clicked = await evaluate(client, `(() => {
    const button = Array.from(document.querySelectorAll('.thread-composer-attach-item'))
      .find((entry) => entry.querySelector('.thread-composer-attach-item-title')?.textContent?.trim() === '设置持续目标');
    if (!(button instanceof HTMLButtonElement)) return false;
    button.click();
    return true;
  })()`)
  assert(clicked, `${viewportName} persistent goal action could not be activated`)
  await waitFor(client, `Boolean(document.querySelector('.thread-goal-editor textarea'))`, 3_000)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const after = await evaluate(client, `(() => ({
    attachMenuCount: document.querySelectorAll('.thread-composer-attach-menu').length,
    editorCount: document.querySelectorAll('.thread-goal-editor').length,
    editorFocused: document.activeElement === document.querySelector('.thread-goal-editor textarea'),
    standaloneCreateCount: document.querySelectorAll('.thread-goal-create').length,
    horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  }))()`)
  assert(after.attachMenuCount === 0 && after.editorCount === 1 && after.editorFocused, `${viewportName} plus menu did not hand focus to the persistent goal editor: ${JSON.stringify(after)}`)
  assert(after.standaloneCreateCount === 0 && after.horizontalOverflowPx <= 1, `${viewportName} persistent goal editor restored the standalone trigger or overflowed: ${JSON.stringify(after)}`)
  const editorScreenshot = await captureViewport(client, `composer-persistent-goal-editor-${viewportName}.png`)
  return { before, menu, after, menuScreenshot, editorScreenshot }
}

async function runComposerShell(client) {
  await configureViewport(client, 1440, 900, false)
  await navigate(client, composerUrl, `Boolean(document.querySelector('.composer-regression-fixture .thread-composer-shell'))`)
  const desktop = await readComposerMetrics(client)
  assertComposerMetrics(desktop, 'desktop', false)
  assert(Math.abs(desktop.shellWidth - 768) <= 1, `desktop composer shell must align to the 48rem transcript column: ${JSON.stringify(desktop)}`)
  const desktopFocus = await readComposerFocusMetrics(client)
  assert(desktopFocus?.boxShadow?.includes('1px'), `desktop composer focus state is not visible: ${JSON.stringify(desktopFocus)}`)
  const desktopAutoGrow = await probeComposerAutoGrow(client, 'desktop')
  const desktopImeAndDictation = await probeComposerImeAndDictation(client)
  const desktopEnter = await probeComposerEnterBehavior(client, 'desktop', true)
  const desktopPanels = await probeComposerPanels(client, 'desktop', false)
  const desktopScreenshot = await capture(client, 'composer-desktop.png', '.thread-composer-shell')
  const desktopGoal = await probePersistentGoalMenu(client, 'desktop', false)

  await configureViewport(client, 393, 852, true)
  await navigate(client, composerUrl, `Boolean(document.querySelector('.composer-regression-fixture .thread-composer-shell'))`)
  const mobile = await readComposerMetrics(client)
  assertComposerMetrics(mobile, 'mobile', true)
  const mobileAutoGrow = await probeComposerAutoGrow(client, 'mobile')
  const mobileImeAndDictation = await probeComposerImeAndDictation(client)
  const mobileEnter = await probeComposerEnterBehavior(client, 'mobile', false)
  const mobilePanels = await probeComposerPanels(client, 'mobile', true)
  const mobileScreenshot = await capture(client, 'composer-mobile.png', '.thread-composer-shell')
  const mobileGoal = await probePersistentGoalMenu(client, 'mobile', true)

  await configureViewport(client, 884, 1104, true)
  await navigate(client, composerUrl, `Boolean(document.querySelector('.composer-regression-fixture .thread-composer-shell'))`)
  const foldable = await readComposerMetrics(client)
  assertComposerMetrics(foldable, 'foldable', true)
  assert(Math.abs(foldable.shellWidth - 768) <= 1, `foldable composer shell must align to the 48rem transcript column: ${JSON.stringify(foldable)}`)
  const foldableScreenshot = await capture(client, 'composer-foldable.png', '.thread-composer-shell')
  const queueReorder = await probeQueueReorder(client)

  const browserErrors = summarizeBrowserErrors(client.events)
  assert(browserErrors.length === 0, `composer browser errors: ${JSON.stringify(browserErrors.slice(0, 12))}`)
  return {
    mode: 'composer',
    baseUrl,
    desktop: {
      ...desktop,
      focus: desktopFocus,
      autoGrow: desktopAutoGrow,
      imeAndDictation: desktopImeAndDictation,
      enter: desktopEnter,
      panels: desktopPanels,
      persistentGoal: desktopGoal,
    },
    mobile: {
      ...mobile,
      autoGrow: mobileAutoGrow,
      imeAndDictation: mobileImeAndDictation,
      enter: mobileEnter,
      panels: mobilePanels,
      persistentGoal: mobileGoal,
    },
    foldable,
    queueReorder,
    screenshots: [desktopScreenshot, desktopGoal.menuScreenshot, desktopGoal.editorScreenshot, mobileScreenshot, mobileGoal.menuScreenshot, mobileGoal.editorScreenshot, foldableScreenshot, queueReorder.screenshot],
  }
}

async function readShellMetrics(client) {
  return evaluate(client, `(() => {
    const root = document.documentElement;
    const layout = document.querySelector('.desktop-layout');
    const sidebar = document.querySelector('.desktop-sidebar');
    const main = document.querySelector('.desktop-main');
    const content = document.querySelector('.docs-content');
    const header = document.querySelector('.content-header');
    const headerMain = document.querySelector('.content-header-main');
    const title = document.querySelector('.content-title');
    const subtitle = document.querySelector('.content-header-subtitle');
    const status = document.querySelector('.docs-status');
    const composer = document.querySelector('.thread-composer-shell');
    const userMessage = document.querySelector('.user-message');
    const actionGrid = document.querySelector('.docs-sidebar-actions');
    const actionButtons = Array.from(actionGrid?.querySelectorAll('button') || []);
    const primaryAction = actionGrid?.querySelector('.docs-sidebar-action-primary');
    const rect = (element) => {
      const value = element?.getBoundingClientRect();
      return value ? {
        left: Math.round(value.left),
        top: Math.round(value.top),
        right: Math.round(value.right),
        bottom: Math.round(value.bottom),
        width: Math.round(value.width),
        height: Math.round(value.height),
      } : null;
    };
    const headerRect = rect(header);
    const headerMainRect = rect(headerMain);
    const composerRect = rect(composer);
    const actionGridRect = rect(actionGrid);
    const actionButtonRects = actionButtons.map((element) => rect(element)).filter(Boolean);
    const secondaryActionRects = actionButtons.filter((element) => element !== primaryAction).map((element) => rect(element)).filter(Boolean);
    const visibleHeaderItems = [title, subtitle, status]
      .filter((element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const value = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && value.width > 0 && value.height > 0;
      });
    return {
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      layout: rect(layout),
      sidebar: rect(sidebar),
      main: rect(main),
      header: headerRect,
      headerMain: headerMainRect,
      title: rect(title),
      subtitle: rect(subtitle),
      status: rect(status),
      composer: composerRect,
      headerComposerAxisDelta: headerMainRect && composerRect ? Math.abs(headerMainRect.left - composerRect.left) : null,
      headerItemsInside: Boolean(headerRect) && visibleHeaderItems.every((element) => {
        const value = element.getBoundingClientRect();
        return value.top >= headerRect.top - 1 && value.bottom <= headerRect.bottom + 1;
      }),
      horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
      bodyOverflowX: getComputedStyle(document.body).overflowX,
      contentBackground: content ? getComputedStyle(content).backgroundColor : '',
      userMessageBackground: userMessage ? getComputedStyle(userMessage).backgroundColor : '',
      userMessageColor: userMessage ? getComputedStyle(userMessage).color : '',
      actionGrid: actionGridRect,
      actionGridColumns: actionGrid ? getComputedStyle(actionGrid).gridTemplateColumns : '',
      actionGridRowCount: new Set(actionButtonRects.map((value) => value.top)).size,
      actionButtonCount: actionButtonRects.length,
      actionButtonMinHeight: actionButtonRects.length ? Math.min(...actionButtonRects.map((value) => value.height)) : 0,
      actionButtonMaxHeight: actionButtonRects.length ? Math.max(...actionButtonRects.map((value) => value.height)) : 0,
      primaryAction: rect(primaryAction),
      primaryActionBackground: primaryAction ? getComputedStyle(primaryAction).backgroundColor : '',
      primaryActionColor: primaryAction ? getComputedStyle(primaryAction).color : '',
      primaryMatchesSecondaryAxis: Boolean(primaryAction && secondaryActionRects.length > 0) && (() => {
        const primary = primaryAction.getBoundingClientRect();
        const left = Math.min(...secondaryActionRects.map((value) => value.left));
        const right = Math.max(...secondaryActionRects.map((value) => value.right));
        return Math.abs(primary.left - left) <= 1 && Math.abs(primary.right - right) <= 1;
      })(),
      storedSidebarWidth: localStorage.getItem('codex-web-local.sidebar-width.v1'),
      dark: document.documentElement.classList.contains('dark'),
    };
  })()`)
}

function assertShellMetrics(metrics, viewportName, expectedSidebarWidth = null) {
  assert(metrics.layout && metrics.main && metrics.header && metrics.headerMain && metrics.composer, `${viewportName} shell did not mount: ${JSON.stringify(metrics)}`)
  assert(metrics.header.height === 44, `${viewportName} header is ${metrics.header.height}px instead of 44px: ${JSON.stringify(metrics)}`)
  assert(metrics.headerItemsInside, `${viewportName} header content wrapped outside the single row: ${JSON.stringify(metrics)}`)
  assert(metrics.horizontalOverflowPx <= 1, `${viewportName} shell overflowed horizontally by ${metrics.horizontalOverflowPx}px`)
  if (expectedSidebarWidth !== null) {
    assert(metrics.sidebar?.width === expectedSidebarWidth, `${viewportName} sidebar is ${metrics.sidebar?.width ?? 0}px instead of ${expectedSidebarWidth}px`)
    assert(Math.abs(metrics.headerMain.width - 768) <= 1, `${viewportName} header axis is ${metrics.headerMain.width}px instead of 48rem: ${JSON.stringify(metrics)}`)
    assert(Math.abs(metrics.composer.width - 768) <= 1, `${viewportName} composer axis is ${metrics.composer.width}px instead of 48rem: ${JSON.stringify(metrics)}`)
    assert(metrics.headerComposerAxisDelta <= 1, `${viewportName} header and composer axes differ by ${metrics.headerComposerAxisDelta}px: ${JSON.stringify(metrics)}`)
    assert(metrics.actionGridRowCount === 2, `${viewportName} sidebar actions must use one primary row and one secondary row: ${JSON.stringify(metrics)}`)
    assert(metrics.actionButtonCount === 4 && metrics.primaryMatchesSecondaryAxis, `${viewportName} sidebar action hierarchy drifted: ${JSON.stringify(metrics)}`)
    assert(metrics.actionButtonMinHeight >= 32 && metrics.actionButtonMaxHeight <= 44, `${viewportName} sidebar action density drifted: ${JSON.stringify(metrics)}`)
  } else {
    assert(metrics.sidebar === null, `${viewportName} unexpectedly retained a fixed sidebar: ${JSON.stringify(metrics)}`)
    assert(metrics.composer.right <= metrics.viewportWidth + 1, `${viewportName} composer extends beyond the viewport: ${JSON.stringify(metrics)}`)
  }
}

async function runQuietShell(client) {
  await configureViewport(client, 1440, 900, false)
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content .content-header') && document.querySelector('.thread-composer-shell'))`)
  await evaluate(client, `localStorage.removeItem('codex-web-local.sidebar-width.v1')`)
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content .content-header') && document.querySelector('.thread-composer-shell'))`)
  const desktop = await readShellMetrics(client)
  assertShellMetrics(desktop, 'desktop shell', 288)
  await evaluate(client, `(() => {
    const status = document.querySelector('.docs-status');
    if (!status) return false;
    status.textContent = '正在重新连接，等待恢复';
    return true;
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 80))
  const statusChangedDesktop = await readShellMetrics(client)
  assertShellMetrics(statusChangedDesktop, 'desktop shell with changed status', 288)
  assert(
    statusChangedDesktop.title?.left === desktop.title?.left
      && statusChangedDesktop.headerMain?.left === desktop.headerMain?.left
      && statusChangedDesktop.headerMain?.width === desktop.headerMain?.width,
    `desktop header shifted when status text changed: ${JSON.stringify({ desktop, statusChangedDesktop })}`,
  )
  await evaluate(client, `(() => {
    const status = document.querySelector('.docs-status');
    if (!status) return false;
    status.textContent = '同步正常';
    return true;
  })()`)
  const lightDesktopScreenshot = await captureViewport(client, 'shell-light-desktop.png')

  await evaluate(client, `localStorage.setItem('codex-web-local.sidebar-width.v1', '340')`)
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content .content-header') && document.querySelector('.thread-composer-shell'))`)
  const preservedDesktopPreference = await readShellMetrics(client)
  assertShellMetrics(preservedDesktopPreference, 'desktop shell with saved preference', 340)

  await evaluate(client, `localStorage.removeItem('codex-web-local.sidebar-width.v1')`)
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content .content-header') && document.querySelector('.thread-composer-shell'))`)

  await evaluate(client, `document.documentElement.classList.add('dark')`)
  await new Promise((resolve) => setTimeout(resolve, 80))
  const darkDesktop = await readShellMetrics(client)
  assert(darkDesktop.dark, 'desktop dark theme did not apply')
  assert(darkDesktop.contentBackground !== 'rgb(255, 255, 255)', `desktop dark content stayed light: ${JSON.stringify(darkDesktop)}`)
  assert(darkDesktop.userMessageBackground !== 'rgb(248, 248, 247)', `desktop dark user message stayed light: ${JSON.stringify(darkDesktop)}`)
  assertShellMetrics(darkDesktop, 'dark desktop shell', 288)
  assert(
    darkDesktop.primaryActionBackground === 'rgb(39, 39, 42)'
      && darkDesktop.primaryActionColor === 'rgb(244, 244, 245)',
    `desktop dark primary sidebar action lost contrast: ${JSON.stringify(darkDesktop)}`,
  )
  const darkDesktopScreenshot = await captureViewport(client, 'shell-dark-desktop.png')

  await configureViewport(client, 393, 852, true)
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content .content-header') && document.querySelector('.thread-composer-shell'))`)
  const mobile = await readShellMetrics(client)
  assertShellMetrics(mobile, 'phone shell')
  const lightMobileScreenshot = await captureViewport(client, 'shell-light-phone.png')

  await evaluate(client, `document.documentElement.classList.add('dark')`)
  await new Promise((resolve) => setTimeout(resolve, 80))
  const darkMobile = await readShellMetrics(client)
  assert(darkMobile.dark, 'phone dark theme did not apply')
  assert(darkMobile.contentBackground !== 'rgb(255, 255, 255)', `phone dark content stayed light: ${JSON.stringify(darkMobile)}`)
  assert(darkMobile.userMessageBackground !== 'rgb(248, 248, 247)', `phone dark user message stayed light: ${JSON.stringify(darkMobile)}`)
  assertShellMetrics(darkMobile, 'dark phone shell')
  const darkMobileScreenshot = await captureViewport(client, 'shell-dark-phone.png')

  await configureViewport(client, 852, 393, true)
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content .content-header') && document.querySelector('.thread-composer-shell'))`)
  const phoneLandscape = await readShellMetrics(client)
  assertShellMetrics(phoneLandscape, 'phone landscape shell')

  const browserErrors = summarizeBrowserErrors(client.events)
  assert(browserErrors.length === 0, `shell browser errors: ${JSON.stringify(browserErrors.slice(0, 12))}`)
  return {
    mode: 'shell',
    baseUrl,
    desktop,
    statusChangedDesktop,
    preservedDesktopPreference,
    darkDesktop,
    mobile,
    darkMobile,
    phoneLandscape,
    screenshots: [lightDesktopScreenshot, darkDesktopScreenshot, lightMobileScreenshot, darkMobileScreenshot],
  }
}

async function readHardeningMetrics(client) {
  return evaluate(client, `(() => {
    const root = document.documentElement;
    const interactiveSelector = 'a[href], button, input, select, textarea, summary, [role="button"], [role="menuitem"], [role="option"], [tabindex]:not([tabindex="-1"])';
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const accessibleName = (element) => {
      const direct = element.getAttribute('aria-label')?.trim();
      if (direct) return direct;
      const labelledBy = element.getAttribute('aria-labelledby')?.trim();
      if (labelledBy) {
        const text = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent?.trim() || '').filter(Boolean).join(' ');
        if (text) return text;
      }
      const alt = element.getAttribute('alt')?.trim();
      if (alt) return alt;
      const title = element.getAttribute('title')?.trim();
      if (title) return title;
      const text = element.innerText?.trim().replace(/\\s+/g, ' ');
      if (text) return text;
      const placeholder = element.getAttribute('placeholder')?.trim();
      if (placeholder) return placeholder;
      return '';
    };
    const describe = (element) => ({
      tag: element.tagName.toLowerCase(),
      className: typeof element.className === 'string' ? element.className : '',
      role: element.getAttribute('role') || '',
      name: accessibleName(element),
    });
    const interactive = Array.from(document.querySelectorAll(interactiveSelector)).filter(isVisible);
    const missingAccessibleNames = interactive.filter((element) => !accessibleName(element)).map(describe).slice(0, 20);
    const iconOnlyTargets = interactive.filter((element) => {
      const tagOrRole = element.tagName === 'BUTTON' || element.getAttribute('role') === 'button';
      return tagOrRole && !element.innerText?.trim() && Boolean(accessibleName(element));
    }).map((element) => {
      const rect = element.getBoundingClientRect();
      const ownsPoint = (x, y) => {
        const hit = document.elementFromPoint(x, y);
        return hit === element || Boolean(hit && element.contains(hit));
      };
      const centerX = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
      const centerY = Math.min(innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height, innerHeight) / 2));
      let hitLeft = Math.max(0, rect.left);
      let hitRight = Math.min(innerWidth, rect.right);
      let hitTop = Math.max(0, rect.top);
      let hitBottom = Math.min(innerHeight, rect.bottom);
      while (hitLeft > 0 && ownsPoint(hitLeft - 1, centerY)) hitLeft -= 1;
      while (hitRight < innerWidth && ownsPoint(hitRight, centerY)) hitRight += 1;
      while (hitTop > 0 && ownsPoint(centerX, hitTop - 1)) hitTop -= 1;
      while (hitBottom < innerHeight && ownsPoint(centerX, hitBottom)) hitBottom += 1;
      return {
        ...describe(element),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        hitWidth: Math.round(hitRight - hitLeft),
        hitHeight: Math.round(hitBottom - hitTop),
      };
    });
    const hiddenHitTargets = interactive.filter((element) => {
      const style = getComputedStyle(element);
      return Number.parseFloat(style.opacity || '1') <= 0.01 && style.pointerEvents !== 'none';
    }).map(describe).slice(0, 20);
    const duplicateIds = Array.from(document.querySelectorAll('[id]')).reduce((duplicates, element, index, elements) => {
      const id = element.id;
      if (id && elements.findIndex((candidate) => candidate.id === id) !== index && !duplicates.includes(id)) duplicates.push(id);
      return duplicates;
    }, []);
    const colorCanvas = document.createElement('canvas');
    colorCanvas.width = 1;
    colorCanvas.height = 1;
    const colorContext = colorCanvas.getContext('2d', { willReadFrequently: true });
    const parseColor = (value) => {
      if (!colorContext || !value) return null;
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = 'rgba(0, 0, 0, 0)';
      colorContext.fillStyle = value;
      colorContext.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a: alpha / 255 };
    };
    const resolveBackground = (element) => {
      let current = element;
      while (current) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color && color.a > 0.01) return color;
        current = current.parentElement;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
    };
    const luminance = (color) => 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    const ratio = (foreground, background) => {
      const lighter = Math.max(luminance(foreground), luminance(background));
      const darker = Math.min(luminance(foreground), luminance(background));
      return (lighter + 0.05) / (darker + 0.05);
    };
    const contrastDefinitions = [
      ['title', '.content-title'],
      ['subtitle', '.content-header p'],
      ['status', '.docs-status'],
      ['thread-title', '.thread-row-title'],
      ['thread-preview', '.thread-row-preview'],
      ['thread-time', '.thread-row-time'],
      ['user-message', '.user-message'],
      ['final-answer', '.final-answer'],
      ['composer-placeholder', '.thread-composer-input', '::placeholder'],
    ];
    const contrastSamples = contrastDefinitions.flatMap(([name, selector, pseudo]) => {
      const element = document.querySelector(selector);
      if (!element || !isVisible(element)) return [];
      const style = getComputedStyle(element, pseudo || null);
      const foreground = parseColor(style.color);
      const background = resolveBackground(element);
      if (!foreground || foreground.a <= 0.01) return [];
      return [{ name, foreground: style.color, background: 'rgb(' + background.r + ', ' + background.g + ', ' + background.b + ')', ratio: Math.round(ratio(foreground, background) * 100) / 100 }];
    });
    const mains = Array.from(document.querySelectorAll('main, [role="main"]')).filter(isVisible);
    const navigations = Array.from(document.querySelectorAll('nav, [role="navigation"]')).filter(isVisible);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      horizontalOverflowPx: Math.max(0, root.scrollWidth - root.clientWidth),
      mainCount: mains.length,
      mainNames: mains.map(accessibleName),
      navigationCount: navigations.length,
      unnamedNavigations: navigations.filter((element) => !accessibleName(element)).map(describe),
      missingAccessibleNames,
      iconOnlyTargets,
      undersizedIconOnlyTargets: matchMedia('(pointer: coarse)').matches
        ? iconOnlyTargets.filter((target) => target.hitWidth < 44 || target.hitHeight < 44)
        : [],
      hiddenHitTargets,
      duplicateIds,
      contrastSamples,
      lowContrastSamples: contrastSamples.filter((sample) => sample.ratio < 4.5),
      statusText: document.querySelector('.docs-status')?.textContent?.trim().replace(/\\s+/g, ' ') || '',
      dark: root.classList.contains('dark'),
      coarsePointer: matchMedia('(pointer: coarse)').matches,
    };
  })()`)
}

function assertHardeningMetrics(metrics, viewportName, theme) {
  assert(metrics.horizontalOverflowPx <= 1, `${viewportName} ${theme} overflowed horizontally by ${metrics.horizontalOverflowPx}px`)
  assert(metrics.mainCount === 1 && metrics.mainNames[0] === '会话内容', `${viewportName} ${theme} main landmark drifted: ${JSON.stringify(metrics)}`)
  assert(metrics.unnamedNavigations.length === 0, `${viewportName} ${theme} has unnamed navigation landmarks: ${JSON.stringify(metrics.unnamedNavigations)}`)
  assert(metrics.missingAccessibleNames.length === 0, `${viewportName} ${theme} has unnamed interactive controls: ${JSON.stringify(metrics.missingAccessibleNames)}`)
  assert(metrics.hiddenHitTargets.length === 0, `${viewportName} ${theme} has visually hidden hit targets: ${JSON.stringify(metrics.hiddenHitTargets)}`)
  assert(metrics.duplicateIds.length === 0, `${viewportName} ${theme} has duplicate ids: ${JSON.stringify(metrics.duplicateIds)}`)
  assert(metrics.statusText.includes('同步正常'), `${viewportName} ${theme} status relies on color alone: ${JSON.stringify(metrics)}`)
  assert(metrics.lowContrastSamples.length === 0, `${viewportName} ${theme} has WCAG AA text contrast failures: ${JSON.stringify(metrics.lowContrastSamples)}`)
  assert(metrics.undersizedIconOnlyTargets.length === 0, `${viewportName} ${theme} has icon-only coarse targets below 44px: ${JSON.stringify(metrics.undersizedIconOnlyTargets)}`)
}

async function verifyForcedColors(client) {
  await configureViewport(client, 1440, 900, false)
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content .content-header') && document.querySelector('.desktop-resize-handle'))`)
  await client.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'forced-colors', value: 'active' },
      { name: 'prefers-color-scheme', value: 'light' },
    ],
  })
  await new Promise((resolve) => setTimeout(resolve, 100))
  await evaluate(client, `document.querySelector('.docs-sidebar-settings')?.focus({ preventScroll: true })`)
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await new Promise((resolve) => setTimeout(resolve, 80))
  const metrics = await evaluate(client, `(() => {
    const handle = document.querySelector('.desktop-resize-handle');
    const style = handle ? getComputedStyle(handle) : null;
    const before = handle ? getComputedStyle(handle, '::before') : null;
    return {
      active: matchMedia('(forced-colors: active)').matches,
      focused: document.activeElement === handle,
      outlineStyle: style?.outlineStyle || '',
      outlineWidth: Number.parseFloat(style?.outlineWidth || '0'),
      outlineColor: style?.outlineColor || '',
      railColor: before?.backgroundColor || '',
    };
  })()`)
  assert(metrics.active, `forced-colors emulation did not activate: ${JSON.stringify(metrics)}`)
  assert(metrics.focused, `forced-colors focus target was not focused: ${JSON.stringify(metrics)}`)
  assert(metrics.outlineStyle !== 'none' && metrics.outlineWidth >= 1, `forced-colors focus indicator is missing: ${JSON.stringify(metrics)}`)
  const screenshot = await captureViewport(client, 'hardening-forced-colors-desktop.png')
  await client.send('Emulation.setEmulatedMedia', { features: [] })
  return { ...metrics, screenshot }
}

async function verifyMobileDrawerEnvironment(client) {
  await configureViewport(client, 393, 852, true)
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-mobile-menu'))`)
  const opened = await evaluate(client, `(() => {
    const opener = document.querySelector('.docs-mobile-menu');
    if (!(opener instanceof HTMLButtonElement)) return false;
    opener.focus({ preventScroll: true });
    opener.click();
    return true;
  })()`)
  assert(opened, 'mobile drawer opener is not operable')
  await waitFor(client, `Boolean(document.querySelector('.mobile-drawer'))`)
  await new Promise((resolve) => setTimeout(resolve, 120))
  const environment = await evaluate(client, `(() => {
    const panel = document.querySelector('.mobile-drawer');
    const backdrop = document.querySelector('.mobile-drawer-backdrop');
    const bodyChildren = Array.from(document.body.children).filter((element) => element instanceof HTMLElement);
    return {
      dialogRole: panel?.getAttribute('role') || '',
      modal: panel?.getAttribute('aria-modal') || '',
      name: panel?.getAttribute('aria-label') || '',
      focusInside: Boolean(panel && panel.contains(document.activeElement)),
      rootOverflow: document.documentElement.style.overflow,
      inertOutsideCount: bodyChildren.filter((element) => element !== backdrop && element.inert).length,
      nonInertOutsideCount: bodyChildren.filter((element) => element !== backdrop && !element.inert).length,
    };
  })()`)
  assert(environment.dialogRole === 'dialog' && environment.modal === 'true' && environment.name === '会话导航', `mobile drawer semantics drifted: ${JSON.stringify(environment)}`)
  assert(environment.focusInside && environment.rootOverflow === 'hidden', `mobile drawer did not own focus or scrolling: ${JSON.stringify(environment)}`)
  assert(environment.inertOutsideCount >= 1 && environment.nonInertOutsideCount === 0, `mobile drawer background is not inert: ${JSON.stringify(environment)}`)

  const focusContainment = await evaluate(client, `(async () => {
    const panel = document.querySelector('.mobile-drawer');
    if (!(panel instanceof HTMLElement)) return null;
    const focusable = Array.from(panel.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter((element) => element.getClientRects().length > 0 && element.getAttribute('aria-hidden') !== 'true');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first?.focus();
    first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    const wrapsBackward = document.activeElement === last;
    last?.focus();
    last?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    const wrapsForward = document.activeElement === first;
    const backgroundOpener = document.querySelector('.docs-mobile-menu');
    backgroundOpener?.focus();
    await Promise.resolve();
    const backgroundCannotTakeFocus = panel.contains(document.activeElement);
    return { focusableCount: focusable.length, wrapsBackward, wrapsForward, backgroundCannotTakeFocus };
  })()`)
  assert(focusContainment?.focusableCount >= 2 && focusContainment.wrapsBackward && focusContainment.wrapsForward && focusContainment.backgroundCannotTakeFocus, `mobile drawer focus containment failed: ${JSON.stringify(focusContainment)}`)
  const screenshot = await captureViewport(client, 'hardening-mobile-drawer.png')

  await evaluate(client, `document.querySelector('.mobile-drawer-backdrop')?.click()`)
  await waitFor(client, `!document.querySelector('.mobile-drawer')`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const released = await evaluate(client, `(() => ({
    rootOverflow: document.documentElement.style.overflow,
    inertCount: Array.from(document.body.children).filter((element) => element instanceof HTMLElement && element.inert).length,
    focusReturned: document.activeElement === document.querySelector('.docs-mobile-menu'),
  }))()`)
  assert(released.rootOverflow !== 'hidden' && released.inertCount === 0 && released.focusReturned, `mobile drawer did not release its environment: ${JSON.stringify(released)}`)
  await client.send('Emulation.setEmulatedMedia', { features: [] })
  return { environment, focusContainment, released, screenshot }
}

async function verifyReducedMotionHardening(client) {
  await configureViewport(client, 393, 852, true)
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content'))`)
  const metrics = await evaluate(client, `(() => {
    const animated = Array.from(document.querySelectorAll('*')).filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.animationName !== 'none' && style.animationIterationCount === 'infinite';
    }).map((element) => ({ tag: element.tagName.toLowerCase(), className: typeof element.className === 'string' ? element.className : '', animationName: getComputedStyle(element).animationName }));
    return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, continuousAnimations: animated.slice(0, 20) };
  })()`)
  assert(metrics.reduced && metrics.continuousAnimations.length === 0, `reduced motion kept continuous decorative animation: ${JSON.stringify(metrics)}`)
  await client.send('Emulation.setEmulatedMedia', { features: [] })
  return metrics
}

async function runHardening(client) {
  const viewports = [
    { name: 'desktop', width: 1440, height: 900, mobile: false },
    { name: 'foldable', width: 884, height: 1104, mobile: true },
    { name: 'tablet', width: 768, height: 1024, mobile: true },
    { name: 'phone', width: 393, height: 852, mobile: true },
    { name: 'phone-landscape', width: 852, height: 393, mobile: true },
  ]
  const cases = []
  const screenshots = []
  await client.send('Emulation.setEmulatedMedia', { features: [] })
  for (const viewport of viewports) {
    for (const theme of ['light', 'dark']) {
      await configureViewport(client, viewport.width, viewport.height, viewport.mobile)
      await navigate(client, shellUrl, `Boolean(document.querySelector('.docs-content .content-header') && document.querySelector('.thread-composer-shell'))`)
      await evaluate(client, `document.documentElement.classList.toggle('dark', ${String(theme === 'dark')})`)
      await new Promise((resolve) => setTimeout(resolve, 260))
      const metrics = await readHardeningMetrics(client)
      assert(metrics.dark === (theme === 'dark'), `${viewport.name} ${theme} theme did not apply: ${JSON.stringify(metrics)}`)
      assertHardeningMetrics(metrics, viewport.name, theme)
      cases.push({ viewport: viewport.name, theme, metrics })
      if (theme === 'light' || viewport.name === 'desktop' || viewport.name === 'phone') {
        screenshots.push(await captureViewport(client, `hardening-${theme}-${viewport.name}.png`))
      }
    }
  }
  const forcedColors = await verifyForcedColors(client)
  const mobileDrawer = await verifyMobileDrawerEnvironment(client)
  const reducedMotion = await verifyReducedMotionHardening(client)
  const browserErrors = summarizeBrowserErrors(client.events)
  assert(browserErrors.length === 0, `hardening browser errors: ${JSON.stringify(browserErrors.slice(0, 12))}`)
  return { mode: 'hardening', baseUrl, cases, forcedColors, mobileDrawer, reducedMotion, screenshots: [...screenshots, forcedColors.screenshot, mobileDrawer.screenshot] }
}

async function runContractBaseline(client) {
  const viewports = [
    { name: 'desktop', width: 1440, height: 900, mobile: false },
    { name: 'foldable', width: 884, height: 1104, mobile: true },
    { name: 'tablet', width: 768, height: 1024, mobile: true },
    { name: 'phone', width: 393, height: 852, mobile: true },
    { name: 'phone-landscape', width: 852, height: 393, mobile: true },
  ]
  const cases = []
  const screenshots = []

  for (const viewport of viewports) {
    await configureViewport(client, viewport.width, viewport.height, viewport.mobile)
    await navigate(
      client,
      homeUrl,
      `Boolean(document.querySelector('.new-thread-empty .new-thread-hero') && document.querySelector('.thread-composer-shell'))`,
    )
    const home = await evaluate(client, `(() => ({
      mainLandmarkCount: document.querySelectorAll('main, [role="main"]').length,
      hero: document.querySelector('.new-thread-hero')?.textContent?.trim() || '',
      folderSelectorPresent: Boolean(document.querySelector('.new-thread-folder-dropdown')),
      composerPresent: Boolean(document.querySelector('.thread-composer-shell')),
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    }))()`)
    assert(home.mainLandmarkCount === 1, `${viewport.name} home must expose one main landmark: ${JSON.stringify(home)}`)
    assert(home.hero === '开始任务' && home.folderSelectorPresent && home.composerPresent, `${viewport.name} home baseline is incomplete: ${JSON.stringify(home)}`)
    assert(home.horizontalOverflowPx <= 1, `${viewport.name} home overflowed horizontally by ${home.horizontalOverflowPx}px`)
    const homeScreenshot = await captureViewport(client, `contract-home-${viewport.name}.png`)
    const homeBrowserErrors = summarizeBrowserErrors(client.events)
    client.events.length = 0

    await navigate(client, fixtureUrl)
    const conversation = await readMetrics(client)
    const completedTurnCount = Math.max(0, conversation.turnCount - conversation.activeTurnCount)
    assert(conversation.activeTurnCount >= 1 && conversation.liveStateCount >= 1, `${viewport.name} running baseline is missing: ${JSON.stringify(conversation)}`)
    assert(completedTurnCount >= 1 && conversation.finalCount === 1, `${viewport.name} completed baseline is missing: ${JSON.stringify(conversation)}`)
    assert(conversation.userInputSelectCount === 1 && conversation.userInputSelectedText === '请选择', `${viewport.name} waiting-input baseline is missing: ${JSON.stringify(conversation)}`)
    assert(conversation.horizontalOverflowPx <= 1, `${viewport.name} conversation baseline overflowed horizontally by ${conversation.horizontalOverflowPx}px`)
    const runningScreenshot = await capture(client, `contract-running-${viewport.name}.png`, '.turn-shell.is-active .turn-live-state')
    const completedScreenshot = await capture(client, `contract-completed-${viewport.name}.png`, '.final-answer')
    const waitingScreenshot = await capture(client, `contract-waiting-${viewport.name}.png`, '.request-card[data-interaction-type="user-input"]')
    const conversationBrowserErrors = summarizeBrowserErrors(client.events)
    assert(conversationBrowserErrors.length === 0, `${viewport.name} conversation baseline browser errors: ${JSON.stringify(conversationBrowserErrors.slice(0, 12))}`)
    client.events.length = 0

    screenshots.push(homeScreenshot, runningScreenshot, completedScreenshot, waitingScreenshot)
    cases.push({
      viewport: viewport.name,
      width: viewport.width,
      height: viewport.height,
      home,
      homeBrowserErrorKinds: [...new Set(homeBrowserErrors.map((error) => `${error.kind}:${error.status ?? ''}`))],
      conversation: {
        turnCount: conversation.turnCount,
        activeTurnCount: conversation.activeTurnCount,
        completedTurnCount,
        finalCount: conversation.finalCount,
        waitingInputCount: conversation.userInputSelectCount,
        requestCardCount: conversation.requestCardCount,
        horizontalOverflowPx: conversation.horizontalOverflowPx,
      },
      screenshots: [homeScreenshot, runningScreenshot, completedScreenshot, waitingScreenshot],
    })
  }

  const report = {
    mode: 'contract',
    baseUrl,
    note: 'Current-candidate UX-00 contract baseline; historical pre-rebuild screenshots remain separate evidence.',
    cases,
    screenshots,
  }
  await fs.writeFile(path.join(outputDir, 'contract-baseline.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}

async function readSidebarFixtureState(client) {
  return evaluate(client, `(() => {
    const rows = Array.from(document.querySelectorAll('.sidebar-regression-fixture .thread-row'));
    const projects = Array.from(document.querySelectorAll('.sidebar-regression-fixture .project-group'));
    const rowRects = rows.map((row) => row.getBoundingClientRect());
    const threadIds = rows.map((row) => row.getAttribute('data-thread-id') || '');
    const projectThreadIds = Array.from(document.querySelectorAll('.sidebar-regression-fixture .project-group .thread-row'))
      .map((row) => row.getAttribute('data-thread-id') || '');
    return {
      rowCount: rows.length,
      projectOrder: projects.map((project) => project.getAttribute('data-project-name') || ''),
      pinnedProjectCount: projects.filter((project) => project.getAttribute('data-pinned-project') === 'true').length,
      directoryTitle: document.querySelector('.thread-tree-header')?.textContent?.trim() || '',
      directorySubtitle: document.querySelector('.thread-tree-header-subtitle')?.textContent?.trim() || '',
      threadIds,
      projectThreadIds,
      pinnedThreadIds: Array.from(document.querySelectorAll('.pinned-section .thread-row'))
        .map((row) => row.getAttribute('data-thread-id') || ''),
      waitingLabelCount: rows.filter((row) => (
        row.getAttribute('data-thread-id') === 'fixture-thread-waiting'
          && row.querySelector('.thread-row-source')?.textContent?.trim() === '等待处理'
      )).length,
      waitingRowCount: threadIds.filter((id) => id === 'fixture-thread-waiting').length,
      minimumRowHeight: rowRects.length ? Math.min(...rowRects.map((rect) => rect.height)) : 0,
      maximumRowHeight: rowRects.length ? Math.max(...rowRects.map((rect) => rect.height)) : 0,
      maximumRowRadius: rows.length ? Math.max(...rows.map((row) => Number.parseFloat(getComputedStyle(row).borderTopLeftRadius || '0'))) : 0,
      showMoreText: document.querySelector('.thread-show-more-button')?.textContent?.trim() || '',
      horizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  })()`)
}

async function runSidebarRegression(client) {
  const fixtureBaseUrl = `${baseUrl}/#/__regression/sidebar-rows?regression=frontend`
  const ready = `Boolean(document.querySelector('.sidebar-regression-fixture .sidebar-regression-tree'))`
  await configureViewport(client, 393, 852, true)
  await navigate(client, fixtureBaseUrl, ready)
  const baseline = await readSidebarFixtureState(client)
  assert(baseline.rowCount >= 4, `sidebar fixture is missing rows: ${JSON.stringify(baseline)}`)
  assert(
    baseline.projectOrder[0] === 'E:/workspace/CXCodex/playground'
      && baseline.projectOrder[1] === 'E:/workspace/CXCodex/codexui'
      && baseline.projectOrder[2] === 'empty-root',
    `sidebar project order drifted: ${JSON.stringify(baseline)}`,
  )
  assert(baseline.pinnedProjectCount === 1, `sidebar pinned-project metadata drifted: ${JSON.stringify(baseline)}`)
  assert(baseline.directoryTitle === '目录' && baseline.directorySubtitle === '最近会话优先', `sidebar hierarchy labels drifted: ${JSON.stringify(baseline)}`)
  assert(
    baseline.pinnedThreadIds.join(',') === 'fixture-thread-running,fixture-thread-unread'
      && baseline.threadIds.filter((id) => id === 'fixture-thread-running').length === 2,
    `sidebar pinned shortcut contract drifted: ${JSON.stringify(baseline)}`,
  )
  assert(baseline.waitingRowCount > 0 && baseline.waitingLabelCount === baseline.waitingRowCount, `sidebar waiting state lost text feedback: ${JSON.stringify(baseline)}`)
  assert(baseline.minimumRowHeight >= 44 && baseline.maximumRowHeight <= 60 && baseline.maximumRowRadius <= 10, `sidebar touch row density drifted: ${JSON.stringify(baseline)}`)
  assert(baseline.showMoreText === '显示更多 3 条' && baseline.horizontalOverflowPx <= 1, `sidebar preview or overflow contract drifted: ${JSON.stringify(baseline)}`)

  const menuSelector = '.project-group[data-project-name="empty-root"] .project-menu-trigger'
  const menuPoint = await clickBrowserElement(client, menuSelector)
  await new Promise((resolve) => setTimeout(resolve, 180))
  const menu = await evaluate(client, `(() => {
    const panel = document.querySelector('.project-menu-panel');
    const rect = panel?.getBoundingClientRect();
    return {
      expandedTriggerCount: document.querySelectorAll('.project-menu-trigger[aria-expanded="true"]').length,
      triggerState: (() => {
        const trigger = document.querySelector('.project-group[data-project-name="empty-root"] .project-menu-trigger');
        const rect = trigger?.getBoundingClientRect();
        return trigger && rect ? {
          disabled: trigger.disabled,
          ariaExpanded: trigger.getAttribute('aria-expanded'),
          pointerEvents: getComputedStyle(trigger).pointerEvents,
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        } : null;
      })(),
      menuCount: document.querySelectorAll('.project-menu-panel').length,
      newThreadActionCount: Array.from(document.querySelectorAll('.project-menu-panel .project-menu-item'))
        .filter((node) => node.textContent?.trim() === '新建任务').length,
      fitsViewport: Boolean(rect) && rect.left >= 7 && rect.top >= 7
        && rect.right <= document.documentElement.clientWidth - 7
        && rect.bottom <= document.documentElement.clientHeight - 7,
    };
  })()`)
  assert(menu.expandedTriggerCount === 1 && menu.menuCount === 1 && menu.newThreadActionCount === 1 && menu.fitsViewport, `sidebar project menu drifted: ${JSON.stringify({ menuPoint, menu })}`)
  await evaluate(client, `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`)

  await navigate(client, `${fixtureBaseUrl}&staleSearch=1`, ready)
  const staleSearch = await readSidebarFixtureState(client)
  assert(staleSearch.projectThreadIds.includes('fixture-thread-unread') && staleSearch.projectThreadIds.includes('fixture-thread-six'), `sidebar stale-search merge drifted: ${JSON.stringify(staleSearch)}`)

  await navigate(client, `${fixtureBaseUrl}&searchContinuity=1`, ready)
  const heldSearch = await readSidebarFixtureState(client)
  assert(heldSearch.projectThreadIds.includes('fixture-thread-unread') && heldSearch.projectThreadIds.includes('fixture-thread-six'), `sidebar prefix result was not held: ${JSON.stringify(heldSearch)}`)
  await evaluate(client, `document.querySelector('[data-regression-action="diverge-search-query"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const divergedSearch = await readSidebarFixtureState(client)
  assert(!divergedSearch.projectThreadIds.includes('fixture-thread-unread') && divergedSearch.projectThreadIds.includes('fixture-thread-idle'), `sidebar diverged search kept stale results: ${JSON.stringify(divergedSearch)}`)
  await evaluate(client, `document.querySelector('[data-regression-action="restore-search-prefix"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  const restoredSearch = await readSidebarFixtureState(client)
  assert(restoredSearch.projectThreadIds.includes('fixture-thread-unread') && restoredSearch.projectThreadIds.includes('fixture-thread-six'), `sidebar prefix result did not restore: ${JSON.stringify(restoredSearch)}`)

  await navigate(client, `${fixtureBaseUrl}&scrollAnchor=1`, ready)
  const anchorBefore = await evaluate(client, `(() => {
    const scroll = document.querySelector('.sidebar-regression-tree');
    const project = document.querySelector('[data-project-name="E:/workspace/CXCodex/playground"]');
    scroll.scrollTop = 220;
    const viewport = scroll.getBoundingClientRect();
    return { scrollTop: scroll.scrollTop, projectTop: project.getBoundingClientRect().top - viewport.top };
  })()`)
  await evaluate(client, `document.querySelector('[data-regression-action="promote-background-project"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 400))
  const anchorAfter = await evaluate(client, `(() => {
    const scroll = document.querySelector('.sidebar-regression-tree');
    const project = document.querySelector('[data-project-name="E:/workspace/CXCodex/playground"]');
    const viewport = scroll.getBoundingClientRect();
    return {
      scrollTop: scroll.scrollTop,
      projectTop: project.getBoundingClientRect().top - viewport.top,
      projectOrder: Array.from(scroll.querySelectorAll('.project-group')).map((node) => node.getAttribute('data-project-name') || ''),
    };
  })()`)
  assert(anchorAfter.projectOrder[0] === 'empty-root' && anchorAfter.projectOrder[1] === 'E:/workspace/CXCodex/playground', `sidebar background reorder drifted: ${JSON.stringify({ anchorBefore, anchorAfter })}`)
  assert(Math.abs(anchorAfter.projectTop - anchorBefore.projectTop) <= 1.5 && anchorAfter.scrollTop > anchorBefore.scrollTop, `sidebar visible anchor moved: ${JSON.stringify({ anchorBefore, anchorAfter })}`)

  await navigate(client, `${fixtureBaseUrl}&revealCurrent=1`, ready)
  const revealBefore = await evaluate(client, `({
    activeMounted: document.querySelector('.sidebar-regression-tree .thread-row[data-active="true"]') !== null,
    renderedRows: document.querySelector('[data-project-name="E:/workspace/CXCodex/codexui"]')?.querySelectorAll('.thread-row').length || 0,
  })`)
  assert(!revealBefore.activeMounted && revealBefore.renderedRows === 5, `sidebar current-thread baseline drifted: ${JSON.stringify(revealBefore)}`)
  await evaluate(client, `document.querySelector('[data-regression-action="reveal-current-thread"]')?.click()`)
  await new Promise((resolve) => setTimeout(resolve, 700))
  const revealAfter = await evaluate(client, `(() => {
    const scroll = document.querySelector('.sidebar-regression-tree');
    const row = document.querySelector('.sidebar-regression-tree .thread-row[data-active="true"]');
    const project = document.querySelector('[data-project-name="E:/workspace/CXCodex/codexui"]');
    const viewport = scroll.getBoundingClientRect();
    const rect = row?.getBoundingClientRect();
    return {
      activeThreadId: row?.getAttribute('data-thread-id') || '',
      renderedRows: project?.querySelectorAll('.thread-row').length || 0,
      moreLabel: project?.querySelector('.thread-show-more-button')?.textContent?.trim() || '',
      visible: Boolean(rect) && rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1,
      scrollTop: scroll.scrollTop,
      viewport: { top: viewport.top, bottom: viewport.bottom },
      row: rect ? { top: rect.top, bottom: rect.bottom } : null,
    };
  })()`)
  assert(revealAfter.activeThreadId === 'fixture-thread-eight' && revealAfter.renderedRows === 8 && revealAfter.moreLabel === '收起', `sidebar current-thread expansion drifted: ${JSON.stringify(revealAfter)}`)
  assert(revealAfter.visible && revealAfter.scrollTop > 0, `sidebar current thread was not revealed: ${JSON.stringify(revealAfter)}`)

  await navigate(client, fixtureBaseUrl, ready)
  const screenshot = await captureViewport(client, 'sidebar-rows-phone.png')
  const browserErrors = summarizeBrowserErrors(client.events)
  assert(browserErrors.length === 0, `sidebar browser errors: ${JSON.stringify(browserErrors.slice(0, 12))}`)
  return { mode: 'sidebar', baseUrl, baseline, menu, staleSearch, heldSearch, divergedSearch, restoredSearch, anchorBefore, anchorAfter, revealBefore, revealAfter, screenshots: [screenshot] }
}

function summarizeBrowserErrors(events) {
  return events.flatMap((event) => {
    if (event.method === 'Runtime.exceptionThrown') {
      return [{ kind: 'exception', detail: event.params?.exceptionDetails?.text ?? 'runtime exception' }]
    }
    if (event.method === 'Runtime.consoleAPICalled' && event.params?.type === 'error') {
      return [{ kind: 'console', detail: JSON.stringify(event.params?.args ?? []).slice(0, 800) }]
    }
    if (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error') {
      if (String(event.params?.entry?.url ?? '').endsWith('/favicon.ico')) return []
      return [{ kind: 'log', detail: String(event.params.entry.text ?? '').slice(0, 800) }]
    }
    if (event.method === 'Network.responseReceived' && Number(event.params?.response?.status ?? 0) >= 400) {
      if (String(event.params?.response?.url ?? '').endsWith('/favicon.ico')) return []
      return [{
        kind: 'http',
        status: Number(event.params.response.status),
        url: String(event.params.response.url ?? ''),
        detail: String(event.params.response.statusText ?? ''),
      }]
    }
    if (event.method === 'Network.loadingFailed' && event.params?.canceled !== true) {
      return [{
        kind: 'network',
        url: String(event.params?.url ?? ''),
        detail: String(event.params?.errorText ?? 'network request failed'),
      }]
    }
    return []
  })
}

function isAllowedIsolatedRpcError(error) {
  if (!allowIsolatedRpcErrors) return false
  if (error.kind !== 'http' || error.status !== 502) return false
  return error.url.includes('/codex-api/rpc') || error.url.includes('/codex-api/goal')
}

function assertRealSessionMetrics(metrics, viewportName, requireTouchTargets) {
  assert(metrics.threadId === threadId, `${viewportName} rendered ${metrics.threadId || 'no thread'} instead of ${threadId}`)
  assert(metrics.turnCount >= 1, `${viewportName} did not render a real conversation turn`)
  assert(metrics.finalCount >= 1, `${viewportName} did not retain any explicit historical final answer`)
  assert(metrics.multipleFinalTurnIds.length === 0, `${viewportName} rendered multiple finals in turns: ${metrics.multipleFinalTurnIds.join(', ')}`)
  assert(metrics.turnDividerCount === metrics.turnCount, `${viewportName} did not render exactly one Sema-style divider per turn`)
  assert(metrics.unavailableTimingCopyCount === 0, `${viewportName} rendered non-actionable unavailable timing copy`)
  assert(metrics.legacyTurnHeadingCount === 0, `${viewportName} rendered the removed per-turn Codex/status heading`)
  if (requireFileSummary) {
    assert(metrics.fileSummaryCount >= 1, `${viewportName} did not render the required structured file summary`)
    assert(metrics.openFileSummaryCount === 0, `${viewportName} expanded file history before the user requested it`)
    assert(metrics.visibleFileRowCount === 0, `${viewportName} mounted visible file rows before disclosure`)
    assert(metrics.maximumFileSummaryHeight <= 56, `${viewportName} file summary used ${metrics.maximumFileSummaryHeight}px before disclosure`)
  }
  assert(metrics.missingFinalCount === 0, `${viewportName} rendered a non-actionable missing-final placeholder`)
  assert(metrics.terminalStreamingFinalCount === 0, `${viewportName} left ${metrics.terminalStreamingFinalCount} terminal finals blinking`)
  assert(metrics.internalContextLeakCount === 0, `${viewportName} leaked internal context markers into the transcript`)
  assert(metrics.legacyOverlayCount === 0, `${viewportName} rendered a legacy tail overlay`)
  assert(metrics.horizontalOverflowPx <= 1, `${viewportName} overflowed horizontally by ${metrics.horizontalOverflowPx}px`)
  if (requireTouchTargets) {
    assert(metrics.undersizedTouchTargets.length === 0, `${viewportName} has undersized touch targets: ${JSON.stringify(metrics.undersizedTouchTargets)}`)
    if (metrics.touchTargetCount > 0) {
      assert(metrics.minimumTouchTargetHeight >= 44, `${viewportName} touch target is only ${metrics.minimumTouchTargetHeight}px high: ${JSON.stringify(metrics.undersizedTouchTargets)}`)
    }
  }
}

async function reloadAndReadCacheMetric(client, readyExpression) {
  const reload = await client.send('Page.reload', { ignoreCache: true })
  if (reload.errorText) throw new Error(`Reload failed: ${reload.errorText}`)
  await waitFor(client, readyExpression, 20_000)
  await waitFor(client, `Boolean(window.__cxCodexThreadFirstScreenReady?.[${JSON.stringify(threadId)}])`, 10_000)
  return evaluate(client, `(() => {
    const metric = window.__cxCodexThreadFirstScreenReady?.[${JSON.stringify(threadId)}] ?? null;
    const start = window.__cxCodexThreadFirstScreenStart?.[${JSON.stringify(threadId)}] ?? null;
    const requests = performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes('/codex-api/state/thread/'))
      .map((entry) => ({
        name: entry.name,
        startTime: Math.round(entry.startTime),
        responseEnd: Math.round(entry.responseEnd),
        duration: Math.round(entry.duration),
      }));
    return metric ? { ...metric, start, requests } : null;
  })()`)
}

async function runRealSession(client) {
  assert(threadId.length > 0, '--thread-id is required when --mode real')
  const rootSelector = '.content-thread .transcript-root'
  const readyExpression = `document.querySelector('.content-thread .transcript-list')?.getAttribute('data-thread-id') === ${JSON.stringify(threadId)}`
  const settledHistoryExpression = `${readyExpression} && Boolean(document.querySelector('.content-thread .final-answer'))`

  await configureViewport(client, 1440, 900, false)
  await navigate(client, realSessionUrl, settledHistoryExpression)
  const desktop = await readMetrics(client, rootSelector)
  assertRealSessionMetrics(desktop, 'desktop real session', false)
  const desktopScreenshot = await capture(client, 'conversation-real-desktop.png', '.content-thread .final-answer')

  let cacheReload = null
  if (requireCacheReload) {
    cacheReload = await reloadAndReadCacheMetric(client, readyExpression)
    assert(cacheReload?.source === 'local-cache', `real-session reload source was ${cacheReload?.source ?? 'missing'}, expected local-cache`)
    assert(Number(cacheReload.selectionLatencyMs) <= 300, `local-cache first screen took ${String(cacheReload.selectionLatencyMs)}ms, expected <= 300ms: ${JSON.stringify(cacheReload)}`)
  }

  await configureViewport(client, 393, 852, true)
  await navigate(client, realSessionUrl, settledHistoryExpression)
  const mobile = await readMetrics(client, rootSelector)
  assertRealSessionMetrics(mobile, 'mobile real session', true)
  const mobileScreenshot = await capture(client, 'conversation-real-mobile.png', '.content-thread .turn-shell:last-child')

  await configureViewport(client, 884, 1104, true)
  await navigate(client, realSessionUrl, settledHistoryExpression)
  const foldable = await readMetrics(client, rootSelector)
  assertRealSessionMetrics(foldable, 'foldable real session', true)
  const foldableFocus = requireFileSummary ? '.content-thread .file-summary' : '.content-thread .turn-shell:last-child'
  const foldableScreenshot = await capture(client, 'conversation-real-foldable.png', foldableFocus)

  const browserErrors = summarizeBrowserErrors(client.events)
  const ignoredBrowserErrors = browserErrors.filter((error) => isAllowedIsolatedRpcError(error))
  const unexpectedBrowserErrors = browserErrors.filter((error) => !isAllowedIsolatedRpcError(error))
  assert(unexpectedBrowserErrors.length === 0, `real-session browser errors: ${JSON.stringify(unexpectedBrowserErrors.slice(0, 12))}`)

  return {
    mode: 'real',
    baseUrl,
    threadId,
    desktop,
    mobile,
    foldable,
    cacheReload,
    ignoredBrowserErrors,
    screenshots: [desktopScreenshot, mobileScreenshot, foldableScreenshot],
  }
}

async function run() {
  assert(mode === 'fixture' || mode === 'real' || mode === 'composer' || mode === 'shell' || mode === 'sidebar' || mode === 'hardening' || mode === 'contract', '--mode must be fixture, composer, shell, sidebar, hardening, contract, or real')
  await fs.mkdir(outputDir, { recursive: true })
  const targetResponse = await fetch(`http://127.0.0.1:${String(cdpPort)}/json/new?about%3Ablank`, { method: 'PUT' })
  assert(targetResponse.ok, `Unable to create CDP target: ${targetResponse.status}`)
  const target = await targetResponse.json()
  const socket = await openSocket(target.webSocketDebuggerUrl)
  const client = new CdpClient(socket)

  try {
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Log.enable')
    await client.send('Network.enable')
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__cxLongTasks = []; new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__cxLongTasks.push({ startTime: Math.round(entry.startTime), duration: Math.round(entry.duration) }); }).observe({ type: 'longtask', buffered: true });`,
    })

    if (mode === 'real') {
      console.log(JSON.stringify(await runRealSession(client), null, 2))
      return
    }
    if (mode === 'composer') {
      console.log(JSON.stringify(await runComposerShell(client), null, 2))
      return
    }
    if (mode === 'shell') {
      console.log(JSON.stringify(await runQuietShell(client), null, 2))
      return
    }
    if (mode === 'sidebar') {
      console.log(JSON.stringify(await runSidebarRegression(client), null, 2))
      return
    }
    if (mode === 'hardening') {
      console.log(JSON.stringify(await runHardening(client), null, 2))
      return
    }
    if (mode === 'contract') {
      console.log(JSON.stringify(await runContractBaseline(client), null, 2))
      return
    }

    await configureViewport(client, 1440, 900, false)
    await navigate(client, fixtureUrl)
    const desktop = await readMetrics(client)
    const defaultProcessWindow = await evaluate(client, `(() => ({
      visibleCounts: Array.from(document.querySelectorAll('.conversation-regression-thread .process-content'))
        .map((element) => Number(element.getAttribute('data-visible-process-count') || '0')),
      historyControlCount: document.querySelectorAll('.conversation-regression-thread .process-history-action[aria-expanded="false"]').length,
    }))()`)
    assert(desktop.turnCount >= 3, 'desktop fixture did not project all turns')
    assert(desktop.finalCount === 1, 'desktop fixture must render exactly one explicit final answer')
    assert(desktop.commentaryCount >= 1, 'desktop fixture must keep commentary in the turn process')
    assert(desktop.projectedActivityCount >= 5 && desktop.mountedActivityCount + desktop.commentaryCount >= 1, 'desktop fixture is missing its latest projected process item')
    assert(defaultProcessWindow.visibleCounts.every((count) => count <= 1) && defaultProcessWindow.historyControlCount >= 1, `process history is not latest-only by default: ${JSON.stringify(defaultProcessWindow)}`)
    assert(desktop.fileSummaryCount === 1, 'desktop fixture is missing the file change summary')
    assert(desktop.openFileSummaryCount === 0 && desktop.visibleFileRowCount === 0, `desktop file history must stay collapsed until requested: ${JSON.stringify(desktop)}`)
    assert(desktop.maximumFileSummaryHeight <= 56, `desktop file summary is too tall before disclosure: ${JSON.stringify(desktop)}`)
    assert(desktop.missingFinalCount === 0, 'desktop fixture rendered a non-actionable missing-final placeholder')
    assert(desktop.terminalStreamingFinalCount === 0, 'desktop fixture left a terminal final blinking')
    assert(desktop.requestCardCount >= 5, 'desktop fixture is missing pending request cards')
    assert(['approval', 'user-input', 'mcp-input', 'mcp-approval', 'unsupported-tool'].every((type) => desktop.interactionTypes.includes(type)), `pending requests are not rendered from all projected interaction types: ${JSON.stringify(desktop)}`)
    assert(desktop.mcpPersistenceScopes.join(',') === 'session,always', `MCP persistence actions do not match advertised scopes: ${JSON.stringify(desktop)}`)
    assert(desktop.mcpContextText.some((text) => text.includes('Qjzn/CX-Codex')) && desktop.mcpContextText.some((text) => text.includes('closed')), `MCP approval is missing meaningful target details: ${JSON.stringify(desktop)}`)
    assert(desktop.userInputSelectCount === 1 && desktop.userInputOtherCount === 1, `user-input controls are incomplete: ${JSON.stringify(desktop)}`)
    assert(desktop.userInputSelectedText === '请选择', `user-input must show an explicit unanswered state: ${JSON.stringify(desktop)}`)
    assert(desktop.userInputSubmitDisabled === true, `unanswered user-input must not submit implicitly: ${JSON.stringify(desktop)}`)
    assert(desktop.safeAuthorizationLinkCount === 1, `MCP authorization link is missing or unsafe: ${JSON.stringify(desktop)}`)
    assert(desktop.mcpAuthorizationTextareaCount === 0, `URL authorization request rendered an unrelated freeform answer: ${JSON.stringify(desktop)}`)
    assert(desktop.activeTurnCount >= 1 && desktop.activeProcessExpanded === 'true' && desktop.activeCollapsedProcessCount === 0, `active processes must be expanded: ${JSON.stringify(desktop)}`)
    assert(desktop.completedExpandedCount === 0, 'completed processes must start collapsed')
    assert(desktop.turnDividerCount === desktop.turnCount && desktop.legacyTurnHeadingCount === 0, `desktop turns do not match the Sema divider hierarchy: ${JSON.stringify(desktop)}`)
    assert(desktop.unavailableTimingCopyCount === 0, `desktop fixture rendered unavailable timing noise: ${JSON.stringify(desktop)}`)
    assert(desktop.liveStateCount >= 1, 'desktop running turn is missing lightweight live-state feedback')
    assert(desktop.legacyOverlayCount === 0, 'legacy tail overlay must not render')
    assert(desktop.horizontalOverflowPx <= 1, `desktop overflowed horizontally by ${desktop.horizontalOverflowPx}px`)
    const motion = await verifyMotionPreference(client)
    const collaborationScreenshot = await verifyCompletedDetails(client)
    const sessionPersistenceResponse = await verifyMcpPersistenceResponse(client, 'session')
    await navigate(client, fixtureUrl)
    const alwaysPersistenceResponse = await verifyMcpPersistenceResponse(client, 'always')
    await navigate(client, fixtureUrl)
    const userInputResponse = await verifyUserInputResponse(client)
    await navigate(client, fixtureUrl)
    const desktopScreenshot = await capture(client, 'conversation-desktop.png', '.request-card[data-interaction-type="mcp-approval"]')

    await configureViewport(client, 393, 852, true)
    await navigate(client, fixtureUrl)
    const mobile = await readMetrics(client)
    assert(mobile.finalCount === 1, 'mobile fixture must render exactly one explicit final answer')
    assert(mobile.fileSummaryCount === 1, 'mobile fixture is missing the file change summary')
    assert(mobile.openFileSummaryCount === 0 && mobile.visibleFileRowCount === 0, `mobile file history must stay collapsed until requested: ${JSON.stringify(mobile)}`)
    assert(mobile.maximumFileSummaryHeight <= 56, `mobile file summary is too tall before disclosure: ${JSON.stringify(mobile)}`)
    assert(mobile.missingFinalCount === 0 && mobile.terminalStreamingFinalCount === 0, `mobile rendered noisy final state: ${JSON.stringify(mobile)}`)
    assert(mobile.legacyOverlayCount === 0, 'mobile fixture rendered a legacy tail overlay')
    assert(mobile.horizontalOverflowPx <= 1, `mobile overflowed horizontally by ${mobile.horizontalOverflowPx}px`)
    assert(mobile.minimumTouchTargetHeight >= 44, `mobile touch target is only ${mobile.minimumTouchTargetHeight}px high`)
    assert(['approval', 'user-input', 'mcp-input', 'mcp-approval', 'unsupported-tool'].every((type) => mobile.interactionTypes.includes(type)), `mobile fixture is missing a projected interaction type: ${JSON.stringify(mobile)}`)
    const mobileScreenshot = await capture(client, 'conversation-mobile.png', '.request-card[data-interaction-type="user-input"]')

    await configureViewport(client, 884, 1104, true)
    await navigate(client, fixtureUrl)
    const foldable = await readMetrics(client)
    assert(foldable.finalCount === 1, 'foldable fixture must render exactly one explicit final answer')
    assert(foldable.fileSummaryCount === 1, 'foldable fixture is missing the file change summary')
    assert(foldable.openFileSummaryCount === 0 && foldable.visibleFileRowCount === 0, `foldable file history must stay collapsed until requested: ${JSON.stringify(foldable)}`)
    assert(foldable.maximumFileSummaryHeight <= 56, `foldable file summary is too tall before disclosure: ${JSON.stringify(foldable)}`)
    assert(foldable.missingFinalCount === 0 && foldable.terminalStreamingFinalCount === 0, `foldable rendered noisy final state: ${JSON.stringify(foldable)}`)
    assert(foldable.requestCardCount >= 5, 'foldable fixture is missing pending request cards')
    assert(['approval', 'user-input', 'mcp-input', 'mcp-approval', 'unsupported-tool'].every((type) => foldable.interactionTypes.includes(type)), `foldable fixture is missing a projected interaction type: ${JSON.stringify(foldable)}`)
    assert(foldable.legacyOverlayCount === 0, 'foldable fixture rendered a legacy tail overlay')
    assert(foldable.horizontalOverflowPx <= 1, `foldable overflowed horizontally by ${foldable.horizontalOverflowPx}px`)
    assert(foldable.minimumTouchTargetHeight >= 44, `foldable touch target is only ${foldable.minimumTouchTargetHeight}px high: ${JSON.stringify(foldable.undersizedTouchTargets)}`)
    const foldableScreenshot = await capture(client, 'conversation-foldable.png', '.request-card[data-interaction-type="mcp-input"]')

    await configureViewport(client, 393, 852, true)
    await navigate(client, longTurnsUrl)
    await waitFor(client, `document.querySelector('.transcript-list')?.getAttribute('data-message-count') === '1602' && Boolean(document.querySelector('.turn-shell[data-turn-index="800"]'))`)
    const longTurnsBottom = await readMetrics(client)
    assert(longTurnsBottom.turnCount === 801 && longTurnsBottom.projectedMessageCount === 1602, `long-turn fixture did not preserve 801 turns / 1602 messages: ${JSON.stringify(longTurnsBottom)}`)
    assert(longTurnsBottom.virtualized === 'true', `long-turn fixture did not enable turn virtualization: ${JSON.stringify(longTurnsBottom)}`)
    assert(longTurnsBottom.mountedTurnCount <= 10 && longTurnsBottom.mountedMessageCount <= 20, `long-turn fixture exceeded its DOM budget: ${JSON.stringify(longTurnsBottom)}`)
    assert(longTurnsBottom.lastMountedTurnIndex === 800, `long-turn fixture did not start at the live tail: ${JSON.stringify(longTurnsBottom)}`)

    await evaluate(client, `(() => { const list = document.querySelector('.transcript-list'); if (!(list instanceof HTMLElement)) return false; list.scrollTop = 0; list.dispatchEvent(new Event('scroll')); return true })()`)
    await waitFor(client, `document.querySelector('.turn-shell')?.getAttribute('data-turn-index') === '0'`)
    const longTurnsTop = await readMetrics(client)
    assert(longTurnsTop.mountedTurnCount <= 10 && longTurnsTop.mountedMessageCount <= 20, `top long-turn window exceeded its DOM budget: ${JSON.stringify(longTurnsTop)}`)

    await evaluate(client, `(() => { const list = document.querySelector('.transcript-list'); if (!(list instanceof HTMLElement)) return false; list.scrollTop = Math.max(0, (list.scrollHeight - list.clientHeight) / 2); list.dispatchEvent(new Event('scroll')); return true })()`)
    await waitFor(client, `Number(document.querySelector('.turn-shell')?.getAttribute('data-turn-index') || '0') > 100`)
    const longTurnsMiddle = await readMetrics(client)
    assert(longTurnsMiddle.firstMountedTurnIndex > 0 && longTurnsMiddle.lastMountedTurnIndex < 800, `long-turn middle window did not move: ${JSON.stringify(longTurnsMiddle)}`)
    assert(longTurnsMiddle.mountedTurnCount <= 10 && longTurnsMiddle.mountedMessageCount <= 20, `middle long-turn window exceeded its DOM budget: ${JSON.stringify(longTurnsMiddle)}`)

    const longFocusClicked = await evaluate(client, `(() => { const button = document.querySelector('[data-testid="focus-long-message"]'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()`)
    assert(longFocusClicked, 'long-turn fixture is missing the offscreen focus action')
    await waitFor(client, `Boolean(document.querySelector('[data-message-id="fixture-long-final-400"].is-highlighted'))`)
    const longTurnsFocused = await readMetrics(client)
    const longFocusState = await evaluate(client, `(() => {
      const target = document.querySelector('[data-message-id="fixture-long-final-400"]');
      const list = document.querySelector('.transcript-list');
      return {
        succeeded: document.querySelector('.conversation-regression-long-focus-state')?.getAttribute('data-succeeded') === 'true',
        turnId: target?.closest('.turn-shell')?.getAttribute('data-turn-id') || '',
        highlighted: target?.classList.contains('is-highlighted') === true,
        atBottom: list instanceof HTMLElement ? list.scrollHeight - list.scrollTop - list.clientHeight <= 24 : true,
      };
    })()`)
    assert(longFocusState.succeeded && longFocusState.highlighted && longFocusState.turnId === 'fixture-long-turn-400', `offscreen long-turn focus did not reach the projected message: ${JSON.stringify(longFocusState)}`)
    assert(!longFocusState.atBottom, `offscreen long-turn focus was overridden by live-tail following: ${JSON.stringify(longFocusState)}`)
    assert(longTurnsFocused.firstMountedTurnIndex <= 400 && longTurnsFocused.lastMountedTurnIndex >= 400, `offscreen focus did not mount turn 400: ${JSON.stringify(longTurnsFocused)}`)
    assert(longTurnsFocused.mountedTurnCount <= 10 && longTurnsFocused.mountedMessageCount <= 20, `offscreen focus exceeded the long-turn DOM budget: ${JSON.stringify(longTurnsFocused)}`)

    await evaluate(client, `(() => { const list = document.querySelector('.transcript-list'); if (!(list instanceof HTMLElement)) return false; list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll')); return true })()`)
    await waitFor(client, `Boolean(document.querySelector('.turn-shell[data-turn-index="800"]'))`)
    await evaluate(client, `(() => { window.__cxLongTasks = []; return true })()`)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const longTurnsStressBefore = await readMetrics(client)
    const longTurnsStressStatus = await evaluate(client, `(() => {
      const status = document.querySelector('[data-testid="conversation-streaming-stress-status"]');
      return {
        updates: Number(status?.getAttribute('data-update-count') || '0'),
        heartbeats: Number(status?.getAttribute('data-heartbeat-count') || '0'),
        maxLagMs: Number(status?.getAttribute('data-max-heartbeat-lag-ms') || '0'),
        maxLongTaskMs: Math.max(0, ...(Array.isArray(window.__cxLongTasks) ? window.__cxLongTasks.map((entry) => entry.duration) : [])),
      };
    })()`)
    await evaluate(client, `document.querySelector('[data-testid="conversation-streaming-stress-action"]')?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const longTurnsAfterAction = await evaluate(client, `(() => { const status = document.querySelector('[data-testid="conversation-streaming-stress-status"]'); return { actionCount: Number(status?.getAttribute('data-action-count') || '0'), updates: Number(status?.getAttribute('data-update-count') || '0') } })()`)
    assert(longTurnsStressBefore.mountedTurnCount <= 10 && longTurnsStressBefore.mountedMessageCount <= 20, `streaming long-turn window exceeded its DOM budget: ${JSON.stringify(longTurnsStressBefore)}`)
    assert(longTurnsStressStatus.updates >= 20 && longTurnsStressStatus.heartbeats >= 20, `long-turn fixture did not continue streaming: ${JSON.stringify(longTurnsStressStatus)}`)
    assert(longTurnsStressStatus.maxLongTaskMs < 80, `long-turn streaming task reached ${longTurnsStressStatus.maxLongTaskMs}ms: ${JSON.stringify(longTurnsStressStatus)}`)
    assert(longTurnsAfterAction.actionCount === 1 && longTurnsAfterAction.updates > longTurnsStressStatus.updates, `long-turn streaming interaction did not stay responsive: ${JSON.stringify({ longTurnsStressStatus, longTurnsAfterAction })}`)
    assert(longTurnsStressBefore.horizontalOverflowPx <= 1, `long-turn fixture overflowed horizontally by ${longTurnsStressBefore.horizontalOverflowPx}px`)
    const longTurnsScreenshot = await captureViewport(client, 'conversation-long-turns-mobile.png')

    await navigate(client, longHistoryUrl)
    await waitFor(client, `document.querySelector('.transcript-list')?.getAttribute('data-turn-count') === '761'`)
    await evaluate(client, `(() => { const list = document.querySelector('.transcript-list'); if (!(list instanceof HTMLElement)) return false; list.scrollTop = 0; list.dispatchEvent(new Event('scroll')); return true })()`)
    await waitFor(client, `document.querySelector('.turn-shell')?.getAttribute('data-turn-id') === 'fixture-long-turn-40'`)
    const longHistoryBefore = await evaluate(client, `(() => {
      const list = document.querySelector('.transcript-list');
      const anchor = document.querySelector('.turn-shell[data-turn-id="fixture-long-turn-40"]');
      return {
        anchorTop: anchor?.getBoundingClientRect().top ?? -1,
        scrollTop: list instanceof HTMLElement ? list.scrollTop : -1,
        mountedTurnCount: document.querySelectorAll('.conversation-regression-thread .turn-shell').length,
      };
    })()`)
    const longHistoryClicked = await evaluate(client, `(() => { const button = document.querySelector('.conversation-regression-thread .history-button'); if (!(button instanceof HTMLButtonElement)) return false; button.click(); return true })()`)
    assert(longHistoryClicked, 'virtualized long history is missing its older-history action')
    await waitFor(client, `document.querySelector('.transcript-list')?.getAttribute('data-turn-count') === '801' && Boolean(document.querySelector('.turn-shell[data-turn-id="fixture-long-turn-40"]'))`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const longHistoryAfter = await evaluate(client, `(() => {
      const list = document.querySelector('.transcript-list');
      const anchor = document.querySelector('.turn-shell[data-turn-id="fixture-long-turn-40"]');
      return {
        anchorTop: anchor?.getBoundingClientRect().top ?? -1,
        scrollTop: list instanceof HTMLElement ? list.scrollTop : -1,
        mountedTurnCount: document.querySelectorAll('.conversation-regression-thread .turn-shell').length,
        mountedMessageCount: document.querySelectorAll('.conversation-regression-thread [data-message-id]').length,
        requestCount: Number(document.querySelector('.conversation-regression-older-history-count')?.getAttribute('data-count') || '0'),
      };
    })()`)
    assert(longHistoryAfter.requestCount === 1, `virtualized older-history action did not emit exactly once: ${JSON.stringify(longHistoryAfter)}`)
    assert(Math.abs(longHistoryAfter.anchorTop - longHistoryBefore.anchorTop) <= 8, `virtualized older-history prepend moved the reading anchor: ${JSON.stringify({ before: longHistoryBefore, after: longHistoryAfter })}`)
    assert(longHistoryAfter.scrollTop > longHistoryBefore.scrollTop, `virtualized older-history prepend did not compensate scroll position: ${JSON.stringify({ before: longHistoryBefore, after: longHistoryAfter })}`)
    assert(longHistoryAfter.mountedTurnCount <= 10 && longHistoryAfter.mountedMessageCount <= 20, `virtualized older-history prepend exceeded the DOM budget: ${JSON.stringify(longHistoryAfter)}`)
    const longHistoryScreenshot = await captureViewport(client, 'conversation-long-history-mobile.png')

    await navigate(client, `${fixtureUrl}&streamStress=1`)
    await waitFor(client, `Boolean(document.querySelector('[data-testid="conversation-streaming-stress-status"]'))`)
    const initialLongTaskMaxMs = await evaluate(client, `Math.max(0, ...(Array.isArray(window.__cxLongTasks) ? window.__cxLongTasks.map((entry) => entry.duration) : []))`)
    await evaluate(client, `(() => { window.__cxLongTasks = []; return true })()`)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const stressBefore = await readMetrics(client)
    const stressStatus = await evaluate(client, `(() => {
      const status = document.querySelector('[data-testid="conversation-streaming-stress-status"]');
      return {
        updates: Number(status?.getAttribute('data-update-count') || '0'),
        heartbeats: Number(status?.getAttribute('data-heartbeat-count') || '0'),
        maxLagMs: Number(status?.getAttribute('data-max-heartbeat-lag-ms') || '0'),
        maxLongTaskMs: Math.max(0, ...(Array.isArray(window.__cxLongTasks) ? window.__cxLongTasks.map((entry) => entry.duration) : [])),
        longTasks: Array.isArray(window.__cxLongTasks) ? window.__cxLongTasks.slice(-20) : [],
      };
    })()`)
    await evaluate(client, `document.querySelector('[data-testid="conversation-streaming-stress-action"]')?.click()`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const actionCount = await evaluate(client, `Number(document.querySelector('[data-testid="conversation-streaming-stress-status"]')?.getAttribute('data-action-count') || '0')`)
    assert(stressBefore.projectedActivityCount >= 1_600, `stress fixture did not retain the full projected activity history: ${JSON.stringify(stressBefore)}`)
    assert(stressBefore.mountedActivityCount + stressBefore.commentaryCount === 1, `stress fixture should mount only its latest process item by default: ${JSON.stringify(stressBefore)}`)
    assert(stressStatus.updates >= 20 && stressStatus.heartbeats >= 20, 'streaming stress fixture did not continue updating')
    assert(stressStatus.maxLongTaskMs < 80, `streaming stress long task reached ${stressStatus.maxLongTaskMs}ms: ${JSON.stringify({ ...stressBefore, ...stressStatus })}`)
    assert(stressStatus.maxLagMs < 200, `streaming stress heartbeat lag reached ${stressStatus.maxLagMs}ms: ${JSON.stringify({ ...stressBefore, ...stressStatus })}`)
    assert(actionCount === 1, 'stress fixture action did not remain responsive')

    await navigate(client, syncDegradedUrl)
    await waitFor(client, `Boolean(document.querySelector('.turn-live-state[data-state="sync-degraded"]'))`)
    const syncDegraded = await readMetrics(client)
    assert(syncDegraded.syncDegradedActiveTurnCount === 1, `sync-degraded turn is not active: ${JSON.stringify(syncDegraded)}`)
    assert(syncDegraded.activeProcessExpanded === 'true' && syncDegraded.activeProcessDisabled === true, `sync-degraded process is not pinned open: ${JSON.stringify(syncDegraded)}`)
    assert(syncDegraded.syncDegradedStateCount === 1, `sync-degraded live state is missing: ${JSON.stringify(syncDegraded)}`)
    assert(syncDegraded.projectedActivityCount >= 1_600 && syncDegraded.mountedActivityCount + syncDegraded.commentaryCount === 1, `sync-degraded process window must stay latest-only by default: ${JSON.stringify(syncDegraded)}`)
    assert(syncDegraded.horizontalOverflowPx <= 1, `sync-degraded fixture overflowed horizontally by ${syncDegraded.horizontalOverflowPx}px`)
    const syncDegradedScreenshot = await captureViewport(client, 'conversation-sync-degraded-mobile.png')

    console.log(JSON.stringify({ desktop, mobile, foldable, motion, persistenceResponses: { session: sessionPersistenceResponse, always: alwaysPersistenceResponse }, userInputResponse, longTurns: { bottom: longTurnsBottom, top: longTurnsTop, middle: longTurnsMiddle, focused: { ...longTurnsFocused, ...longFocusState }, streaming: { ...longTurnsStressBefore, ...longTurnsStressStatus, ...longTurnsAfterAction }, olderHistory: { before: longHistoryBefore, after: longHistoryAfter } }, stress: { ...stressBefore, ...stressStatus, initialLongTaskMaxMs, actionCount }, syncDegraded, screenshots: [collaborationScreenshot, desktopScreenshot, mobileScreenshot, foldableScreenshot, longTurnsScreenshot, longHistoryScreenshot, syncDegradedScreenshot] }, null, 2))
  } finally {
    socket.close()
    await fetch(`http://127.0.0.1:${String(cdpPort)}/json/close/${target.id}`).catch(() => {})
  }
}

await run()
