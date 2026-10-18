import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import ts from 'typescript'

const productionUrl = new URL('../src/localPreview.ts', import.meta.url)
const source = readFileSync(productionUrl, 'utf8')
const ast = ts.createSourceFile('localPreview.ts', source, ts.ScriptTarget.Latest, true)
const mainStatement = ast.statements.find((statement) => ts.isExpressionStatement(statement)
  && ts.isVoidExpression(statement.expression) && ts.isCallExpression(statement.expression.expression)
  && statement.expression.expression.expression.getText(ast) === 'main')
assert.ok(mainStatement, 'capture the real entry point Promise without executing main twice')
const observedSource = source.slice(0, mainStatement.getStart(ast))
  + 'globalThis.__previewReady = main()' + source.slice(mainStatement.end)

// Exercise the complete production module with deterministic library/DOM boundaries.
// No imports or rendering functions are removed; only the void main() Promise is captured.
const bundle = await build({
  stdin: { contents: observedSource, loader: 'ts', sourcefile: 'localPreview.ts', resolveDir: fileURLToPath(new URL('../src', import.meta.url)) },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', metafile: true,
  plugins: [{ name: 'controlled-preview-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(markdown-it|dompurify|docx-preview|pdfjs-dist\/)/ }, (args) => ({ path: args.path, namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
      if (path === 'markdown-it') return { contents: 'export default class Markdown { linkify = { set() {} }; render(text) { globalThis.__probe.markdown.push(text); return `<p>${text}</p>` } }' }
      if (path === 'dompurify') return { contents: 'export default { sanitize(html, options) { globalThis.__probe.sanitizers.push(options); return html } }' }
      if (path.endsWith('?url')) return { contents: 'export default "/assets/legacy-pdf-worker.mjs"' }
      if (path === 'docx-preview') return { contents: `
        globalThis.__probe.engines.push('docx');
        if (globalThis.__probe.failEngine === 'docx') throw new Error('DOCX engine unavailable');
        export async function renderAsync(bytes, container, style, options) {
          globalThis.__probe.docx.push({ bytes: bytes.byteLength, options });
          container.innerHTML = '<article>Word body</article>';
        }
      ` }
      return { contents: `
        globalThis.__probe.engines.push('pdf');
        if (globalThis.__probe.failEngine === 'pdf') throw new Error('PDF engine unavailable');
        export const GlobalWorkerOptions = {};
        export function getDocument({ data }) {
          globalThis.__probe.pdf.push({ bytes: data.byteLength, workerSrc: GlobalWorkerOptions.workerSrc });
          return { promise: Promise.resolve({ numPages: 2, async getPage(number) {
            return { getViewport({ scale }) { return { width: 600 * scale, height: 800 * scale } },
              render() { globalThis.__probe.pages.push(number); return { promise: Promise.resolve() } } };
          } }) };
        }
      ` }
    })
  } }],
})
const javascript = bundle.outputFiles[0]!.text

type FakeElement = {
  className: string; textContent: string; innerHTML: string; dataset: Record<string, unknown>;
  style: Record<string, unknown>; children: FakeElement[]; clientWidth: number;
  append: (...children: FakeElement[]) => void; replaceChildren: (...children: FakeElement[]) => void;
  addEventListener: (...args: unknown[]) => void; getContext: () => { setTransform: (...args: number[]) => void };
}
const element = (): FakeElement => ({
  className: '', textContent: '', innerHTML: '', dataset: {}, style: {}, children: [], clientWidth: 900,
  append(...children) { this.children.push(...children) },
  replaceChildren(...children) { this.children = children },
  addEventListener() {}, getContext() { return { setTransform() {} } },
})

async function openPreview(extension: string, failEngine = '') {
  const root = element()
  const content = element()
  const status = element()
  const size = element()
  const probe = { engines: [] as string[], markdown: [] as string[], sanitizers: [] as unknown[],
    docx: [] as { bytes: number; options: Record<string, unknown> }[],
    pdf: [] as { bytes: number; workerSrc: string }[], pages: [] as number[], failEngine }
  const selectors: Record<string, FakeElement> = { '[data-preview-content]': content, '[data-preview-status]': status, '[data-preview-size]': size }
  const context: Record<string, unknown> = {
    __probe: probe, URL, URLSearchParams, Uint8Array, Error,
    window: { location: { search: `?path=${encodeURIComponent(`/workspace/example.${extension}`)}` }, addEventListener() {}, devicePixelRatio: 1 },
    document: { getElementById: () => root, querySelector: (selector: string) => selectors[selector], querySelectorAll: () => [], createElement: element, head: element() },
    fetch: async () => new Response(extension === 'json' ? '{"ok":true}' : 'fixture body', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
  }
  runInNewContext(javascript, context)
  await context.__previewReady
  return { probe, content, status }
}

test('production import graph has no eager PDF or DOCX engine edge', () => {
  const entry = Object.values(bundle.metafile!.inputs).find((input) => input.imports.some(({ path }) => path.includes('markdown-it')))
  assert.ok(entry)
  const engines = entry.imports.filter(({ path }) => path.includes('docx-preview') || (path.includes('pdfjs-dist') && !path.endsWith('?url')))
  assert.equal(engines.length, 2)
  assert.ok(engines.every(({ kind }) => kind === 'dynamic-import'), JSON.stringify(engines))
})

test('text, JSON, Markdown, image and unsupported previews do not initialize heavy engines', async () => {
  for (const extension of ['txt', 'json', 'md', 'png', 'unknown']) {
    const { probe, content, status } = await openPreview(extension)
    assert.deepEqual(probe.engines, [], extension)
    assert.deepEqual(probe.pdf, [])
    assert.deepEqual(probe.docx, [])
    if (extension === 'md') {
      assert.equal(content.innerHTML, '<p>fixture body</p>')
      assert.deepEqual(JSON.parse(JSON.stringify(probe.sanitizers)), [{ USE_PROFILES: { html: true } }])
    } else if (extension === 'png') assert.equal(content.children.length, 1)
    else if (extension !== 'unknown') assert.equal(content.children.length, 1)
    assert.ok(status.textContent)
  }
})

test('PDF loads only its legacy engine and preserves worker URL and page rendering', async () => {
  const { probe, content, status } = await openPreview('pdf')
  assert.deepEqual(probe.engines, ['pdf'])
  assert.equal(probe.pdf.length, 1)
  assert.equal(probe.pdf[0]!.workerSrc, '/assets/legacy-pdf-worker.mjs')
  assert.deepEqual(probe.pages, [1, 2])
  assert.equal(content.children.length, 2)
  assert.match(status.textContent, /PDF.*2/u)
})

test('DOCX loads only its engine and retains original render options', async () => {
  const { probe, content, status } = await openPreview('docx')
  assert.deepEqual(probe.engines, ['docx'])
  assert.equal(probe.docx.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(probe.docx[0]!.options)), {
    className: 'docx', inWrapper: true, ignoreWidth: false, ignoreHeight: false, ignoreFonts: false,
    breakPages: true, renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, useBase64URL: false,
  })
  assert.equal(content.innerHTML, '<article>Word body</article>')
  assert.match(status.textContent, /Word.*已就绪/u)
})

test('lazy engine load failures use the existing document error branches', async () => {
  const pdf = await openPreview('pdf', 'pdf')
  assert.equal(pdf.status.textContent, 'PDF engine unavailable')
  assert.equal(pdf.status.dataset.tone, 'error')
  const docx = await openPreview('docx', 'docx')
  assert.equal(docx.status.textContent, 'Word 预览失败：DOCX engine unavailable')
  assert.equal(docx.content.className, 'preview-content unsupported-body')
})
