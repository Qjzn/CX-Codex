// 纯格式化函数的行为锁定：架构重构第一批只搬函数，行为必须逐字不变。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const bundle = await build({
  stdin: {
    contents: `export { formatDuration, fileSummaryLabel, fileKindLabel } from './src/components/content/conversation/format.ts'`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', packages: 'external',
})
const compiled = { exports: {} }
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(
  createRequire(import.meta.url), compiled, compiled.exports,
)
const { formatDuration, fileSummaryLabel, fileKindLabel } = compiled.exports

test('formatDuration covers null, seconds, minutes and hours', () => {
  assert.equal(formatDuration(null), '耗时未知')
  assert.equal(formatDuration(Number.NaN), '耗时未知')
  assert.equal(formatDuration(5_000), '5 秒')
  assert.equal(formatDuration(65_000), '1 分 5 秒')
  assert.equal(formatDuration(120_000), '2 分钟')
  assert.equal(formatDuration(3_900_000), '1 小时 5 分')
  assert.equal(formatDuration(7_200_000), '2 小时')
})

test('fileSummaryLabel sums additions and removals', () => {
  assert.equal(
    fileSummaryLabel({ fileChanges: [{ additions: 3, removals: 1 }, { additions: 2, removals: 2 }] }),
    '2 个文件 · +5 −3',
  )
  assert.equal(fileSummaryLabel({ fileChanges: [] }), '0 个文件 · +0 −0')
})

test('fileKindLabel maps kinds to Chinese labels', () => {
  assert.equal(fileKindLabel('add'), '新增')
  assert.equal(fileKindLabel('delete'), '删除')
  assert.equal(fileKindLabel('update'), '修改')
})
