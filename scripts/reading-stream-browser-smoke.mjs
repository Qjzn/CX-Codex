import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Read-only fixture verification. No credentials, real messages, production
// mutations, Playwright/CDP attachment, or shared browser cleanup.
const options = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]
  assert.ok(['--base-url', '--output-dir', '--session'].includes(name) && value && !value.startsWith('--'), `Invalid argument ${name}`)
  options.set(name, value)
}
const baseUrl = new URL(options.get('--base-url') ?? 'http://127.0.0.1:17423')
assert.ok(['http:', 'https:'].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password)
const outputDir = path.resolve(options.get('--output-dir') ?? 'output/reading-stream-browser')
const session = options.get('--session') ?? `cx-reading-stream-${process.pid}`
assert.match(session, /^[a-zA-Z0-9_-]+$/)
const executable = process.env.CX_CODEX_AGENT_BROWSER ?? (process.platform === 'win32'
  ? (process.env.PATH ?? '').split(path.delimiter).map(directory => path.join(directory, 'node_modules/agent-browser/bin', `agent-browser-win32-${process.arch}.exe`)).find(candidate => existsSync(candidate))
  : 'agent-browser')
assert.ok(executable, 'Set CX_CODEX_AGENT_BROWSER to the native agent-browser executable')
mkdirSync(path.join(outputDir, 'cli-logs'), { recursive: true })
let commandCount = 0
let started = false
const results = []
const mediaEnvironments = []

function parseOutput(text) {
  const raw = text.replace(/^\uFEFF/u, '').trim()
  try { return JSON.parse(raw) } catch { /* CLI warnings may precede JSON. */ }
  for (const line of raw.split(/\r?\n/u).reverse()) {
    try {
      const result = JSON.parse(line)
      if (typeof result?.success === 'boolean') return result
    } catch { /* Try the next complete output line. */ }
  }
  throw new Error(`Invalid agent-browser output: ${raw.slice(0, 1000)}`)
}

function browser(...command) {
  const prefix = path.join(outputDir, 'cli-logs', String(++commandCount).padStart(4, '0'))
  const out = openSync(`${prefix}.json`, 'w')
  const err = openSync(`${prefix}.txt`, 'w')
  let error
  try {
    execFileSync(executable, ['--session', session, '--json', ...command], {
      timeout: 45_000, windowsHide: true, stdio: ['ignore', out, err],
    })
  } catch (failure) { error = failure } finally { closeSync(out); closeSync(err) }
  const result = parseOutput(readFileSync(`${prefix}.json`, 'utf8'))
  assert.ok(!error && result.success, `agent-browser ${command[0]}: ${result.error || error?.message}`)
  return result.data
}
function evaluate(body) {
  return browser('eval', '-b', Buffer.from(`(async () => { ${body}\n})()`).toString('base64')).result
}
const frames = 'await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));'
function reset(sample) {
  return evaluate(`window.getSelection()?.removeAllRanges(); document.activeElement?.blur(); await window.__CX_REPLY_QUALITY__.setCase(${JSON.stringify(sample)}); ${frames} return window.__CX_REPLY_QUALITY__.snapshot();`)
}
function screenshot(name) { browser('screenshot', path.join(outputDir, `${name}.png`)) }
function scenario(name, run) {
  let evidence
  try {
    evidence = run()
    results.push({ name, passed: true, evidence })
    process.stdout.write(`PASS ${name}\n`)
  } catch (error) {
    evidence = error.evidence ?? evidence
    results.push({ name, passed: false, error: error.message, evidence })
    process.stdout.write(`FAIL ${name}: ${error.message}\n`)
    try { screenshot(`${name}-failure`) } catch { /* Keep the first failure. */ }
  }
}
function verify(evidence, check) {
  try { check(evidence) } catch (error) { error.evidence = evidence; throw error }
  return evidence
}

try {
  started = true
  browser('open', 'about:blank')
  browser('set', 'media', 'light')
  browser('network', 'route', '**/codex-api/**', '--abort')
  browser('open', `${baseUrl.origin}/#/__regression/reply-quality`)
  browser('wait', '--fn', 'Boolean(window.__CX_REPLY_QUALITY__)')
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900, reducedMotion: false },
    { name: 'phone', width: 393, height: 852, reducedMotion: false },
    { name: 'desktop-reduced', width: 1440, height: 900, reducedMotion: true },
    { name: 'phone-reduced', width: 393, height: 852, reducedMotion: true },
  ]) {
    browser('set', 'viewport', String(viewport.width), String(viewport.height))
    browser('set', 'media', 'light', ...(viewport.reducedMotion ? ['reduced-motion'] : []))
    const media = evaluate('return { reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, coarsePointer: matchMedia("(pointer: coarse)").matches, userAgent: navigator.userAgent };')
    assert.equal(media.reducedMotion, viewport.reducedMotion, 'The browser must honor the requested motion preference')
    mediaEnvironments.push({ viewport: viewport.name, ...media })
    scenario(`${viewport.name}-growing-code-selection`, () => {
      reset('code')
      const evidence = evaluate(`
        const qa = window.__CX_REPLY_QUALITY__;
        const fence = String.fromCharCode(96).repeat(3);
        const prefix = '### 流式代码选区\\n\\n选中代码第一行时，后续增量不应清除选区。\\n\\n' + fence + 'typescript\\n';
        let source = 'const selectedValue = 42;\\n';
        await qa.setCodeText(prefix + source);
        ${frames}
        const code = document.querySelector('.assistant-turn pre code');
        const range = document.createRange(); range.selectNodeContents(code);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        const selected = selection.toString();
        ${frames}
        const samples = [];
        for (let index = 0; index < 8; index++) {
          source += 'const nextValue' + index + ' = ' + index + ';\\n';
          const begin = performance.now();
          await qa.setCodeText(prefix + source);
          ${frames}
          samples.push({ selection: selection.toString(), sameCodeNode: code.isConnected, dataToPaintMs: performance.now() - begin });
        }
        const finalSource = source;
        await qa.setCodeText(prefix + source + fence + '\\n\\n输出完成。');
        await qa.finishStream(); ${frames}
        const after = { selection: selection.toString(), source: document.querySelector('.assistant-turn pre code')?.textContent, sameCodeNode: code.isConnected, snapshot: qa.snapshot() };
        const releasedAt = performance.now();
        selection.removeAllRanges();
        while (document.querySelector('.assistant-turn pre code')?.textContent !== finalSource && performance.now() - releasedAt < 250) {
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        ${frames}
        const released = { source: document.querySelector('.assistant-turn pre code')?.textContent, catchUpMs: performance.now() - releasedAt, blockCount: document.querySelectorAll('.assistant-turn pre code').length };
        return { selected, samples, finalSource, after, released };
      `)
      return verify(evidence, ({ selected, samples, finalSource, after, released }) => {
        assert.ok(selected.includes('selectedValue'))
        assert.ok(samples.every(sample => sample.selection === selected && sample.sameCodeNode), 'Appending to a selected code block cleared its selection or replaced its DOM')
        assert.equal(after.selection, selected, 'Finishing the stream changed the code selection')
        assert.equal(after.sameCodeNode, true, 'Selected code DOM must survive completion')
        assert.equal(released.source, finalSource, 'Releasing selection must reveal the complete buffered code tail')
        assert.ok(released.catchUpMs <= 250, 'Releasing a selected block did not catch up promptly')
        assert.equal(released.blockCount, 1, 'Catch-up must not mount a duplicate code block')
        assert.equal(after.snapshot.pageOverflow, false)
      })
    })
    scenario(`${viewport.name}-growing-paragraph-selection`, () => {
      reset('code')
      const evidence = evaluate(`
        const qa = window.__CX_REPLY_QUALITY__;
        let text = '正在核对发送与恢复状态，这一段仍在逐步输出。';
        await qa.setCodeText(text); ${frames}
        const paragraph = document.querySelector('.assistant-turn .message-markdown p');
        const selectedText = paragraph.firstChild;
        const range = document.createRange(); range.setStart(selectedText, 0); range.setEnd(selectedText, 8);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        const before = selection.toString(); ${frames}
        const samples = [];
        for (let index = 0; index < 8; index++) {
          text += ' 继续检查第 ' + (index + 1) + ' 项。';
          await qa.setCodeText(text); ${frames}
          samples.push({ selection: selection.toString(), nodeConnected: selectedText.isConnected });
        }
        const result = { before, samples, expectedText: text };
        const releasedAt = performance.now();
        selection.removeAllRanges();
        while (document.querySelector('.assistant-turn .message-markdown p')?.textContent !== text && performance.now() - releasedAt < 250) {
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
        ${frames}
        return { ...result, actualText: document.querySelector('.assistant-turn .message-markdown p')?.textContent, catchUpMs: performance.now() - releasedAt };
      `)
      return verify(evidence, ({ before, samples, actualText, expectedText, catchUpMs }) => {
        assert.ok(before.length > 0)
        assert.ok(samples.every(sample => sample.selection === before && sample.nodeConnected), 'Appending to the currently selected paragraph cleared the selection or replaced its DOM')
        assert.equal(actualText, expectedText)
        assert.ok(catchUpMs <= 250)
      })
    })
    scenario(`${viewport.name}-history-completion-anchor`, () => {
      reset('reading')
      // Keyboard PageUp represents real user scroll intent; the fixture only
      // provides output, not an alternate scroll/reading implementation.
      browser('focus', '.transcript-list')
      browser('press', 'PageUp')
      const evidence = evaluate(`
        const qa = window.__CX_REPLY_QUALITY__;
        ${frames}
        const scroller = document.querySelector('.transcript-list');
        const bounds = scroller.getBoundingClientRect();
        const anchor = [...document.querySelectorAll('.commentary-copy p')].find(node => { const rect = node.getBoundingClientRect(); return rect.top >= bounds.top && rect.bottom <= bounds.bottom; });
        if (!anchor) throw new Error('No fully visible historical paragraph for a valid anchor');
        const range = document.createRange(); range.selectNodeContents(anchor);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); ${frames}
        const before = { selected: selection.toString(), top: anchor.getBoundingClientRect().top, scrollTop: scroller.scrollTop, bottomDistance: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight };
        const samples = [];
        for (let index = 0; index < 12; index++) {
          await qa.stepStream(); ${frames}
          samples.push({ top: anchor.getBoundingClientRect().top, selected: selection.toString(), connected: anchor.isConnected });
        }
        await qa.finishStream(); ${frames}
        const after = { top: anchor.getBoundingClientRect().top, selected: selection.toString(), connected: anchor.isConnected, snapshot: qa.snapshot(), returnAvailable: Boolean(document.querySelector('.conversation-jump-to-latest')) };
        selection.removeAllRanges(); return { before, samples, after };
      `)
      screenshot(`${viewport.name}-history-protected`)
      verify(evidence, ({ before, samples, after }) => {
        assert.ok(before.selected.length > 0)
        assert.ok(before.bottomDistance > 88, 'The reader must genuinely be away from the live tail')
        assert.ok(samples.every(sample => sample.connected && Math.abs(sample.top - before.top) < 8 && sample.selected === before.selected), 'Streaming stole the historical paragraph anchor')
        assert.ok(after.connected && Math.abs(after.top - before.top) < 8)
        assert.equal(after.selected, before.selected)
        assert.equal(after.snapshot.turnState, 'completed')
        assert.equal(after.snapshot.processExpanded, 'true')
        assert.equal(after.returnAvailable, true)
      })
      browser('click', '.conversation-jump-to-latest')
      browser('wait', '--fn', 'document.querySelector(".process-toggle")?.getAttribute("aria-expanded") === "false"')
      return evidence
    })
    scenario(`${viewport.name}-follow-long-code`, () => {
      reset('code')
      const evidence = evaluate(`
        const qa = window.__CX_REPLY_QUALITY__;
        const fence = String.fromCharCode(96).repeat(3);
        let code = 'export const initial = 0;\\n';
        await qa.setCodeText(fence + 'typescript\\n' + code); ${frames}
        const jump = document.querySelector('.conversation-jump-to-latest'); if (jump) jump.click(); ${frames}
        const scroller = document.querySelector('.transcript-list');
        const samples = []; const blocks = [];
        const observer = typeof PerformanceObserver === 'function' ? new PerformanceObserver(list => blocks.push(...list.getEntries().map(entry => entry.duration))) : null;
        try { observer?.observe({ type: 'longtask', buffered: false }); } catch { /* Unsupported engines report no long-task samples. */ }
        for (let index = 0; index < 35; index++) {
          code += 'export const streamed' + index + ' = ' + index + ';\\n';
          const begin = performance.now(); await qa.setCodeText(fence + 'typescript\\n' + code); ${frames}
          samples.push({ bottomDistance: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight, dataToPaintMs: performance.now() - begin });
        }
        await qa.setCodeText(fence + 'typescript\\n' + code + fence); await qa.finishStream(); ${frames}
        observer?.disconnect();
        return { samples, maxLongTaskMs: Math.max(0, ...blocks), finalCode: document.querySelector('.assistant-turn pre code')?.textContent, expectedCode: code, snapshot: qa.snapshot() };
      `)
      screenshot(`${viewport.name}-following-code`)
      return verify(evidence, ({ samples, maxLongTaskMs, finalCode, expectedCode, snapshot }) => {
        assert.ok(samples.every(sample => Math.abs(sample.bottomDistance) <= 88), 'A reader following the live tail stopped following')
        assert.ok(samples.every(sample => sample.dataToPaintMs < 250), 'Fixture input-to-paint exceeded 250 ms')
        assert.ok(maxLongTaskMs < 80, `Observed a ${maxLongTaskMs} ms main-thread long task`)
        assert.equal(finalCode, expectedCode)
        assert.equal(snapshot.pageOverflow, false)
      })
    })
    scenario(`${viewport.name}-history-during-growing-code`, () => {
      reset('code')
      evaluate(`
        const fence = String.fromCharCode(96).repeat(3);
        window.__readingCodePrefix = Array.from({ length: 18 }, (_, index) => '第 ' + (index + 1) + ' 段已完成说明：阅读这段内容时，后方代码应继续接收增量，但不能抢夺当前的位置。').join('\\n\\n') + '\\n\\n' + fence + 'typescript\\n';
        window.__readingCodeSource = 'const streamStart = 0;\\n';
        await window.__CX_REPLY_QUALITY__.setCodeText(window.__readingCodePrefix + window.__readingCodeSource); ${frames} return true;
      `)
      browser('focus', '.transcript-list')
      browser('press', 'PageUp')
      const evidence = evaluate(`
        const qa = window.__CX_REPLY_QUALITY__;
        ${frames}
        const scroller = document.querySelector('.transcript-list');
        const bounds = scroller.getBoundingClientRect();
        const anchor = [...document.querySelectorAll('.assistant-turn .message-markdown p')].find(node => { const rect = node.getBoundingClientRect(); return rect.top >= bounds.top && rect.bottom <= bounds.bottom; });
        if (!anchor) throw new Error('No visible completed paragraph for growing-code anchor');
        const range = document.createRange(); range.selectNodeContents(anchor);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); ${frames}
        const before = { selected: selection.toString(), top: anchor.getBoundingClientRect().top, bottomDistance: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight };
        const samples = [];
        for (let index = 0; index < 25; index++) {
          window.__readingCodeSource += 'const background' + index + ' = ' + index + ';\\n';
          await qa.setCodeText(window.__readingCodePrefix + window.__readingCodeSource); ${frames}
          samples.push({ top: anchor.getBoundingClientRect().top, selected: selection.toString(), connected: anchor.isConnected });
        }
        await qa.setCodeText(window.__readingCodePrefix + window.__readingCodeSource + String.fromCharCode(96).repeat(3)); await qa.finishStream(); ${frames}
        const after = { top: anchor.getBoundingClientRect().top, selected: selection.toString(), connected: anchor.isConnected, source: document.querySelector('.assistant-turn pre code')?.textContent, snapshot: qa.snapshot() };
        selection.removeAllRanges();
        return { before, samples, after, expectedCode: window.__readingCodeSource };
      `)
      screenshot(`${viewport.name}-history-growing-code`)
      return verify(evidence, ({ before, samples, after, expectedCode }) => {
        assert.ok(before.bottomDistance > 88)
        assert.ok(samples.every(sample => sample.connected && Math.abs(sample.top - before.top) < 8 && sample.selected === before.selected))
        assert.equal(after.selected, before.selected)
        assert.ok(after.connected && Math.abs(after.top - before.top) < 8)
        assert.equal(after.source, expectedCode, 'Unselected code must continue updating while a different paragraph is selected')
        assert.equal(after.snapshot.pageOverflow, false)
      })
    })
    scenario(`${viewport.name}-long-history-streaming-anchor`, () => {
      browser('open', `${baseUrl.origin}/#/__regression/conversation-blocks?longTurns=1`)
      browser('wait', '--fn', 'document.querySelector(".transcript-list")?.dataset.turnCount === "801"')
      browser('click', '[data-testid="focus-long-message"]')
      browser('wait', '--fn', 'Boolean(document.querySelector("[data-message-id=fixture-long-final-400]"))')
      const evidence = evaluate(`
        ${frames}
        const scroller = document.querySelector('.transcript-list');
        const anchor = document.querySelector('[data-message-id="fixture-long-final-400"] .message-markdown p');
        const metrics = document.querySelector('[data-testid="conversation-streaming-stress-status"]');
        if (!anchor) throw new Error('The requested 401st turn is not mounted');
        const range = document.createRange(); range.selectNodeContents(anchor);
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); ${frames}
        const before = { top: anchor.getBoundingClientRect().top, selected: selection.toString(), updateCount: Number(metrics.dataset.updateCount) };
        const samples = []; const longTasks = [];
        const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)));
        observer.observe({ type: 'longtask', buffered: false });
        const end = performance.now() + 1800;
        while (performance.now() < end) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          samples.push({ top: anchor.getBoundingClientRect().top, connected: anchor.isConnected, selection: selection.toString(), mountedTurns: Number(scroller.dataset.mountedTurnCount), mountedMessages: scroller.querySelectorAll('.user-message, .assistant-turn').length });
        }
        observer.disconnect();
        const after = { updateCount: Number(metrics.dataset.updateCount), heartbeatCount: Number(metrics.dataset.heartbeatCount), maxHeartbeatLagMs: Number(metrics.dataset.maxHeartbeatLagMs), turnCount: Number(scroller.dataset.turnCount), maxLongTaskMs: Math.max(0, ...longTasks), pageOverflow: document.documentElement.scrollWidth > innerWidth };
        selection.removeAllRanges(); return { before, samples, after };
      `)
      screenshot(`${viewport.name}-801-turn-history`)
      return verify(evidence, ({ before, samples, after }) => {
        assert.equal(after.turnCount, 801)
        assert.ok(after.updateCount - before.updateCount >= 20, 'Continuous real fixture updates must occur during the observation')
        assert.ok(samples.every(sample => sample.connected && Math.abs(sample.top - before.top) < 8 && sample.selection === before.selected), 'Virtualization/streaming moved the historical message being read')
        assert.ok(samples.every(sample => sample.mountedTurns <= 10 && sample.mountedMessages <= 20), 'Long history exceeded mounted DOM budget')
        assert.ok(after.maxLongTaskMs < 80)
        assert.equal(after.pageOverflow, false)
      })
    })
    browser('open', `${baseUrl.origin}/#/__regression/reply-quality`)
    browser('wait', '--fn', 'Boolean(window.__CX_REPLY_QUALITY__)')
  }
} catch (error) {
  results.push({ name: 'harness', passed: false, error: error.message })
  process.stderr.write(`${error.stack ?? error.message}\n`)
} finally {
  if (started) {
    try { browser('close') } catch (error) { results.push({ name: 'session-cleanup', passed: false, error: error.message }) }
  }
  const report = { generatedAt: new Date().toISOString(), baseUrl: baseUrl.origin, fixtureOnly: true, measuresModelOrTransportLatency: false, session, mediaEnvironments, passed: results.length > 0 && results.every(result => result.passed), results }
  writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${report.passed ? 'PASS' : 'FAIL'} ${results.filter(result => result.passed).length}/${results.length}; ${path.join(outputDir, 'report.json')}\n`)
  if (!report.passed) process.exitCode = 1
}
