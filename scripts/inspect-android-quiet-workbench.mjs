import fs from 'node:fs/promises'
import path from 'node:path'

const endpoint = process.env.CX_ANDROID_CDP_ENDPOINT?.trim() || 'http://127.0.0.1:9223'
const outputFlagIndex = process.argv.indexOf('--output')
const outputPath = outputFlagIndex >= 0 ? process.argv[outputFlagIndex + 1] : ''
const clearComposer = process.argv.includes('--clear-composer')
const enableTaskPet = process.argv.includes('--enable-task-pet')
const disableTaskPet = process.argv.includes('--disable-task-pet')
const submitFlagIndex = process.argv.indexOf('--submit')
const submitText = submitFlagIndex >= 0 ? process.argv[submitFlagIndex + 1] ?? '' : ''
const acknowledgeThreadFlagIndex = process.argv.indexOf('--acknowledge-thread')
const acknowledgeThreadId = acknowledgeThreadFlagIndex >= 0
  ? process.argv[acknowledgeThreadFlagIndex + 1] ?? ''
  : ''
const tasksJsonFlagIndex = process.argv.indexOf('--tasks-json')
const taskPetTasksJson = tasksJsonFlagIndex >= 0 ? process.argv[tasksJsonFlagIndex + 1] ?? '[]' : '[]'

if (!Array.isArray(JSON.parse(taskPetTasksJson))) {
  throw new Error('--tasks-json must contain a JSON array.')
}

if (enableTaskPet && disableTaskPet) {
  throw new Error('Choose only one of --enable-task-pet or --disable-task-pet.')
}

const targetsResponse = await fetch(`${endpoint}/json`)
if (!targetsResponse.ok) {
  throw new Error(`Unable to read Android WebView targets: HTTP ${targetsResponse.status}`)
}

const targets = await targetsResponse.json()
const target = targets.find((candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl)
if (!target) {
  throw new Error('No debuggable Android WebView page target was found.')
}

const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextCommandId = 1
const pendingCommands = new Map()

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (!message.id || !pendingCommands.has(message.id)) return
  const { resolve, reject } = pendingCommands.get(message.id)
  pendingCommands.delete(message.id)
  if (message.error) reject(new Error(message.error.message))
  else resolve(message.result)
})

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', () => reject(new Error('Android WebView CDP connection failed.')), {
    once: true,
  })
})

const sendCommand = (method, params = {}) => {
  const id = nextCommandId++
  return new Promise((resolve, reject) => {
    pendingCommands.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

await sendCommand('Runtime.enable')
const evaluation = await sendCommand('Runtime.evaluate', {
  awaitPromise: true,
  returnByValue: true,
  expression: `(async () => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    }
    const bounds = (element) => {
      if (!(element instanceof HTMLElement)) return null
      const rect = element.getBoundingClientRect()
      return {
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
      }
    }
    const composer = document.querySelector('.thread-composer-shell')
    const textarea = composer?.querySelector('textarea') ?? null
    let taskPetAction = null
    if (${enableTaskPet || disableTaskPet}) {
      const mobileShell = globalThis.Capacitor?.Plugins?.MobileShell
      if (!mobileShell?.setTaskPetEnabled) {
        throw new Error('The Android MobileShell task-pet bridge is unavailable.')
      }
      taskPetAction = await mobileShell.setTaskPetEnabled({
        enabled: ${enableTaskPet},
        serverUrl: location.origin,
        tasksJson: ${JSON.stringify(taskPetTasksJson)},
        recentThreadsJson: '[]',
      })
    }
    let submissionAction = null
    if (${JSON.stringify(submitText)}) {
      if (!(textarea instanceof HTMLTextAreaElement)) {
        throw new Error('The Android composer textarea is unavailable.')
      }
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, ${JSON.stringify(submitText)})
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      const sendButton = [...composer.querySelectorAll('button')]
        .find((button) => button.getAttribute('aria-label') === '发送')
      if (!(sendButton instanceof HTMLButtonElement) || sendButton.disabled) {
        throw new Error('The Android composer send action is unavailable.')
      }
      sendButton.click()
      submissionAction = { submitted: true, textLength: ${submitText.length} }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    let threadAcknowledgementAction = null
    if (${JSON.stringify(acknowledgeThreadId)}) {
      const mobileShell = globalThis.Capacitor?.Plugins?.MobileShell
      if (!mobileShell?.markTaskPetThreadRead) {
        throw new Error('The Android MobileShell task acknowledgement bridge is unavailable.')
      }
      await mobileShell.markTaskPetThreadRead({ threadId: ${JSON.stringify(acknowledgeThreadId)} })
      threadAcknowledgementAction = { acknowledged: true, threadId: ${JSON.stringify(acknowledgeThreadId)} }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (${clearComposer} && textarea instanceof HTMLTextAreaElement) {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      valueSetter?.call(textarea, '')
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
    }
    const controls = composer?.querySelector('.thread-composer-controls') ?? null
    const viewport = window.visualViewport
    const viewportBottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight)
    const composerBounds = bounds(composer)
    const controlsBounds = bounds(controls)
    const interactiveControls = composer
      ? [...composer.querySelectorAll('button, [role="button"], select')]
          .filter(visible)
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return {
              name: element.getAttribute('aria-label') || element.textContent?.trim() || '',
              width: Math.round(rect.width * 10) / 10,
              height: Math.round(rect.height * 10) / 10,
            }
          })
      : []
    return {
      capturedAt: new Date().toISOString(),
      url: location.href,
      title: document.title,
      devicePixelRatio,
      screen: { width: screen.width, height: screen.height },
      viewport: {
        innerWidth,
        innerHeight,
        visualWidth: Math.round((viewport?.width ?? innerWidth) * 10) / 10,
        visualHeight: Math.round((viewport?.height ?? innerHeight) * 10) / 10,
        offsetTop: Math.round((viewport?.offsetTop ?? 0) * 10) / 10,
      },
      media: {
        coarsePointer: matchMedia('(pointer: coarse)').matches,
        compactWidth: matchMedia('(max-width: 1199px)').matches,
        phoneWidth: matchMedia('(max-width: 767px)').matches,
        lowLandscape: matchMedia('(max-height: 480px) and (max-width: 932px)').matches,
        dark: matchMedia('(prefers-color-scheme: dark)').matches,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      },
      document: {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight,
        pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      },
      activeElement: {
        tagName: document.activeElement?.tagName ?? '',
        ariaLabel: document.activeElement?.getAttribute?.('aria-label') ?? '',
      },
      scriptAssets: [...document.scripts]
        .map((script) => script.src)
        .filter(Boolean)
        .map((src) => new URL(src).pathname),
      taskPetAction,
      submissionAction,
      threadAcknowledgementAction,
      composer: {
        bounds: composerBounds,
        textareaBounds: bounds(textarea),
        textareaValueLength: textarea instanceof HTMLTextAreaElement ? textarea.value.length : 0,
        textareaLineCount: textarea instanceof HTMLTextAreaElement
          ? Math.max(1, textarea.value.split('\\n').length)
          : 0,
        textareaScrollHeight: textarea instanceof HTMLTextAreaElement ? textarea.scrollHeight : 0,
        controlsBounds,
        visible: visible(composer),
        withinVisualViewport: Boolean(
          composerBounds
          && composerBounds.y >= (viewport?.offsetTop ?? 0) - 1
          && composerBounds.bottom <= viewportBottom + 1
        ),
        controlsWithinVisualViewport: Boolean(
          controlsBounds
          && controlsBounds.y >= (viewport?.offsetTop ?? 0) - 1
          && controlsBounds.bottom <= viewportBottom + 1
        ),
        controls: interactiveControls,
      },
      landmarks: {
        main: document.querySelectorAll('main, [role="main"]').length,
        unnamedVisibleButtons: [...document.querySelectorAll('button')]
          .filter(visible)
          .filter((button) => !(button.getAttribute('aria-label') || button.textContent?.trim()))
          .length,
      },
    }
  })()`,
})

socket.close()

const result = evaluation.result?.value
if (!result) {
  throw new Error(`Android WebView evaluation returned no value: ${evaluation.exceptionDetails?.text || 'unknown error'}`)
}

const serialized = `${JSON.stringify(result, null, 2)}\n`
if (outputPath) {
  const resolvedOutputPath = path.resolve(outputPath)
  await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true })
  await fs.writeFile(resolvedOutputPath, serialized, 'utf8')
}
process.stdout.write(serialized)
