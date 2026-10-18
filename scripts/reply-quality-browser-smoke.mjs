import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Uses an already-running frontend and an isolated agent-browser session only.
// No bridge credentials, send API, Playwright, or shared-browser cleanup.
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  const value = process.argv[index + 1]
  assert.ok(['--base-url', '--output-dir', '--session', '--only'].includes(key) && value && !value.startsWith('--'), `Invalid argument: ${key}`)
  args.set(key, value)
}
const baseUrl = new URL(args.get('--base-url') ?? 'http://127.0.0.1:17423')
assert.ok(['http:', 'https:'].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password, 'Use an HTTP(S) URL without credentials')
const outputDir = path.resolve(args.get('--output-dir') ?? 'output/reply-quality-browser')
const session = args.get('--session') ?? `cx-reply-quality-${process.pid}`
assert.match(session, /^[a-zA-Z0-9_-]+$/, 'Use a simple isolated session name')
mkdirSync(outputDir, { recursive: true })

function findCli() {
  if (process.env.CX_CODEX_AGENT_BROWSER) return process.env.CX_CODEX_AGENT_BROWSER
  if (process.platform !== 'win32') return 'agent-browser'
  const paths = (process.env.PATH ?? '').split(path.delimiter)
  const binary = `agent-browser-win32-${process.arch}.exe`
  const candidates = paths.flatMap((directory) => [
    path.join(directory, 'agent-browser.exe'),
    path.join(directory, 'node_modules', 'agent-browser', 'bin', binary),
  ])
  const executable = candidates.find((candidate) => existsSync(candidate))
  assert.ok(executable, 'Set CX_CODEX_AGENT_BROWSER to the installed native agent-browser executable')
  return executable
}
const cli = findCli()
const results = []
const selectedScenarios = args.has('--only') ? new Set(args.get('--only').split(',')) : null
const unmatchedScenarios = new Set(selectedScenarios)
let browserStarted = false
let commandSequence = 0
const cliLogDir = path.join(outputDir, 'cli-logs')
mkdirSync(cliLogDir, { recursive: true })

function parseResponse(output) {
  const raw = String(output).replace(/^\uFEFF/u, '').trim()
  try { return JSON.parse(raw) } catch { /* Some CLI versions print a warning before JSON. */ }
  for (const line of raw.split(/\r?\n/u).reverse()) {
    try {
      const value = JSON.parse(line)
      if (value && typeof value.success === 'boolean') return value
    } catch { /* Try the previous output line. */ }
  }
  throw new Error(`agent-browser did not return JSON: ${raw.slice(0, 1500)}`)
}

function browser(...command) {
  // On Windows a cold CLI daemon may inherit pipe handles. File descriptors let
  // execFileSync finish when the command exits, without waiting for that daemon.
  const prefix = String(++commandSequence).padStart(4, '0')
  const stdoutPath = path.join(cliLogDir, `${prefix}-stdout.json`)
  const stderrPath = path.join(cliLogDir, `${prefix}-stderr.txt`)
  const stdout = openSync(stdoutPath, 'w')
  const stderr = openSync(stderrPath, 'w')
  let commandError
  try {
    execFileSync(cli, ['--session', session, '--json', ...command], {
      encoding: 'utf8', timeout: 45_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      stdio: ['ignore', stdout, stderr],
    })
  } catch (error) {
    commandError = error
  } finally {
    closeSync(stdout)
    closeSync(stderr)
  }
  const output = readFileSync(stdoutPath, 'utf8')
  if (commandError) {
    const failure = (() => { try { return parseResponse(output) } catch { return null } })()
    throw new Error(`agent-browser ${command[0]}: ${failure?.error || readFileSync(stderrPath, 'utf8').trim() || commandError.message}`)
  }
  const response = parseResponse(output)
  assert.equal(response.success, true, `agent-browser ${command[0]}: ${JSON.stringify(response.error)}`)
  return response.data
}

function evaluate(body) {
  const script = `(async () => { ${body}\n})()`
  return browser('eval', '-b', Buffer.from(script).toString('base64')).result
}

const settle = 'await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));'
function setCase(name) {
  return evaluate(`window.getSelection()?.removeAllRanges(); await window.__CX_REPLY_QUALITY__.setCase(${JSON.stringify(name)}); ${settle} return window.__CX_REPLY_QUALITY__.snapshot();`)
}
function screenshot(name) { browser('screenshot', path.join(outputDir, `${name}.png`)) }
function waitFor(condition) { browser('wait', '--fn', condition) }
function resetReading() {
  evaluate(`window.getSelection()?.removeAllRanges(); document.activeElement?.blur(); return true;`)
  const hasReturn = evaluate('return Boolean(document.querySelector(".conversation-jump-to-latest"));')
  if (hasReturn) browser('click', '.conversation-jump-to-latest')
  evaluate(`${settle} return true;`)
}
function scenario(name, verify) {
  if (selectedScenarios && !selectedScenarios.has(name)) return
  unmatchedScenarios.delete(name)
  try {
    const evidence = verify()
    results.push({ name, passed: true, evidence })
    process.stdout.write(`PASS ${name}\n`)
  } catch (error) {
    results.push({ name, passed: false, error: error.message })
    process.stdout.write(`FAIL ${name}: ${error.message}\n`)
    try { screenshot(`${name}-failure`) } catch { /* Keep the original assertion. */ }
  }
}

function layoutEvidence() {
  return evaluate(`
    const root = document.querySelector('.reply-quality-fixture');
    const scroller = root.querySelector('.transcript-list');
    const text = root.querySelector('.assistant-turn .message-markdown');
    const blockScrollers = [...root.querySelectorAll('.rich-text-table, .message-markdown pre')];
    return { ...window.__CX_REPLY_QUALITY__.snapshot(),
      width: innerWidth, height: innerHeight, transcriptOverflow: scroller.scrollWidth > scroller.clientWidth + 1,
      bodyFontSize: text ? getComputedStyle(text).fontSize : null,
      headingsText: [...root.querySelectorAll('.message-markdown h2, .message-markdown h3')].map(node => node.textContent),
      links: [...root.querySelectorAll('.message-markdown a')].map(node => ({ text: node.textContent, href: node.getAttribute('href'), title: node.title, target: node.target, rel: node.rel })),
      taskCheckboxes: [...root.querySelectorAll('.rich-text-task-checkbox')].map(node => ({ checked: node.checked, disabled: node.disabled })),
      math: {
        count: root.querySelectorAll('.rich-text-math .katex').length,
        sources: [...root.querySelectorAll('.rich-text-math annotation')].map(node => node.textContent),
        text: text?.textContent ?? '',
        codeMathCount: root.querySelectorAll('pre .katex, code .katex').length,
        inlineCodes: [...root.querySelectorAll('p > code')].map(node => node.textContent),
        unsafeNodes: root.querySelectorAll('.rich-text-math a, .rich-text-math image, .rich-text-math script, .rich-text-math foreignObject').length,
        fontReady: document.fonts.check('16px KaTeX_Main'),
        displays: [...root.querySelectorAll('.rich-text-math-display')].map(node => ({ width: node.clientWidth, contentWidth: node.scrollWidth, overflow: getComputedStyle(node).overflowX, focusable: node.tabIndex === 0 })),
      },
      blockScrollers: blockScrollers.map(node => ({ width: node.clientWidth, contentWidth: node.scrollWidth, overflow: getComputedStyle(node).overflowX })),
      actions: [...root.querySelectorAll('.message-actions button, .rich-text-code-copy')].map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })),
    };
  `)
}

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 393, height: 852 },
  { name: 'foldable', width: 884, height: 1104 },
]
const cases = ['short', 'markdown', 'code', 'table', 'math', 'process', 'reading']
const expectedCodeSources = [
  "type Status = 'running' | 'completed'\n\nexport function describeStatus(status: Status): string {\n  return status === 'running' ? '正在处理' : '已完成'\n}\n",
  '{\n  "status": "completed",\n  "verified": true\n}\n',
]
const lightCodeColors = new Map()

function codeHighlightEvidence() {
  return evaluate(`
    return [...document.querySelectorAll('.assistant-turn .message-markdown pre code')].map(code => ({
      text: code.textContent,
      spans: code.querySelectorAll('span[class*="hljs-"]').length,
      foreground: getComputedStyle(code).color,
      keywordColor: code.querySelector('.hljs-keyword') ? getComputedStyle(code.querySelector('.hljs-keyword')).color : null,
      tokenColors: [...new Set([...code.querySelectorAll('span[class*="hljs-"]')].map(span => getComputedStyle(span).color))],
      unexpectedMarkup: [...code.querySelectorAll('*')].some(node => node.tagName !== 'SPAN'),
    }));
  `)
}

function waitForHighlightedCode(count = 2) {
  waitFor(`document.querySelectorAll('.assistant-turn .message-markdown pre code').length === ${count} && [...document.querySelectorAll('.assistant-turn .message-markdown pre code')].every(code => code.querySelector('span[class*="hljs-"]'))`)
}

try {
  browserStarted = true
  browser('open', 'about:blank')
  browser('network', 'route', '**/codex-api/**', '--abort')
  baseUrl.hash = '/__regression/reply-quality?case=short'
  browser('open', baseUrl.href)
  waitFor('Boolean(window.__CX_REPLY_QUALITY__)')

  for (const viewport of viewports) {
    browser('set', 'viewport', String(viewport.width), String(viewport.height))
    browser('set', 'media', 'light')
    evaluate('window.__CX_REPLY_QUALITY__.setTheme("light"); return true;')
    for (const sample of cases) {
      scenario(`${viewport.name}-${sample}`, () => {
        setCase(sample)
        if (sample === 'math') evaluate('await document.fonts.ready; return true;')
        const evidence = layoutEvidence()
        assert.equal(evidence.projectedTurns, 1)
        assert.equal(evidence.pageOverflow, false)
        assert.equal(evidence.transcriptOverflow, false)
        assert.equal(evidence.bodyFontSize, '16px')
        if (sample === 'markdown') {
          assert.ok(evidence.headingsText.includes('三、关键验证结果'))
          assert.ok(evidence.headingsText.length >= 3)
          assert.ok(evidence.lists >= 3, 'Nested ordered/unordered lists must render')
          assert.deepEqual(evidence.taskCheckboxes, [{ checked: true, disabled: true }, { checked: false, disabled: true }])
        }
        if (sample === 'code') assert.ok(evidence.codeBlocks > 0)
        if (sample === 'math') {
          for (const source of ['E=mc^2', 'a^2+b^2=c^2', '\\frac{1}{2}+\\sqrt{x}=\\int_0^1 t^2\\,dt']) assert.ok(evidence.math.sources.includes(source), `Missing formula: ${source}`)
          assert.ok(evidence.math.sources.some(source => source.includes('pmatrix')), 'Matrix MathML survives sanitization')
          assert.ok(evidence.math.count >= 5)
          assert.ok(evidence.math.text.includes('$5 and $10'))
          assert.ok(evidence.math.text.includes('未闭合公式：\\(x^2 +'))
          assert.equal(evidence.math.codeMathCount, 0)
          assert.ok(evidence.math.inlineCodes.includes('$x^2$'), 'Currency must not consume the following inline code')
          assert.equal(evidence.math.unsafeNodes, 0)
          assert.equal(evidence.math.fontReady, true)
          assert.ok(evidence.math.displays.every(item => item.overflow === 'auto' && item.focusable))
          if (viewport.name === 'phone') assert.ok(evidence.math.displays.some(item => item.contentWidth > item.width), 'Long formula scrolls inside its region')
        }
        if (sample === 'table') {
          assert.equal(evidence.tables, 1)
          assert.ok(evidence.blockScrollers.every(item => ['auto', 'scroll'].includes(item.overflow)))
          if (viewport.name === 'phone') assert.ok(evidence.blockScrollers.some(item => item.contentWidth > item.width))
          const localLink = evidence.links.find(link => link.text === '本地文件示例')
          assert.ok(localLink?.href.startsWith('/local-preview.html?path='), 'Local links must use the restricted preview, never execute raw same-origin HTML')
          assert.equal(new URL(localLink.href, baseUrl).searchParams.get('path'), 'E:/workspace/example/src/main.ts')
          assert.equal(localLink.title, 'E:/workspace/example/src/main.ts:12')
          for (const link of evidence.links) {
            assert.equal(link.target, '_blank')
            assert.ok(link.rel.includes('noopener') && link.rel.includes('noreferrer'))
          }
        }
        if (viewport.name === 'phone') assert.ok(evidence.actions.every(action => action.width >= 44 && action.height >= 44), 'Phone actions need 44px targets')
        evaluate(`const scroller = document.querySelector('.transcript-list'); scroller.scrollTop = 0; ${settle} return true;`)
        screenshot(`${viewport.name}-${sample}`)
        return evidence
      })
    }

    scenario(`${viewport.name}-stream-identity-selection`, () => {
      setCase('code')
      const before = evaluate(`
        window.__CX_REPLY_QUALITY__.markStableNode();
        const node = document.querySelector('.assistant-turn .message-markdown p');
        const range = document.createRange(); range.selectNodeContents(node);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        ${settle} return window.__CX_REPLY_QUALITY__.snapshot();
      `)
      assert.ok(before.selection.length > 0)
      const after = evaluate(`for (let index = 0; index < 8; index++) await window.__CX_REPLY_QUALITY__.stepStream(); ${settle} return window.__CX_REPLY_QUALITY__.snapshot();`)
      assert.equal(after.markedNodeConnected, true)
      assert.equal(after.markedNodeTextUnchanged, true)
      assert.equal(after.selection, before.selection)
      assert.equal(after.codeBlocks, 2)
      resetReading()
      evaluate(`await window.__CX_REPLY_QUALITY__.finishStream(); ${settle} return true;`)
      screenshot(`${viewport.name}-stream-completed`)
      return { before, after }
    })

    scenario(`${viewport.name}-syntax-colors-exact-copy`, () => {
      setCase('code')
      evaluate(`await window.__CX_REPLY_QUALITY__.finishStream(); ${settle} return true;`)
      waitForHighlightedCode()
      const highlighting = codeHighlightEvidence()
      assert.deepEqual(highlighting.map(code => code.text), expectedCodeSources)
      assert.ok(highlighting.every(code => code.spans > 0 && !code.unexpectedMarkup))
      assert.ok(highlighting[0].keywordColor && highlighting[0].keywordColor !== highlighting[0].foreground, 'Keywords must have a visible syntax color in light mode')
      assert.ok(highlighting[0].tokenColors.length >= 2, 'Code needs more than a single undifferentiated token color')
      lightCodeColors.set(viewport.name, highlighting[0].keywordColor)
      const copy = evaluate(`
        const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        const copied = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied.push(text); } } });
        try {
          const buttons = [...document.querySelectorAll('.assistant-turn .rich-text-code-copy')];
          for (const button of buttons) {
            button.click();
            const deadline = performance.now() + 3000;
            while (button.disabled || button.getAttribute('aria-label') !== '代码已复制') {
              if (performance.now() > deadline) throw new Error('Code copy feedback did not settle');
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
          }
          return { copied, labels: buttons.map(button => button.getAttribute('aria-label')), clipboardEvidence: 'isolated writeText argument capture; not OS readback' };
        } finally {
          if (original) Object.defineProperty(navigator, 'clipboard', original);
          else Reflect.deleteProperty(navigator, 'clipboard');
        }
      `)
      assert.deepEqual(copy.copied, expectedCodeSources, 'Highlighted markup, language labels and copy labels must never enter the copied source')
      assert.deepEqual(copy.labels, ['代码已复制', '代码已复制'])
      screenshot(`${viewport.name}-syntax-highlighted`)
      return { highlighting, copy }
    })

    scenario(`${viewport.name}-syntax-stream-no-stale-output`, () => {
      setCase('code')
      const before = evaluate(`
        window.__CX_REPLY_QUALITY__.markStableNode();
        return { snapshot: window.__CX_REPLY_QUALITY__.snapshot(), code: document.querySelector('.assistant-turn .message-markdown pre code')?.textContent };
      `)
      // This fixture enters through the real projection, whose readString trims
      // the unfinished assistant message. The highlighter must preserve the
      // rendered code, not restore whitespace that never reached this renderer.
      assert.ok(before.code && expectedCodeSources[0].startsWith(before.code))
      waitForHighlightedCode(1)
      const initialHighlighted = codeHighlightEvidence()
      assert.equal(initialHighlighted[0].text, before.code, 'Highlighting must preserve the actual pre-highlight text, including its whitespace')
      const streamed = evaluate(`
        const frames = [];
        for (let index = 0; index < 8; index++) {
          await window.__CX_REPLY_QUALITY__.stepStream();
          frames.push([...document.querySelectorAll('.assistant-turn .message-markdown pre code')].map(code => code.textContent));
        }
        await window.__CX_REPLY_QUALITY__.finishStream();
        ${settle}
        return { frames, snapshot: window.__CX_REPLY_QUALITY__.snapshot() };
      `)
      assert.equal(streamed.snapshot.markedNodeConnected, true)
      assert.equal(streamed.snapshot.markedNodeTextUnchanged, true)
      assert.equal(streamed.snapshot.turnState, 'completed')
      for (const frame of streamed.frames) {
        assert.ok(frame.length >= 1 && frame.length <= 2)
        for (const [index, source] of frame.entries()) assert.ok(expectedCodeSources[index].startsWith(source), 'Streaming text must be an exact source prefix, never highlighted HTML')
      }
      for (let index = 1; index < streamed.frames.length; index++) {
        assert.ok(streamed.frames[index][0].length >= streamed.frames[index - 1][0].length, 'Late syntax output must not shorten the growing code')
      }
      waitForHighlightedCode()
      const settled = codeHighlightEvidence()
      assert.deepEqual(settled.map(code => code.text), expectedCodeSources, 'The latest worker result must match the current completed code')
      // Remove a highlighted message, then allow outstanding worker callbacks to settle.
      setCase('short')
      const replacement = evaluate(`
        await new Promise(resolve => setTimeout(resolve, 250));
        return { snapshot: window.__CX_REPLY_QUALITY__.snapshot(), staleCode: document.querySelectorAll('.message-markdown pre code, .message-markdown span[class*="hljs-"]').length };
      `)
      assert.equal(replacement.staleCode, 0)
      assert.equal(replacement.snapshot.pageOverflow, false)
      return { before, initialHighlighted, streamed, settled, replacement }
    })

    scenario(`${viewport.name}-process-details-completion`, () => {
      setCase('process')
      const initial = evaluate(`return { snapshot: window.__CX_REPLY_QUALITY__.snapshot(), prose: document.querySelectorAll('.commentary-block').length, commands: document.querySelectorAll('.activity-command').length, pulse: Boolean(document.querySelector('.execution-pulse')), pulseAnimation: getComputedStyle(document.querySelector('.execution-pulse')).animationName, elapsed: document.querySelector('.execution-elapsed')?.textContent };`)
      assert.ok(initial.prose > 0)
      assert.equal(initial.commands, 0)
      assert.equal(initial.pulse, true)
      if (!initial.snapshot.reducedMotion) assert.notEqual(initial.pulseAnimation, 'none')
      assert.match(initial.elapsed, /\d{2}:\d{2}/)
      browser('click', '.process-details-toggle')
      waitFor('document.querySelectorAll(".activity-command").length > 0')
      const details = evaluate('return [...document.querySelectorAll(".activity-command")].map(node => node.textContent);')
      screenshot(`${viewport.name}-process-details`)
      resetReading()
      evaluate(`await window.__CX_REPLY_QUALITY__.finishStream(); ${settle} return true;`)
      waitFor('document.querySelector(".process-toggle")?.getAttribute("aria-expanded") === "false" && !document.querySelector(".process-content")')
      assert.equal(evaluate('return Boolean(document.querySelector(".final-answer"));'), true)
      browser('click', '.process-toggle')
      waitFor('document.querySelector(".process-toggle")?.getAttribute("aria-expanded") === "true"')
      return { initial, details, completed: evaluate('return window.__CX_REPLY_QUALITY__.snapshot();') }
    })

    scenario(`${viewport.name}-reading-completion-protection`, () => {
      setCase('reading')
      const before = evaluate(`
        const scroller = document.querySelector('.transcript-list');
        scroller.scrollTop = Math.min(180, Math.max(0, scroller.scrollHeight - scroller.clientHeight - 100));
        scroller.dispatchEvent(new Event('scroll'));
        window.__CX_REPLY_QUALITY__.markStableNode('.commentary-copy p');
        const range = document.createRange(); range.selectNodeContents(document.querySelector('.commentary-copy p'));
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
        ${settle} return window.__CX_REPLY_QUALITY__.snapshot();
      `)
      const after = evaluate(`await window.__CX_REPLY_QUALITY__.stepStream(); await window.__CX_REPLY_QUALITY__.finishStream(); ${settle} return window.__CX_REPLY_QUALITY__.snapshot();`)
      assert.equal(after.turnState, 'completed')
      assert.equal(after.processExpanded, 'true')
      assert.equal(after.selection, before.selection)
      assert.equal(after.markedNodeConnected, true)
      assert.ok(Math.abs(after.scrollTop - before.scrollTop) < 8, `Reading anchor moved ${after.scrollTop - before.scrollTop}px`)
      screenshot(`${viewport.name}-reading-protected`)
      resetReading()
      waitFor('document.querySelector(".process-toggle")?.getAttribute("aria-expanded") === "false"')
      return { before, after, returned: evaluate('return window.__CX_REPLY_QUALITY__.snapshot();') }
    })

    scenario(`${viewport.name}-menus-keyboard`, () => {
      setCase('short')
      const opened = evaluate(`
        const buttons = [...document.querySelectorAll('.message-action[aria-haspopup="menu"]')];
        if (buttons.length < 2) throw new Error('Expected user and assistant menus');
        buttons[0].click(); ${settle} buttons[1].click(); ${settle}
        window.__replyQualityMenuTrigger = buttons[1];
        return { count: document.querySelectorAll('.conversation-message-menu').length, expanded: buttons.map(button => button.getAttribute('aria-expanded')) };
      `)
      assert.equal(opened.count, 1, 'Synthetic/assistive activation must keep one menu open')
      assert.deepEqual(opened.expanded, ['false', 'true'])
      browser('press', 'Escape')
      assert.deepEqual(evaluate('return { count: document.querySelectorAll(".conversation-message-menu").length, focusReturned: document.activeElement === window.__replyQualityMenuTrigger };'), { count: 0, focusReturned: true })
      browser('press', 'ArrowDown')
      waitFor('document.querySelectorAll(".conversation-message-menu").length === 1')
      assert.equal(evaluate('return document.querySelector(".conversation-message-menu")?.contains(document.activeElement);'), true, 'ArrowDown must place focus inside the now-visible menu')
      browser('press', 'Tab')
      assert.equal(evaluate('return document.querySelectorAll(".conversation-message-menu").length;'), 0)
      return opened
    })

    scenario(`${viewport.name}-copy-failure`, () => {
      setCase('short')
      evaluate('window.__CX_REPLY_QUALITY__.setCopyFailure(true); return true;')
      try {
        browser('click', '.final-answer button[aria-label="复制回复"]')
        waitFor('document.querySelector(".reply-quality-status")?.textContent.includes("复制失败")')
        const evidence = evaluate('return { snapshot: window.__CX_REPLY_QUALITY__.snapshot(), visibleFeedback: document.querySelector(".reply-quality-status").textContent, buttonEnabled: !document.querySelector(".final-answer button[aria-label=复制回复]").disabled };')
        assert.equal(evidence.snapshot.copyStatus?.tone, 'danger')
        assert.equal(evidence.buttonEnabled, true)
        screenshot(`${viewport.name}-copy-failure`)
        return evidence
      } finally { evaluate('window.__CX_REPLY_QUALITY__.setCopyFailure(false); return true;') }
    })

    scenario(`${viewport.name}-copy-success-then-failure`, () => {
      setCase('short')
      try {
        const evidence = evaluate(`
          const qa = window.__CX_REPLY_QUALITY__;
          const button = document.querySelector('.final-answer button[aria-label="复制回复"]');
          const until = async (predicate) => {
            const deadline = performance.now() + 3000;
            while (!predicate()) {
              if (performance.now() > deadline) throw new Error('Clipboard feedback did not settle');
              await new Promise(resolve => requestAnimationFrame(resolve));
            }
          };
          button.click();
          await until(() => button.getAttribute('aria-label') === '已复制' && !button.disabled);
          const successVisible = button.getAttribute('aria-label');
          qa.setCopyFailure(true);
          button.click();
          await until(() => qa.snapshot().copyStatus?.tone === 'danger' && !button.disabled);
          ${settle}
          return { successVisible, failedLabel: button.getAttribute('aria-label'), announcement: button.closest('.message-actions').querySelector('[role="status"]')?.textContent, feedback: qa.snapshot().copyStatus };
        `)
        assert.equal(evidence.successVisible, '已复制')
        assert.equal(evidence.failedLabel, '复制回复')
        assert.equal(evidence.announcement, '')
        assert.equal(evidence.feedback.tone, 'danger')
        return evidence
      } finally { evaluate('window.__CX_REPLY_QUALITY__.setCopyFailure(false); return true;') }
    })
  }

  scenario('phone-syntax-dense-near-limit', () => {
    browser('set', 'viewport', '393', '852')
    browser('set', 'media', 'light')
    setCase('code')
    const evidence = evaluate(`
      const qa = window.__CX_REPLY_QUALITY__;
      qa.setTheme('light');
      const fence = String.fromCharCode(96).repeat(3);
      if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) throw new Error('This browser does not expose Long Task observations');
      const source = 'const value = true;\\n'.repeat(1000);
      const startedAt = performance.now();
      const longTasks = [];
      const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().filter(entry => entry.startTime >= startedAt).map(entry => entry.duration)));
      observer.observe({ type: 'longtask', buffered: false });
      let heartbeats = 0;
      let heartbeatMaxDelayMs = 0;
      let lastBeatAt = startedAt;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        heartbeatMaxDelayMs = Math.max(heartbeatMaxDelayMs, now - lastBeatAt - 16);
        lastBeatAt = now;
        heartbeats += 1;
      }, 16);
      try {
        // Start rendering in a new task so the observer can include that task's
        // full duration instead of excluding an already-running eval task.
        await new Promise(resolve => setTimeout(resolve, 0));
        await qa.setCodeText('### 密集代码阅读样本\\n\\n说明段落应保持稳定。\\n\\n' + fence + 'javascript\\n' + source + fence);
        const code = document.querySelector('.assistant-turn .message-markdown pre code');
        if (!code) throw new Error('Dense code did not render');
        const beforeMatchesSource = code.textContent === source;
        const beforeLength = code.textContent.length;
        const deadline = performance.now() + 6000;
        while (code.dataset.highlighted !== 'true') {
          if (performance.now() > deadline) throw new Error('Dense code highlighting did not settle');
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        ${settle}
        longTasks.push(...observer.takeRecords().filter(entry => entry.startTime >= startedAt).map(entry => entry.duration));
        return {
          sourceLength: source.length, beforeLength, beforeMatchesSource,
          afterLength: code.textContent.length, afterMatchesSource: code.textContent === source,
          tokenCount: code.querySelectorAll('span[class*="hljs-"]').length,
          maxLongTaskMs: Math.max(0, ...longTasks), longTaskDurationsMs: longTasks,
          heartbeats, heartbeatMaxDelayMs, observationDurationMs: performance.now() - startedAt,
          performanceScope: 'setCodeText, render, async highlight and two layout frames; Long Tasks are browser-reported tasks >=50ms; heartbeat delay is separate scheduler evidence',
          snapshot: qa.snapshot(),
        };
      } finally {
        clearInterval(heartbeat);
        observer.disconnect();
      }
    `)
    assert.equal(evidence.sourceLength, 20_000)
    assert.equal(evidence.beforeMatchesSource, true)
    assert.equal(evidence.afterMatchesSource, true)
    assert.equal(evidence.beforeLength, evidence.afterLength)
    assert.ok(evidence.tokenCount >= 1_000)
    assert.ok(evidence.maxLongTaskMs < 80, `Dense code produced a ${evidence.maxLongTaskMs}ms main-thread Long Task`)
    assert.ok(evidence.heartbeats > 0, 'The event-loop observation must include heartbeat samples')
    assert.equal(evidence.snapshot.pageOverflow, false)
    evaluate(`const scroller = document.querySelector('.transcript-list'); scroller.scrollTop = 0; ${settle} return true;`)
    screenshot('phone-syntax-dense-near-limit')
    return evidence
  })

  scenario('phone-syntax-plaintext-fallbacks', () => {
    browser('set', 'viewport', '393', '852')
    setCase('code')
    const evidence = evaluate(`
      const qa = window.__CX_REPLY_QUALITY__;
      const fence = String.fromCharCode(96).repeat(3);
      const samples = [
        { name: 'unknown', language: 'not-a-supported-language', source: '<raw onerror="example"> & unchanged\\n' },
        { name: 'unlabeled', language: '', source: 'const untouched = true;\\n' },
        { name: 'oversized', language: 'javascript', source: 'const value = true;\\n'.repeat(1000) + '\\n' },
      ];
      const results = [];
      for (const sample of samples) {
        await qa.setCodeText(fence + sample.language + '\\n' + sample.source + fence);
        const code = document.querySelector('.assistant-turn .message-markdown pre code');
        const beforeMatchesSource = code?.textContent === sample.source;
        await new Promise(resolve => setTimeout(resolve, 300));
        results.push({
          name: sample.name, sourceLength: sample.source.length, beforeMatchesSource,
          afterMatchesSource: code?.textContent === sample.source,
          tokens: code?.querySelectorAll('span[class*="hljs-"]').length,
          unexpectedMarkup: code?.querySelectorAll('*').length,
          feedback: qa.snapshot().copyStatus, pageOverflow: qa.snapshot().pageOverflow,
        });
      }
      return results;
    `)
    assert.deepEqual(evidence.map(sample => sample.name), ['unknown', 'unlabeled', 'oversized'])
    for (const sample of evidence) {
      assert.equal(sample.beforeMatchesSource, true, sample.name)
      assert.equal(sample.afterMatchesSource, true, sample.name)
      assert.equal(sample.tokens, 0, sample.name)
      assert.equal(sample.unexpectedMarkup, 0, sample.name)
      assert.equal(sample.feedback, null, 'Expected plaintext fallback must not trigger an error alert')
      assert.equal(sample.pageOverflow, false, sample.name)
    }
    assert.equal(evidence[2].sourceLength, 20_001)
    return evidence
  })

  scenario('phone-syntax-selection-preserved', () => {
    browser('set', 'viewport', '393', '852')
    setCase('code')
    const evidence = evaluate(`
      const qa = window.__CX_REPLY_QUALITY__;
      const fence = String.fromCharCode(96).repeat(3);
      const source = 'const value = true;\\n'.repeat(100);
      await qa.setCodeText(fence + 'javascript\\n' + source + fence + '\\n\\n' + fence + 'json\\n{"selectionGuard":true}\\n' + fence);
      const code = document.querySelector('.assistant-turn .message-markdown pre code');
      const textNode = code?.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) throw new Error('Selection setup must run before the asynchronous coloring task');
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(60, textNode.textContent.length));
      const selection = window.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      const beforeSelection = selection.toString();
      try {
        const deadline = performance.now() + 6000;
        while (document.querySelectorAll('.assistant-turn .message-markdown pre code')[1]?.dataset.highlighted !== 'true') {
          if (performance.now() > deadline) throw new Error('Unselected sentinel highlighting did not settle');
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        ${settle}
        return {
          beforeSelection, afterSelection: selection.toString(), selectedNodeConnected: textNode.isConnected,
          selectedSourceUnchanged: code.textContent === source,
          selectedBlockColored: code.dataset.highlighted === 'true',
          sentinelTokens: document.querySelectorAll('.assistant-turn .message-markdown pre code')[1].querySelectorAll('span[class*="hljs-"]').length,
          snapshot: qa.snapshot(),
        };
      } finally { selection.removeAllRanges(); }
    `)
    assert.ok(evidence.beforeSelection.length > 0)
    assert.equal(evidence.afterSelection, evidence.beforeSelection)
    assert.equal(evidence.selectedNodeConnected, true)
    assert.equal(evidence.selectedSourceUnchanged, true)
    assert.ok(evidence.sentinelTokens > 0, 'The worker must finish other work while the selected block remains untouched')
    assert.equal(evidence.snapshot.pageOverflow, false)
    return evidence
  })

  scenario('reduced-motion-process', () => {
    browser('set', 'media', 'light', 'reduced-motion')
    setCase('process')
    const evidence = evaluate(`return { reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, animationName: getComputedStyle(document.querySelector('.execution-pulse')).animationName };`)
    assert.equal(evidence.reducedMotion, true)
    assert.equal(evidence.animationName, 'none')
    screenshot('reduced-motion-process')
    return evidence
  })
  scenario('math-stream-delimiters', () => {
    resetReading()
    const stages = []
    for (const source of ['$$x', '$$x$', '$$x$$']) {
      evaluate(`await window.__CX_REPLY_QUALITY__.setCodeText(${JSON.stringify(source)}); ${settle} return true;`)
      const evidence = layoutEvidence()
      stages.push({ source, mathCount: evidence.math.count, text: evidence.math.text })
    }
    assert.deepEqual(stages.map(stage => stage.mathCount), [0, 0, 1])
    assert.equal(stages[1].text.trimEnd(), '$$x$')
    return stages
  })
  scenario('math-currency-preserves-markdown', () => {
    const source = '价格 $10；**重要**；结果$x+1$。'
    evaluate(`await window.__CX_REPLY_QUALITY__.setCodeText(${JSON.stringify(source)}); ${settle} return true;`)
    const evidence = evaluate(`const root = document.querySelector('.assistant-turn .message-markdown'); return { text: root.textContent, bold: root.querySelector('strong')?.textContent, formulas: [...root.querySelectorAll('annotation')].map(node => node.textContent) };`)
    assert.ok(evidence.text.includes('价格 $10；'))
    assert.equal(evidence.bold, '重要')
    assert.deepEqual(evidence.formulas, ['x+1'])
    return evidence
  })
  scenario('math-code-delimiters-stay-literal', () => {
    const results = []
    for (const [opening, closing] of [['\\(', '\\)'], ['\\[', '\\]'], ['$$', '$$']]) {
      const source = `未闭合 ${opening}x；代码 \`${closing}\`；**重点**。`
      evaluate(`await window.__CX_REPLY_QUALITY__.setCodeText(${JSON.stringify(source)}); ${settle} return true;`)
      const evidence = evaluate(`const root = document.querySelector('.assistant-turn .message-markdown'); return { text: root.textContent, code: root.querySelector('code')?.textContent, bold: root.querySelector('strong')?.textContent, count: root.querySelectorAll('.katex').length };`)
      assert.equal(evidence.code, closing)
      assert.equal(evidence.bold, '重点')
      assert.equal(evidence.count, 0)
      assert.ok(evidence.text.includes(opening))
      results.push(evidence)
    }
    return results
  })
  scenario('phone-math-inline-scroll-keyboard', () => {
    browser('set', 'viewport', '393', '852')
    const source = String.raw`行内公式 $\underbrace{a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a+a}_{verylongformula}$ 后续正文。`
    evaluate(`await window.__CX_REPLY_QUALITY__.setCodeText(${JSON.stringify(source)}); await document.fonts.ready; ${settle} return true;`)
    waitFor('document.querySelector(".rich-text-math:not(.rich-text-math-display)")?.tabIndex === 0')
    const evidence = evaluate(`const formula = document.querySelector('.rich-text-math:not(.rich-text-math-display)'); const transcript = document.querySelector('.transcript-list'); return { formulaWidth: formula.clientWidth, formulaContentWidth: formula.scrollWidth, overflow: getComputedStyle(formula).overflowX, transcriptWidth: transcript.clientWidth, transcriptContentWidth: transcript.scrollWidth, pageWidth: document.documentElement.clientWidth, pageContentWidth: document.documentElement.scrollWidth };`)
    assert.ok(evidence.formulaContentWidth > evidence.formulaWidth + 1)
    assert.equal(evidence.overflow, 'auto')
    assert.ok(evidence.transcriptContentWidth <= evidence.transcriptWidth + 1)
    assert.ok(evidence.pageContentWidth <= evidence.pageWidth + 1)
    browser('focus', '.rich-text-math:not(.rich-text-math-display)')
    browser('press', 'ArrowRight')
    waitFor('document.querySelector(".rich-text-math:not(.rich-text-math-display)").scrollLeft > 0')
    evidence.keyboardScrollLeft = evaluate('return document.querySelector(".rich-text-math:not(.rich-text-math-display)").scrollLeft;')
    screenshot('phone-math-inline-scroll')
    browser('set', 'viewport', '1440', '900')
    waitFor('!document.querySelector(".rich-text-math:not(.rich-text-math-display)").hasAttribute("tabindex")')
    evidence.fitsWideViewport = true
    browser('set', 'viewport', '393', '852')
    const unbrokenSource = `行内公式 $${'x'.repeat(160)}$ 后续正文。`
    evaluate(`await window.__CX_REPLY_QUALITY__.setCodeText(${JSON.stringify(unbrokenSource)}); ${settle} return true;`)
    waitFor('document.querySelector(".rich-text-math:not(.rich-text-math-display)")?.tabIndex === 0')
    const unbroken = evaluate(`const formula = document.querySelector('.rich-text-math:not(.rich-text-math-display)'); const transcript = document.querySelector('.transcript-list'); return { formulaWidth: formula.clientWidth, formulaContentWidth: formula.scrollWidth, transcriptWidth: transcript.clientWidth, transcriptContentWidth: transcript.scrollWidth, pageWidth: document.documentElement.clientWidth, pageContentWidth: document.documentElement.scrollWidth };`)
    assert.ok(unbroken.formulaContentWidth > unbroken.formulaWidth + 1)
    assert.ok(unbroken.transcriptContentWidth <= unbroken.transcriptWidth + 1)
    assert.ok(unbroken.pageContentWidth <= unbroken.pageWidth + 1)
    return { underbrace: evidence, unbroken }
  })
  scenario('math-macro-budget-readable-fallback', () => {
    const source = '$\\def\\chunk{' + 'x'.repeat(1000) + '}' + '\\chunk'.repeat(60) + '$'
    const evidence = evaluate(`const source = ${JSON.stringify(source)}; const start = performance.now(); let heartbeatDelay; const heartbeat = new Promise(resolve => setTimeout(() => { heartbeatDelay = performance.now() - start; resolve(); }, 0)); await window.__CX_REPLY_QUALITY__.setCodeText(source); await heartbeat; ${settle} const root = document.querySelector('.assistant-turn .message-markdown'); return { duration: performance.now() - start, heartbeatDelay, count: root.querySelectorAll('.katex').length, source: root.querySelector('.rich-text-math-source')?.textContent };`)
    assert.equal(evidence.count, 0)
    assert.equal(evidence.source, source)
    assert.ok(evidence.heartbeatDelay < 500, `Rejected macro input blocked the event loop for ${evidence.heartbeatDelay}ms`)
    return evidence
  })
  for (const sample of ['markdown', 'code', 'math']) {
    scenario(`dark-${sample}`, () => {
      browser('set', 'media', 'dark')
      setCase(sample)
      evaluate(`window.__CX_REPLY_QUALITY__.setTheme('dark'); ${settle} return true;`)
      const evidence = evaluate('return { ...window.__CX_REPLY_QUALITY__.snapshot(), background: getComputedStyle(document.querySelector(".reply-quality-fixture")).backgroundColor, foreground: getComputedStyle(document.querySelector(".assistant-turn .message-markdown")).color, userShellBackground: getComputedStyle(document.querySelector(".user-message")).backgroundColor, userBodyRadius: getComputedStyle(document.querySelector(".user-message-body")).borderRadius };')
      assert.equal(evidence.theme, 'dark')
      assert.notEqual(evidence.background, 'rgb(255, 255, 255)')
      assert.equal(evidence.pageOverflow, false)
      assert.ok(['transparent', 'rgba(0, 0, 0, 0)'].includes(evidence.userShellBackground), 'User action row must remain outside the colored bubble in dark mode')
      assert.equal(evidence.userBodyRadius, '16px')
      screenshot(`dark-${sample}`)
      return evidence
    })
  }
  scenario('dark-syntax-colors-preserve-source', () => {
    browser('set', 'media', 'dark')
    setCase('code')
    evaluate(`window.__CX_REPLY_QUALITY__.setTheme('dark'); await window.__CX_REPLY_QUALITY__.finishStream(); ${settle} return true;`)
    waitForHighlightedCode()
    const highlighting = codeHighlightEvidence()
    assert.deepEqual(highlighting.map(code => code.text), expectedCodeSources)
    assert.ok(highlighting.every(code => code.spans > 0 && !code.unexpectedMarkup))
    assert.ok(highlighting[0].keywordColor && highlighting[0].keywordColor !== highlighting[0].foreground, 'Dark mode must retain distinct syntax colors')
    assert.notEqual(highlighting[0].keywordColor, lightCodeColors.get('foldable'), 'Dark mode must use its own readable token palette')
    assert.ok(highlighting[0].tokenColors.length >= 2)
    screenshot('dark-syntax-highlighted')
    return highlighting
  })
} catch (error) {
  results.push({ name: 'browser-harness', passed: false, error: error.message })
  process.stderr.write(`${error.stack ?? error.message}\n`)
} finally {
  if (unmatchedScenarios.size > 0) results.push({ name: 'scenario-selection', passed: false, error: `Unknown scenarios: ${[...unmatchedScenarios].join(', ')}` })
  if (browserStarted) {
    try { browser('close') } catch (error) { results.push({ name: 'session-cleanup', passed: false, error: error.message }) }
  }
  const report = { baseUrl: baseUrl.href, session, generatedAt: new Date().toISOString(), selectedScenarios: selectedScenarios ? [...selectedScenarios] : null, fixtureOnly: true, realSendLatencyMeasured: false, passed: results.length > 0 && results.every(result => result.passed), results }
  writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${report.passed ? 'PASS' : 'FAIL'} ${results.filter(result => result.passed).length}/${results.length}; report: ${path.join(outputDir, 'report.json')}\n`)
  if (!report.passed) process.exitCode = 1
}
