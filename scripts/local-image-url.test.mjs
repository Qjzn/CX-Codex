import assert from 'node:assert/strict'
import test from 'node:test'
import { toRenderableImageUrl } from '../src/utils/localImageUrl.ts'

test('local attachment sources use the existing authorized image route', () => {
  for (const source of ['C:\\Users\\Example\\附件 #1.png', 'E:/images/example.jpg', '/tmp/example.png', 'file:///C:/images/example.png', '\\\\server\\images\\example.png']) {
    assert.equal(toRenderableImageUrl(source), `/codex-local-image?path=${encodeURIComponent(source)}`)
  }
})

test('renderable sources remain stable through repeated normalization', () => {
  assert.equal(toRenderableImageUrl('FILE:///C:/image.png'), `/codex-local-image?path=${encodeURIComponent('file:///C:/image.png')}`)
  for (const source of ['https://example.com/image.png', 'http://localhost/image.png', 'blob:http://localhost/123', 'data:image/png;base64,AA==', '/codex-local-image?path=C%3A%2Fimage.png']) {
    assert.equal(toRenderableImageUrl(source), source)
    assert.equal(toRenderableImageUrl(toRenderableImageUrl(source)), source)
  }
})

test('unsupported or ambiguous sources never become image or navigation URLs', () => {
  for (const source of ['', 'javascript:alert(1)', 'data:text/html,test', '//external.example/image.png', 'relative.png', 'C:\\image\u0000.png', 'https:\n//example.com']) {
    assert.equal(toRenderableImageUrl(source), '')
  }
})
