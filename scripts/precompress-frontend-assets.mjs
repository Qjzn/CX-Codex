import { constants as zlibConstants, brotliCompress } from 'node:zlib'
import { promisify } from 'node:util'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const brotliCompressAsync = promisify(brotliCompress)
const assetsDir = join(process.cwd(), 'dist', 'assets')
const compressibleExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg'])
const minimumBytes = 1024

async function main() {
  const entries = await readdir(assetsDir, { withFileTypes: true })
  let compressedCount = 0
  let sourceBytes = 0
  let compressedBytes = 0

  for (const entry of entries) {
    if (!entry.isFile() || entry.name.endsWith('.br')) continue
    if (!compressibleExtensions.has(extname(entry.name).toLowerCase())) continue
    const sourcePath = join(assetsDir, entry.name)
    const sourceStat = await stat(sourcePath)
    if (sourceStat.size < minimumBytes) continue
    const source = await readFile(sourcePath)
    const compressed = await brotliCompressAsync(source, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 5,
      },
    })
    await writeFile(`${sourcePath}.br`, compressed)
    compressedCount += 1
    sourceBytes += source.length
    compressedBytes += compressed.length
  }

  const savedPercent = sourceBytes > 0
    ? Math.round((1 - compressedBytes / sourceBytes) * 100)
    : 0
  console.log(`Precompressed ${compressedCount} frontend assets with Brotli (${savedPercent}% smaller).`)
}

await main()
