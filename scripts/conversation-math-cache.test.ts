import assert from 'node:assert/strict'
import test from 'node:test'
import katex from 'katex'
import { createConversationRichTextRenderer } from '../src/components/content/conversationRichText.js'

function withMathSpy(run: (calls: { count: number }) => void, result?: () => string): void {
  const original = katex.renderToString
  const calls = { count: 0 }
  katex.renderToString = (source, options) => {
    calls.count += 1
    return result ? result() : original(source, options)
  }
  try {
    run(calls)
  } finally {
    katex.renderToString = original
  }
}

const createRenderer = () => createConversationRichTextRenderer((html) => html)

test('the original 7494-character review sample appends one character without rerendering 100 matrices', () => {
  withMathSpy((calls) => {
    const render = createRenderer()
    const formula = String.raw`\begin{bmatrix}a&b&c&d\\e&f&g&h\\i&j&k&l\\m&n&o&p\end{bmatrix}`
    const source = Array.from({ length: 100 }, (_, index) => `段落 ${index}\n\n\\[${formula}\\]`).join('\n\n') + '\n\n正在生成'
    assert.equal(source.length, 7494)
    const first = render(source)
    const initialCalls = calls.count
    calls.count = 0
    const updated = render(`${source}新`)
    assert.equal(calls.count, 0, 'the original 100-matrix review case must execute zero unchanged KaTeX renders')
    assert.equal(initialCalls, 1, 'identical formulas in one message reuse their raw result')
    assert.equal(updated[1], first[1], 'the old matrix block HTML object remains reusable')
  })
})

test('appending streaming prose reuses 100 distinct matrix renders and block objects', () => {
  withMathSpy((calls) => {
    const render = createRenderer()
    const text = Array.from({ length: 100 }, (_, index) => String.raw`$\begin{pmatrix}${index}&b\\c&d\end{pmatrix}$`).join('\n\n')
    const first = render(text)
    assert.equal(calls.count, 100)
    const updated = render(`${text}\n\n新增字`)
    assert.equal(calls.count, 100, 'an ordinary streamed character must not execute the same KaTeX work again')
    assert.equal(updated[0], first[0], 'unchanged blocks retain their existing identity')
  })
})

test('identical formulas share one render but inline and display modes remain distinct', () => {
  withMathSpy((calls) => {
    const render = createRenderer()
    const html = render('$x+1$ and $x+1$\n\n$$x+1$$').map((block) => block.html).join('')
    assert.equal(calls.count, 2)
    assert.equal((html.match(/class="katex-display"/gu) ?? []).length, 1)
    render('$x+1$ and $x+1$\n\n$$x+1$$\n\n追加')
    assert.equal(calls.count, 2)
  })
})

test('changing a formula invalidates only that source', () => {
  withMathSpy((calls) => {
    const render = createRenderer()
    render('$x+1$\n\n$y+1$')
    const html = render('$x+2$\n\n$y+1$').map((block) => block.html).join('')
    assert.equal(calls.count, 3)
    assert.match(html, /x\+2<\/annotation>/u)
    assert.doesNotMatch(html, /x\+1<\/annotation>/u)
  })
})

test('failed formulas retain readable source without repeating the same failed render', () => {
  withMathSpy((calls) => {
    const render = createRenderer()
    const text = String.raw`$\notARealCommand{x}$`
    const first = render(text)
    assert.match(first[0]!.html, /rich-text-math-source/u)
    const updated = render(`${text}\n\n正文继续`)
    assert.equal(calls.count, 1)
    assert.equal(updated[0], first[0])
  })
})

test('a removed formula does not remain in the next message-render cache', () => {
  withMathSpy((calls) => {
    const render = createRenderer()
    render('$x$\n\n$y$')
    render('$x$\n\n正文')
    assert.equal(calls.count, 2)
    render('$x$\n\n$y$')
    assert.equal(calls.count, 3, 'removed y must be rendered again when reintroduced')
    render('普通正文')
    render('$x$')
    assert.equal(calls.count, 4, 'a render without math releases the prior formula cache')
  })
})

test('two mounted-message renderers do not share formula results', () => {
  withMathSpy((calls) => {
    const first = createRenderer()
    const second = createRenderer()
    first('$x$')
    second('$x$')
    assert.equal(calls.count, 2)
    first('$x$\n\n一')
    second('$x$\n\n二')
    assert.equal(calls.count, 2)
  })
})

test('a message with many formulas cannot retain more than 128 cached entries', () => {
  withMathSpy((calls) => {
    const render = createRenderer()
    const text = Array.from({ length: 300 }, (_, index) => `$x_{${index}}$`).join('\n\n')
    render(text)
    const firstCount = calls.count
    const updated = render(`${text}\n\n追加`)
    assert.ok(calls.count - firstCount >= 300 - 128, 'excess formula entries must not be retained')
    assert.ok(calls.count - firstCount < 300, 'budgeted formula entries are still reused')
    assert.equal(updated.length, 301, 'exceeding the cache budget must not omit content')
  })
})

test('large generated HTML is bounded by a character budget while output remains complete', () => {
  withMathSpy((calls) => {
    const render = createRenderer()
    const text = Array.from({ length: 10 }, (_, index) => `$z_{${index}}$`).join('\n\n')
    render(text)
    const firstCount = calls.count
    const updated = render(`${text}\n\n追加`)
    assert.ok(calls.count - firstCount >= 3, '512 Ki characters cannot retain ten 70 Ki character results')
    assert.ok(calls.count - firstCount < 10, 'results that fit the character budget are reused')
    assert.equal(updated.filter((block) => block.html.includes('M'.repeat(100))).length, 10)
  }, () => 'M'.repeat(70_000))
})
