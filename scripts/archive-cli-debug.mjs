import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function archiveCliDebug(repoRoot) {
  const cliPath = join(repoRoot, 'dist-cli', 'index.js')
  const mapPath = `${cliPath}.map`
  for (const path of [cliPath, mapPath]) {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular build file: ${path}`)
  }
  const [bundle, mapBytes, packageText] = await Promise.all([
    readFile(cliPath, 'utf8'), readFile(mapPath), readFile(join(repoRoot, 'package.json'), 'utf8'),
  ])
  const sourceMap = JSON.parse(mapBytes.toString('utf8'))
  if (sourceMap.version !== 3 || (sourceMap.file !== undefined && sourceMap.file !== 'index.js')
      || !sourceMap.sources?.length || sourceMap.sourcesContent?.length !== sourceMap.sources.length
      || !sourceMap.sourcesContent.every(source => typeof source === 'string')) {
    throw new Error('CLI debug archive requires a self-contained index.js source map')
  }
  const reference = /\r?\n\/\/# sourceMappingURL=index\.js\.map\s*$/u
  if (!reference.test(bundle)) throw new Error('Expected the CLI source map reference at the end of the bundle')
  const runtime = bundle.replace(reference, '\n')
  const bundleSha256 = hash(bundle)
  const mapSha256 = hash(mapBytes)
  const archive = join(repoRoot, 'output', 'cli-debug', hash(`${bundleSha256}:${mapSha256}`))
  const manifest = {
    version: JSON.parse(packageText).version,
    runtimeSha256: hash(runtime), debugBundleSha256: bundleSha256, mapSha256,
  }
  await mkdir(archive, { recursive: true })
  // Never overwrite a conflicting archive, even when retrying an identical build.
  for (const [name, bytes] of [['index.js', bundle], ['index.js.map', mapBytes], ['manifest.json', `${JSON.stringify(manifest, null, 2)}\n`]]) {
    const path = join(archive, name)
    try { await writeFile(path, bytes, { flag: 'wx' }) } catch (error) {
      if (error.code !== 'EEXIST' || !(await readFile(path)).equals(Buffer.from(bytes))) throw error
    }
  }
  // Both debug files are safely retained before changing the disposable runtime output.
  await writeFile(cliPath, runtime, 'utf8')
  await unlink(mapPath)
  return { archive, ...manifest }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await archiveCliDebug(fileURLToPath(new URL('..', import.meta.url)))
  console.log(`CLI debug archive: ${result.archive}`)
}
