import assert from 'node:assert/strict'
import test from 'node:test'
import katex from 'katex'
import { renderConversationMath } from '../src/components/content/conversationMathRendering.js'

function renderCalls(source: string, display = false): { html: string | null; calls: number } {
  const original = katex.renderToString
  let calls = 0
  katex.renderToString = (...args) => { calls += 1; return original(...args) }
  try {
    return { html: renderConversationMath(source, display), calls }
  } finally {
    katex.renderToString = original
  }
}

test('the reviewed 1,374-character macro bomb is rejected before invoking KaTeX', (t) => {
  const source = '\\def\\chunk{' + 'x'.repeat(1_000) + '}' + '\\chunk'.repeat(60)
  assert.equal(source.length + 2, 1_374)
  const start = performance.now()
  const result = renderCalls(source)
  t.diagnostic(JSON.stringify({ sourceCharacters: source.length + 2, htmlCharacters: result.html?.length ?? 0, calls: result.calls, elapsedMs: Math.round(performance.now() - start) }))
  assert.ok(result.html === null, 'Macro definitions must retain their source')
  assert.equal(result.calls, 0, 'Reject unsafe work before synchronous KaTeX rendering')
})

test('definition, assignment and expansion primitives cannot bypass the resource gate', () => {
  for (const source of [
    String.raw`\def\chunk{x}\chunk`, String.raw`\gdef\chunk{x}\chunk`,
    String.raw`\edef\chunk{x}\chunk`, String.raw`\xdef\chunk{x}\chunk`,
    String.raw`\newcommand{\chunk}{x}\chunk`, String.raw`\renewcommand{\alpha}{x}\alpha`,
    String.raw`\providecommand{\chunk}{x}\chunk`, String.raw`\let\chunk=\alpha\chunk`,
    String.raw`\futurelet\chunk\alpha\beta`, String.raw`\global\def\chunk{x}`,
    String.raw`\long\def\chunk{x}`, String.raw`\expandafter\def\chunk{x}`,
    String.raw`\noexpand\def\chunk{x}`, String.raw`\csname def\endcsname\chunk{x}`,
    String.raw`\catcode\%=12`, String.raw`\scantokens{\def\chunk{x}}`,
  ]) {
    const result = renderCalls(source)
    assert.ok(result.html === null, source)
    assert.equal(result.calls, 0, source)
  }
})

test('comments and escaped tokens cannot hide resource-changing commands', () => {
  for (const source of [
    '% prefix\n\\def\\chunk{x}\\chunk',
    String.raw`\%\def\chunk{x}\chunk`,
    String.raw`\\\def\chunk{x}\chunk`,
    String.raw`\verb\foo\\def\chunk{x}\chunk`,
    'x % \\def\\commented{x}\n +1',
  ]) {
    const result = renderCalls(source)
    assert.ok(result.html === null, source)
    assert.equal(result.calls, 0, source)
  }
  const escaped = renderCalls(String.raw`\begin{matrix}x \\def\end{matrix}`, true)
  assert.equal(escaped.calls, 1)
  assert.match(escaped.html!, /class="katex"/u)
})

test('private indirect definition and argument-amplification helpers are never invoked', () => {
  for (const source of [
    '\\tag{' + 'x'.repeat(500) + '}' + '\\df@tag'.repeat(20),
    String.raw`\bra@ket{x}{y}{z}{w}{||||}`, String.raw`\tag@literal{x}`,
    String.raw`\@ifnextchar{x}{y}{z}`, String.raw`\message{x}`, String.raw`\show\alpha`,
  ]) {
    const result = renderCalls(source, true)
    assert.ok(result.html === null, source)
    assert.equal(result.calls, 0, source)
  }
})

test('normal built-in formulas retain MathML, display mode and per-call isolation', () => {
  for (const source of [
    'E=mc^2', String.raw`\frac{1}{2}+\sqrt{x}+\int_0^1 t\,dt`,
    String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`, String.raw`\underbrace{x+x}_{n}`,
    String.raw`\Braket{x|y}`, String.raw`\text{default definition}`, String.raw`x\%+1`,
    'x% ordinary comment\n+1',
  ]) {
    const result = renderCalls(source)
    assert.equal(result.calls, 1, source)
    assert.match(result.html!, /class="katex"/u, source)
    assert.match(result.html!, /<math[\s>]/u, source)
  }
  assert.match(renderConversationMath(String.raw`x+1\tag{1}`, true)!, /class="katex-display"/u)
  assert.equal(renderConversationMath(String.raw`\chunk`, false), null)
})

test('work and nesting limits reject excessive input before invoking KaTeX', () => {
  for (const source of [
    'x'.repeat(8_001), '{'.repeat(40) + 'x' + '}'.repeat(40),
    String.raw`\sqrt`.repeat(300) + '{x}',
  ]) {
    const result = renderCalls(source)
    assert.ok(result.html === null)
    assert.equal(result.calls, 0)
  }
})

test('invalid formulas and untrusted HTML commands retain safe rendering behavior', () => {
  assert.equal(renderConversationMath(String.raw`\unknown{x}`, false), null)
  assert.equal(renderConversationMath(String.raw`\frac{1}{`, false), null)
  for (const source of [String.raw`\href{javascript:alert(1)}{x}`, String.raw`\includegraphics{https://example.invalid/x}`, String.raw`\htmlStyle{background:url(https://example.invalid)}{x}`]) {
    const html = renderConversationMath(source, false) ?? ''
    assert.doesNotMatch(html, /<(?:script|img|iframe|a)\b|(?:href|src)=|style="[^"]*url\(/u)
  }
})
