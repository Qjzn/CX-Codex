import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compileStyle, parse } from '@vue/compiler-sfc'

test('conversation dark surfaces remain scoped after Vue compiles CSS', () => {
  for (const name of ['ThreadConversation', 'ConversationRegressionFixture']) {
    const filename = new URL(`../src/components/content/${name}.vue`, import.meta.url)
    const { descriptor } = parse(readFileSync(filename, 'utf8'))
    for (const style of descriptor.styles) {
      const { code, errors } = compileStyle({ source: style.content, filename: filename.pathname, id: 'data-v-test', scoped: style.scoped })
      assert.deepEqual(errors, [])
      assert.doesNotMatch(code, /(?:^|\})\s*\.dark\s*\{/u, `${name} must not emit bare global .dark declarations`)
      assert.match(code, /\.dark\s+\.(?:transcript-root|conversation-regression-fixture)\[data-v-test\]/u)
    }
  }
})
