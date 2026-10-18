import { constants as zlibConstants, brotliCompress } from 'node:zlib'
import { promisify } from 'node:util'
import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

const brotliCompressAsync = promisify(brotliCompress)
const assetsDir = join(process.cwd(), 'dist', 'assets')
const compressibleExtensions = new Set(['.css', '.html', '.js', '.json', '.mjs', '.svg'])
const minimumBytes = 1024
// Chromium（Electron/Chrome 全系）自 2015 起支持 woff2；同名字体有 woff2 时，
// ttf/woff 只会被下载作为旧浏览器兜底，属于纯冗余体积。
const legacyFontExtensions = new Set(['.ttf', '.woff'])

// Vite 给每个资源加独立 hash，故按“去掉 hash 的字族名”配对，而不是同名文件。
function fontFamilyKey(name) {
  return name.replace(/-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/u, '')
}

async function pruneLegacyFonts(entries) {
  const woff2Families = new Set(
    entries
      .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.woff2')
      .map((entry) => fontFamilyKey(entry.name)),
  )
  let pruned = 0
  let prunedBytes = 0
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!legacyFontExtensions.has(extname(entry.name).toLowerCase())) continue
    if (!woff2Families.has(fontFamilyKey(entry.name))) continue
    const target = join(assetsDir, entry.name)
    prunedBytes += (await stat(target)).size
    await unlink(target)
    pruned += 1
  }
  if (pruned > 0) {
    console.log(`Pruned ${pruned} legacy font files (~${Math.round(prunedBytes / 1024)} KB) that have woff2 twins.`)
  }
}

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

  await pruneLegacyFonts(entries)

  const savedPercent = sourceBytes > 0
    ? Math.round((1 - compressedBytes / sourceBytes) * 100)
    : 0
  console.log(`Precompressed ${compressedCount} frontend assets with Brotli (${savedPercent}% smaller).`)
}

await main()
