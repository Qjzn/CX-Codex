import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, writeFile, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import test from 'node:test'
import { SourceMap } from 'node:module'
import { archiveCliDebug } from './archive-cli-debug.mjs'

const base = resolve('output/cli-debug-archive-tests')
await mkdir(base, { recursive: true })
const bundle = 'throw new Error("synthetic fixture");\n//# sourceMappingURL=index.js.map\n'
const map = { version: 3, file: 'index.js', sources: ['fixture.ts'], sourcesContent: ['throw new Error("synthetic fixture");'], names: [], mappings: 'AAAA' }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function fixture(sourceMap = map) {
  const root = await mkdtemp(join(base, 'run-'))
  await mkdir(join(root, 'dist-cli'))
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '2.8.1' }))
  await writeFile(join(root, 'dist-cli/index.js'), bundle)
  await writeFile(join(root, 'dist-cli/index.js.map'), JSON.stringify(sourceMap))
  return root
}

test('runtime has no map or dangling reference, while the archive maps original source', async () => {
  const root = await fixture()
  const result = await archiveCliDebug(root)
  const runtime = await readFile(join(root, 'dist-cli/index.js'), 'utf8')
  assert.equal(runtime, bundle.split('//#')[0])
  await assert.rejects(access(join(root, 'dist-cli/index.js.map')), { code: 'ENOENT' })
  assert.equal(await readFile(join(result.archive, 'index.js'), 'utf8'), bundle)
  assert.equal(result.runtimeSha256, hash(runtime))
  const archivedMap = await readFile(join(result.archive, 'index.js.map'))
  assert.equal(result.mapSha256, hash(archivedMap))
  assert.equal(new SourceMap(JSON.parse(archivedMap)).findEntry(0, 0).originalSource, 'fixture.ts')
})

test('identical rebuilds retain the same archive without overwriting it', async () => {
  const root = await fixture()
  const first = await archiveCliDebug(root)
  await writeFile(join(root, 'dist-cli/index.js'), bundle)
  await writeFile(join(root, 'dist-cli/index.js.map'), JSON.stringify(map))
  assert.deepEqual(await archiveCliDebug(root), first)
})

test('an incomplete debug map fails before runtime files are changed', async () => {
  const root = await fixture({ ...map, sourcesContent: [] })
  await assert.rejects(archiveCliDebug(root), /self-contained/u)
  assert.equal(await readFile(join(root, 'dist-cli/index.js'), 'utf8'), bundle)
  await access(join(root, 'dist-cli/index.js.map'))
})

test('esbuild maps can omit the optional file field; a conflicting file is rejected', async () => {
  const { file, ...withoutFile } = map
  await archiveCliDebug(await fixture(withoutFile))
  const invalid = await fixture({ ...map, file: 'other.js' })
  await assert.rejects(archiveCliDebug(invalid), /self-contained/u)
  assert.equal(await readFile(join(invalid, 'dist-cli/index.js'), 'utf8'), bundle)
})

test('archive conflicts preserve the runtime bundle and source map for recovery', async () => {
  const root = await fixture()
  const archived = await archiveCliDebug(root)
  await writeFile(join(archived.archive, 'index.js'), 'conflicting archived bytes')
  await writeFile(join(root, 'dist-cli/index.js'), bundle)
  await writeFile(join(root, 'dist-cli/index.js.map'), JSON.stringify(map))
  await assert.rejects(archiveCliDebug(root), { code: 'EEXIST' })
  assert.equal(await readFile(join(root, 'dist-cli/index.js'), 'utf8'), bundle)
  await access(join(root, 'dist-cli/index.js.map'))
})
