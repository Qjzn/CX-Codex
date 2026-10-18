import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationRichTextRenderer } from '../src/components/content/conversationRichText.js'

const createRenderer = () => createConversationRichTextRenderer((html) => html)
const htmlFor = (text: string) => createRenderer()(text).map((block) => block.html).join('')
const mathCount = (html: string) => (html.match(/class="katex"/gu) ?? []).length

test('assistant formulas render inline and display math with accessible source', () => {
  const html = htmlFor(String.raw`行内 $E=mc^2$ 与 \(a^2+b^2=c^2\)。

$$
\frac{1}{2}+\sqrt{x}
$$

\[
\sum_{i=1}^{n} i
\]`)
  assert.equal(mathCount(html), 4)
  assert.equal((html.match(/class="katex-display"/gu) ?? []).length, 2)
  assert.match(html, /<math[\s>]/u)
  assert.match(html, /<annotation encoding="application\/x-tex">E=mc\^2<\/annotation>/u)
  assert.match(html, /行内 /u)
})

test('same-line display formulas and display math in lists and quotes retain structure', () => {
  const html = htmlFor(String.raw`$$x^2$$

- \(x+1\)
- 结果：
  \[
  \frac{a}{b}
  \]

> \[y=2\]

| 数值 | 公式 |
| --- | --- |
| 一 | $x+1$ |`)
  assert.equal(mathCount(html), 5)
  assert.match(html, /<ul>/u)
  assert.match(html, /<blockquote>/u)
  assert.match(html, /<table>/u)
  assert.match(html, /<td><span class="rich-text-math/u)
})

test('literal code, escaped dollars and normal currency remain unchanged', () => {
  const text = String.raw`Price $5 and $10. Escaped \$x\$ and \\(x\\).

Inline code: \`$x$ \(y\)\`.

\`\`\`latex
$$x$$
\(y\)
\`\`\``.replace(/\\`/gu, '`')
  const blocks = createRenderer()(text)
  const html = blocks.map((block) => block.html).join('')
  assert.equal(mathCount(html), 0)
  assert.match(html, /Price \$5 and \$10/u)
  assert.match(html, /Escaped \$x\$/u)
  assert.ok(html.includes(String.raw`<code>$x$ \(y\)</code>`))
  assert.deepEqual(blocks.flatMap((block) => block.code), ['$$x$$\n\\(y\\)\n'])
})

test('numeric math renders while whitespace and digit boundaries avoid consuming prices', () => {
  const html = htmlFor('$2+2$; $ x$; $x $; $5 and $10; US$20 and $30; $x$10')
  assert.equal(mathCount(html), 1)
  assert.match(html, /\$5 and \$10/u)
  assert.match(html, /US\$20 and \$30/u)
  assert.match(html, /\$x\$10/u)
})

test('currency cannot consume a following inline code span or later formula', () => {
  const html = htmlFor('价格保持原文：$5 and $10；行内代码 `$x^2$`。后续公式 $y+1$。')
  assert.match(html, /价格保持原文：\$5 and \$10；行内代码 <code>\$x\^2\$<\/code>/u)
  assert.equal(mathCount(html), 1)
  assert.match(html, /y\+1<\/annotation>/u)
})

test('unclosed and invalid formulas preserve readable source and following prose', () => {
  for (const source of [String.raw`before $x+1`, String.raw`before \(x+1`, String.raw`before \[x+1`, String.raw`$\unknowncommand{x}$`, String.raw`$\frac{1}{$`]) {
    const html = htmlFor(`${source}\n\n后续 **正文**`)
    assert.equal(mathCount(html), 0, source)
    assert.ok(html.includes(source), source)
    assert.match(html, /后续 <strong>正文<\/strong>/u)
  }
})

test('unfinished display math does not consume later Markdown blocks', () => {
  const html = htmlFor('$$\nx+1\n\n## 后续标题\n\n- 后续列表')
  assert.equal(mathCount(html), 0)
  assert.match(html, /<h2>后续标题<\/h2>/u)
  assert.match(html, /<li>后续列表<\/li>/u)
})

test('streamed delimiters settle into math while unchanged blocks retain their identity', () => {
  const render = createRenderer()
  const before = render('稳定正文\n\n公式 $x')
  assert.equal(mathCount(before[1]!.html), 0)
  const after = render('稳定正文\n\n公式 $x^2$')
  assert.equal(after[0], before[0])
  assert.equal(mathCount(after[1]!.html), 1)
  const changed = render('稳定正文\n\n公式 $x^3$')
  assert.notEqual(changed[1], after[1])
  assert.match(changed[1]!.html, /x\^3<\/annotation>/u)
  assert.equal(render('稳定正文\n\n公式 $x^3$'), changed)
})

test('streamed display delimiters stay literal until both closing dollars arrive', () => {
  const render = createRenderer()
  for (const source of ['$$x', '$$x$', '$x$$']) {
    const html = render(source).map((block) => block.html).join('')
    assert.equal(mathCount(html), 0, source)
    assert.ok(html.includes(source), source)
  }
  const completed = render('$$x$$').map((block) => block.html).join('')
  assert.equal(mathCount(completed), 1)
  assert.match(completed, /class="katex-display"/u)
})

test('math is sanitized separately without changing ordinary Markdown sanitizer scope', () => {
  const ordinary: string[] = []
  const formulas: string[] = []
  const render = createConversationRichTextRenderer((html) => { ordinary.push(html); return html }, (html) => { formulas.push(html); return html })
  const html = render('**正文** $x$').map((block) => block.html).join('')
  assert.equal(formulas.length, 1)
  assert.match(formulas[0]!, /<math[\s>]/u)
  assert.ok(ordinary.every((entry) => !entry.includes('<math')))
  assert.equal(mathCount(html), 1)
  assert.doesNotMatch(html, /data-rich-text-math/u)
})

test('user-authored placeholder lookalikes stay literal and cannot duplicate generated math', () => {
  const html = htmlFor('<span data-rich-text-math="0"></span>\n\n`<span data-rich-text-math="0"></span>` $x$')
  assert.equal(mathCount(html), 1)
  assert.match(html, /&lt;span data-rich-text-math=&quot;0&quot;&gt;&lt;\/span&gt;/u)
  assert.doesNotMatch(html, /<span data-rich-text-math=/u)
})

test('untrusted commands cannot create active HTML, links or network loads', () => {
  for (const formula of [String.raw`\href{javascript:alert(1)}{click}`, String.raw`\includegraphics{https://example.invalid/image.png}`, String.raw`\htmlClass{evil}{x}`, String.raw`\htmlStyle{background:url(https://example.invalid)}{x}`]) {
    const html = htmlFor(`$${formula}$`)
    assert.doesNotMatch(html, /<(?:script|img|iframe|a)\b|(?:href|src)=|class="evil"|style="[^"]*url\(/u)
  }
  const html = htmlFor('$<img src=x onerror=alert(1)>$')
  assert.doesNotMatch(html, /<img\b|<script\b/u)
})

test('oversized formulas and recursive expansion use bounded source fallback', () => {
  const large = `$${'x+'.repeat(5_000)}x$`
  const html = htmlFor(large)
  assert.equal(mathCount(html), 0)
  assert.ok(html.includes(large))
  const recursive = String.raw`$\def\loop{\loop}\loop$`
  assert.ok(htmlFor(recursive).includes(recursive))
})

test('custom macro definitions stay readable and never carry across formulas or messages', () => {
  const render = createRenderer()
  const definition = String.raw`$\gdef\private{x}\private$`
  const blocked = render(definition)[0]!.html
  assert.equal(mathCount(blocked), 0)
  assert.ok(blocked.includes(definition))
  const next = render(String.raw`$\private$`)[0]!.html
  assert.equal(mathCount(next), 0)
  assert.ok(next.includes(String.raw`$\private$`))
})
