import assert from 'node:assert/strict'
import test from 'node:test'
import { createConversationRichTextRenderer, retainSelectedRichTextBlocks, toConversationLocalFileLink } from '../src/components/content/conversationRichText.js'
import { MAX_HIGHLIGHT_CHARACTERS, normalizeCodeLanguage } from '../src/components/content/conversationCodeHighlight.js'
import { highlightConversationCode } from '../src/components/content/conversationCodeHighlightEngine.js'

const createRenderer = () => createConversationRichTextRenderer((html) => html)

test('selected growing block keeps its displayed identity while other blocks stream', () => {
  const render = createRenderer()
  const before = render('选中的段落\n\n```text\n初始代码\n```')
  const next = render('选中的段落继续增长\n\n```text\n初始代码\n新增代码\n```')
  const retained = retainSelectedRichTextBlocks(next, before, new Set([before[0]!.key]))
  assert.equal(retained[0], before[0])
  assert.equal(retained[1], next[1])
  assert.equal(retainSelectedRichTextBlocks(next, retained, new Set()), next, 'Release catches up without another network update')
})

test('selection across blocks preserves each visible block and code copy source until release', () => {
  const render = createRenderer()
  const before = render('第一段\n\n```text\n初始代码\n```')
  const next = render('第一段增长\n\n```text\n最新完整代码\n```\n\n后续段落')
  const retained = retainSelectedRichTextBlocks(next, before, new Set(before.map((block) => block.key)))
  assert.equal(retained[0], before[0])
  assert.equal(retained[1], before[1])
  assert.deepEqual(retained[1]!.code, ['初始代码\n'])
  assert.equal(retained[2], next[2])
  assert.equal(retainSelectedRichTextBlocks(next, retained, new Set()), next)
})

test('selected Markdown restructuring retains the mounted display only until release', () => {
  const render = createRenderer()
  const before = render('标题或段落')
  const next = render('标题或段落\n---\n\n新增正文')
  assert.notEqual(before[0]!.key, next[0]!.key)
  assert.equal(retainSelectedRichTextBlocks(next, before, new Set([before[0]!.key])), before)
  assert.equal(retainSelectedRichTextBlocks(next, before, new Set()), next)
  assert.equal(retainSelectedRichTextBlocks(next, [], new Set([before[0]!.key])), next, 'A newly mounted message has no previous selection cache')
})

function highlightedPlainText(html: string): string {
  const withoutSpans = html.replace(/<\/?span(?: class="[^"]*")?>/gu, '')
  assert.doesNotMatch(withoutSpans, /[<>]/u, 'Only span markup is permitted before decoding the original text')
  return withoutSpans.replace(/&(amp|lt|gt|quot|#x27);/gu, (_entity, name: string) => ({
    amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'",
  })[name]!)
}

test('code languages normalize supported aliases without auto-detecting unknown input', () => {
  const aliases: Record<string, string[]> = {
    javascript: ['javascript', 'js', 'jsx'],
    typescript: ['typescript', 'ts', 'tsx'],
    json: ['json'],
    bash: ['bash', 'sh', 'shell'],
    powershell: ['powershell', 'ps1', 'ps', 'pwsh'],
    python: ['python', 'py'],
    xml: ['xml', 'html', 'vue'],
    css: ['css'],
    sql: ['sql'],
    diff: ['diff', 'patch'],
    yaml: ['yaml', 'yml'],
  }
  for (const [language, values] of Object.entries(aliases)) {
    for (const value of values) {
      assert.equal(normalizeCodeLanguage(value), language, value)
      assert.equal(normalizeCodeLanguage(` ${value.toUpperCase()} `), language, value)
    }
  }
  for (const value of ['', 'text', 'plaintext', 'unknown-language', '__proto__', 'constructor', 'toString', '"><script>alert(1)</script>']) {
    assert.equal(normalizeCodeLanguage(value), null, value)
  }
})

test('every selected code grammar adds spans while retaining the exact source text', () => {
  const samples = {
    javascript: 'const message = "Hello 中文";\nconsole.log(message)\n',
    typescript: 'type State = "running" | "completed"\nconst ready: boolean = true\n',
    json: '{\n  "status": "completed",\n  "verified": true\n}\n',
    bash: '# A shell example\nprintf "%s\\n" "$value"\n',
    powershell: '# A PowerShell example\nWrite-Output "Hello $name"\n',
    python: 'def greet(name: str):\n    return f"Hello {name}"\n',
    xml: '<div class="sample">Hello &amp; 中文</div>\n',
    css: '.sample { color: red; display: flex; }\n',
    sql: 'SELECT name FROM examples WHERE enabled = TRUE;\n',
    diff: '+added line\n-removed line\n',
    yaml: 'status: completed\nverified: true\n',
  }
  for (const [language, code] of Object.entries(samples)) {
    const html = highlightConversationCode(code, language)
    assert.ok(html, language)
    assert.match(html, /class="hljs-/u, language)
    assert.equal(highlightedPlainText(html), code, language)
  }
})

test('code highlighting preserves tabs, CRLF, entities and HTML-looking strings without active markup', () => {
  const code = 'const text = "</code><img src=x onerror=alert(1)> &amp; & < > \\\" 中文";\r\n\tconsole.log(text)\r\n'
  const html = highlightConversationCode(code, 'javascript')
  assert.ok(html)
  assert.doesNotMatch(html, /<img|<script|<\/code>/iu)
  assert.equal(highlightedPlainText(html), code)
})

test('unlabeled, unknown, empty and oversized code uses a bounded plaintext fallback', () => {
  assert.equal(MAX_HIGHLIGHT_CHARACTERS, 20_000)
  for (const language of ['', 'unknown-language', 'plaintext']) {
    assert.equal(highlightConversationCode('const visible = true', language), null, language)
  }
  assert.equal(highlightConversationCode('', 'javascript'), null)
  const atLimit = `//${'x'.repeat(MAX_HIGHLIGHT_CHARACTERS - 2)}`
  const html = highlightConversationCode(atLimit, 'javascript')
  assert.ok(html)
  assert.equal(highlightedPlainText(html), atLimit)
  assert.equal(highlightConversationCode(`${atLimit}x`, 'javascript'), null)
  const [block] = createRenderer()('```unknown-language\n<raw> & text\n```')
  assert.deepEqual(block!.code, ['<raw> & text\n'])
  assert.match(block!.html, /&lt;raw&gt; &amp; text/u)
})

test('token-dense code near the size limit remains exact after highlighting', () => {
  const line = 'const value = true;\n'
  const code = line.repeat(Math.floor(MAX_HIGHLIGHT_CHARACTERS / line.length))
  assert.ok(code.length <= MAX_HIGHLIGHT_CHARACTERS && code.length >= MAX_HIGHLIGHT_CHARACTERS - line.length)
  const html = highlightConversationCode(code, 'javascript')
  assert.ok(html)
  assert.ok((html.match(/class="hljs-/gu) ?? []).length >= 1_000, 'Exercise dense token markup, not one long comment')
  assert.equal(highlightedPlainText(html), code)
})

test('headings, nested lists, ordered starts and quotes retain semantic HTML', () => {
  const blocks = createRenderer()('## 三、关键验证结果\n\n- 运行时间：7200 秒\n  - 嵌套内容\n\n3. 第三项\n4. 第四项\n\n> 引用 **文字**')
  assert.equal(blocks.length, 4)
  assert.match(blocks[0]!.html, /^<h2>三、关键验证结果<\/h2>/u)
  assert.match(blocks[1]!.html, /<ul>[\s\S]*?<ul>/u)
  assert.match(blocks[2]!.html, /<ol start="3">/u)
  assert.match(blocks[3]!.html, /<blockquote>[\s\S]*<strong>文字<\/strong>/u)
})

test('identical text skips parsing/sanitizing and appending keeps unchanged block objects', () => {
  let sanitizeCount = 0
  const render = createConversationRichTextRenderer((html) => { sanitizeCount += 1; return html })
  const initial = render('稳定的第一段。\n\n正在')
  assert.equal(sanitizeCount, 2)
  assert.equal(render('稳定的第一段。\n\n正在'), initial)
  assert.equal(sanitizeCount, 2)
  const next = render('稳定的第一段。\n\n正在生成新的正文。')
  assert.equal(next[0], initial[0])
  assert.notEqual(next[1], initial[1])
  assert.equal(sanitizeCount, 3)
})

test('later reference definitions update earlier links without stale frozen paragraphs', () => {
  const render = createRenderer()
  const before = render('请看[参考][doc]。\n\n下一段。')
  assert.doesNotMatch(before[0]!.html, /<a /u)
  const after = render('请看[参考][doc]。\n\n下一段。\n\n[doc]: https://example.com/reference')
  assert.match(after[0]!.html, /href="https:\/\/example.com\/reference"/u)
  assert.notEqual(after[0], before[0])
  assert.equal(after[1], before[1])
})

test('unfinished fences stay visible and their exact code grows before closing', () => {
  const render = createRenderer()
  const before = render('先说明。\n\n```ts\nconst value = 1')
  assert.equal(before[1]!.code[0], 'const value = 1')
  assert.match(before[1]!.html, /data-rich-text-copy="0"/u)
  const after = render('先说明。\n\n```ts\nconst value = 12\n```\n\n后续说明。')
  assert.equal(after[0], before[0])
  assert.equal(after[1]!.key, before[1]!.key)
  assert.equal(after[1]!.code[0], 'const value = 12\n')
  assert.equal(after.length, 3)
})

test('copy indexes are scoped per block and include nested and indented code', () => {
  const blocks = createRenderer()('- 内容\n\n  ```sh\n  printf "nested"\n  ```\n\n  ```js\n  const second = true\n  ```\n\n独立段落\n\n    indented code\n')
  assert.deepEqual(blocks[0]!.code, ['printf "nested"\n', 'const second = true\n'])
  assert.match(blocks[0]!.html, /data-rich-text-copy="0"[\s\S]*data-rich-text-copy="1"/u)
  assert.deepEqual(blocks[2]!.code, ['indented code\n'])
  assert.match(blocks[2]!.html, /data-rich-text-copy="0"/u)
})

test('tables get a keyboard-accessible local scroll region and preserve alignment', () => {
  const [block] = createRenderer()('| 名称 | 状态 |\n| --- | ---: |\n| 测试 | 通过 |')
  assert.match(block!.html, /^<div class="rich-text-table" role="region" aria-label="表格，可横向滚动" tabindex="0"><table>/u)
  assert.match(block!.html, /<th style="text-align:right">状态<\/th>/u)
  assert.match(block!.html, /<\/table><\/div>/u)
})

test('unsafe HTML and URLs cannot become executable renderer markup', () => {
  const blocks = createRenderer()('<img src=x onerror=alert(1)>\n\n[坏链接](javascript:alert%281%29)\n\n![图](javascript:alert%281%29)\n\n```"><script>alert(1)</script>\n</code><img src=x onerror=alert(1)>\n```')
  const html = blocks.map((block) => block.html).join('')
  assert.doesNotMatch(html, /<script|<img|href="javascript:|src="javascript:/u)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u)
  assert.match(html, /&lt;\/code&gt;/u)
})

test('normal links preserve existing new-tab isolation and inline images stay Markdown images', () => {
  const blocks = createRenderer()('[文档](https://example.com/docs)\n\n![图片](https://example.com/image.png)')
  assert.match(blocks[0]!.html, /target="_blank" rel="noopener noreferrer"/u)
  assert.match(blocks[1]!.html, /<img src="https:\/\/example.com\/image.png" alt="图片">/u)
})

test('sanitization is mandatory for every new HTML block and its output is retained', () => {
  const render = createConversationRichTextRenderer(() => '<p>已清洗</p>')
  const [block] = render('输入')
  assert.equal(block!.html, '<p>已清洗</p>')
})

test('replacement, empty text and paragraph-to-heading transitions discard stale blocks', () => {
  const render = createRenderer()
  const before = render('一个标题')
  const after = render('一个标题\n===')
  assert.notEqual(after[0]!.key, before[0]!.key)
  assert.match(after[0]!.html, /^<h1>/u)
  assert.deepEqual(render(''), [])
  assert.equal(render('全新内容').length, 1)
})

test('Windows and Unix absolute file links use the same-origin preview backed by authorized file reads', () => {
  assert.deepEqual(toConversationLocalFileLink('E:/workspace/report.md:24:3'), {
    href: '/local-preview.html?path=E%3A%2Fworkspace%2Freport.md',
    title: 'E:/workspace/report.md:24:3',
  })
  assert.deepEqual(toConversationLocalFileLink('/workspace/report.md:24'), {
    href: '/local-preview.html?path=%2Fworkspace%2Freport.md',
    title: '/workspace/report.md:24',
  })
  assert.equal(toConversationLocalFileLink('C:%5Cworkspace%5Cfile.ts')?.href, '/local-preview.html?path=C%3A%2Fworkspace%2Ffile.ts')
  const [block] = createRenderer()('[查看报告](<E:/工作区/报告 文件.md:24>)')
  assert.match(block!.html, /href="\/local-preview.html\?path=E%3A%2F%E5%B7%A5%E4%BD%9C%E5%8C%BA%2F%E6%8A%A5%E5%91%8A%20%E6%96%87%E4%BB%B6.md"/u)
  assert.match(block!.html, /title="E:\/工作区\/报告 文件.md:24"/u)
  assert.match(block!.html, />查看报告<\/a>/u)
  const [withTitle] = createRenderer()('[年度报告](E:/workspace/report.md:24 "补充说明")')
  assert.match(withTitle!.html, /title="补充说明\nE:\/workspace\/report.md:24"/u)
})

test('local file URI encoding preserves literal percent, query, fragment and quoted characters', () => {
  const path = 'E:/workspace/100% complete#draft?x="1".md'
  const link = toConversationLocalFileLink(encodeURI(path))
  assert.ok(link)
  assert.equal(new URL(link.href, 'https://example.invalid').searchParams.get('path'), path)
  assert.equal(toConversationLocalFileLink('E:/workspace/literal%2520name.md')?.href, '/local-preview.html?path=E%3A%2Fworkspace%2Fliteral%2520name.md')
  const [block] = createRenderer()('[文件](<E:/workspace/a%22b.md:2>)')
  assert.match(block!.html, /title="E:\/workspace\/a&quot;b.md:2"/u)
})

test('relative, UNC, unknown schemes, traversal and control paths never gain local-file capability', () => {
  for (const value of ['file:///E:/file.md', '//example.com/file', '\\\\server\\share\\file', 'relative/file.md', '../file.md', 'javascript:alert(1)', 'data:text/html,hello', 'vscode://file/test', 'E:/workspace/../secret', 'E:/bad%00name', 'E:/bad%0Aname', 'E:/bad%ZZname']) {
    assert.equal(toConversationLocalFileLink(value), null, value)
  }
  const html = createRenderer()('[坏链接](vscode://file/test)\n\n[数据](data:text/plain,hello)\n\n[脚本](javascript:alert%281%29)').map((block) => block.html).join('')
  assert.doesNotMatch(html, /href=|local-preview/u)
})

test('existing authorized preview links are not interpreted as filesystem paths again', () => {
  for (const href of ['/codex-local-file?path=E%3A%2Ffile.md&download=1', '/codex-local-browse/E:/file.md', '/local-preview.html?path=E%3A%2Ffile.md']) {
    assert.equal(toConversationLocalFileLink(href), null)
    const [block] = createRenderer()(`[文件](${href})`)
    assert.ok(block!.html.includes(`href="${href.replaceAll('&', '&amp;')}"`))
  }
})

test('explicit same-origin raw file reads become safe preview links with one query decode', () => {
  const href = '/codex-local-file?path=E%3A%2Fworkspace%2Fliteral%2520name.html%3A14&inline=1'
  assert.deepEqual(toConversationLocalFileLink(href), {
    href: '/local-preview.html?path=E%3A%2Fworkspace%2Fliteral%2520name.html',
    title: 'E:/workspace/literal%20name.html:14',
  })
  const [block] = createRenderer()(`[文档](${href} "用户说明")`)
  assert.match(block!.html, /href="\/local-preview.html\?path=E%3A%2Fworkspace%2Fliteral%2520name.html"/u)
  assert.match(block!.html, /title="用户说明\nE:\/workspace\/literal%20name.html:14"/u)
  assert.equal(toConversationLocalFileLink('/codex-local-file?path=relative.md'), null)
  assert.equal(toConversationLocalFileLink('/codex-local-file?path=E%3A%2Ffile.html&path=E%3A%2Fother.html'), null)
})

test('only genuine download links bypass the preview, not inline or duplicate parameter overrides', () => {
  const root = '/codex-local-file?path=E%3A%2Fworkspace%2Ffile.html'
  assert.equal(toConversationLocalFileLink(`${root}&download=1`), null)
  assert.equal(toConversationLocalFileLink(`${root}&download=1&inline=0`), null)
  for (const suffix of ['&download=0', '&download=1&inline=1', '&download=1&download=0']) {
    assert.equal(toConversationLocalFileLink(root + suffix)?.href, '/local-preview.html?path=E%3A%2Fworkspace%2Ffile.html')
  }
})

test('active local document formats never become top-level raw-file navigation', () => {
  for (const path of ['E:/workspace/example.html', 'E:/workspace/example.HTM:18', '/workspace/example.svg:12:4', '/workspace/example.SVG']) {
    const [block] = createRenderer()(`[查看](${path})`)
    assert.match(block!.html, /href="\/local-preview\.html\?path=/u, path)
    assert.doesNotMatch(block!.html, /href="\/codex-local-file/u, path)
    assert.ok(block!.html.includes(`title="${path}"`), path)
  }
})

test('task markers only become read-only checkboxes at actual list-item starts', () => {
  const blocks = createRenderer()('- [x] 已完成\n- [ ] 待处理\n  - [X] 子任务\n\n正文 [x] 保留\n\n> [ ] 引用保留\n\n```text\n- [x] 代码保留\n```')
  assert.equal((blocks[0]!.html.match(/type="checkbox" disabled/gu) ?? []).length, 3)
  assert.equal((blocks[0]!.html.match(/disabled checked/gu) ?? []).length, 2)
  assert.equal((blocks[0]!.html.match(/class="rich-text-task-item"/gu) ?? []).length, 3)
  assert.match(blocks[1]!.html, /正文 \[x\] 保留/u)
  assert.match(blocks[2]!.html, /\[ \] 引用保留/u)
  assert.deepEqual(blocks[3]!.code, ['- [x] 代码保留\n'])
  assert.doesNotMatch(blocks[3]!.html, /type="checkbox"/u)
})
