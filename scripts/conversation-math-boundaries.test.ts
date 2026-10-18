import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationRichTextRenderer } from '../src/components/content/conversationRichText.js'

const htmlFor = (source: string) => createConversationRichTextRenderer((html) => html)(source).map((block) => block.html).join('')
const mathCount = (html: string) => (html.match(/class="katex"/gu) ?? []).length

test('currency before Chinese or English formulas preserves prose, emphasis and the real formula', () => {
  for (const source of [
    '价格 $10；**重要**；结果$x+1$。',
    'Price $10;**important**;formula$x+1$.',
    'Price $10 dollars; **important**; formula$x+1$.',
    '价格 $10元，**重要**；结果$x+1$。',
    '价格 $10.50，**重要**；结果$x+1$。',
  ]) {
    const html = htmlFor(source)
    assert.equal(mathCount(html), 1, source)
    assert.match(html, /x\+1<\/annotation>/u, source)
    assert.match(html, /<strong>(?:重要|important)<\/strong>/u, source)
    assert.ok(html.includes('$10'), source)
  }
})

test('numeric expressions and normal inline boundaries still render', () => {
  const html = htmlFor('$2+2$；$10$；$1.5$；$2 x$；$2 + 2$；$2 \\times 3$；$2xy$；$2 xy$；$2*3$；$2_3$；$2<3$；$2>3$；$1, 2$；$3!$；$3!!$；$1:2$；$2;3$；结果$x+1$。')
  assert.equal(mathCount(html), 18)
})

test('every math delimiter stops before Markdown code spans', () => {
  for (const [open, close] of [['$', '$'], ['$$', '$$'], ['\\(', '\\)'], ['\\[', '\\]']]) {
    const source = `未闭合 ${open}x；示例 \`${close}\`；**重点**。`
    const html = htmlFor(source)
    assert.equal(mathCount(html), 0, source)
    assert.ok(html.includes(`<code>${close}</code>`), source)
    assert.match(html, /<strong>重点<\/strong>/u, source)
    assert.ok(html.includes(`${open}x`), source)
  }
  // Three TeX nonbreaking spaces in a formula are not a Markdown fence.
  assert.equal(mathCount(htmlFor(String.raw`$a~~~b$；\(a~~~b\)；\[a~~~b\]`)), 3)
})

test('display blocks cannot consume a closing delimiter from fenced code', () => {
  for (const [open, close] of [['$$', '$$'], ['\\[', '\\]']]) {
    for (const fence of ['```', '~~~']) {
      const source = `${open}\nx+1\n\n${fence}latex\n${close}\n${fence}\n\n**后续**`
      const html = htmlFor(source)
      assert.equal(mathCount(html), 0, source)
      assert.ok(html.includes(`>${close}\n</code>`), source)
      assert.match(html, /<pre[^>]*><code(?:\s[^>]*)?>/u, source)
      assert.match(html, /<strong>后续<\/strong>/u, source)
    }
  }
})

test('code boundaries do not prevent later valid math or remove escaped delimiter text', () => {
  const source = String.raw`未闭合 \(x；示例 \`\)\`；随后 $y+1$。转义 \$z\$。`.replace(/\\`/gu, '`')
  const html = htmlFor(source)
  assert.equal(mathCount(html), 1)
  assert.ok(html.includes(String.raw`<code>\)</code>`))
  assert.match(html, /y\+1<\/annotation>/u)
  assert.ok(html.includes('$z$'))
})

test('many unfinished delimiters preserve all source and a following completed formula', () => {
  const prefix = String.raw`\(x `.repeat(20_000)
  const html = htmlFor(`${prefix}\n\n后续 **正文** $y+1$。`)
  assert.ok(html.includes(prefix.trimEnd()))
  assert.equal(mathCount(html), 1)
  assert.match(html, /后续 <strong>正文<\/strong>/u)
})
