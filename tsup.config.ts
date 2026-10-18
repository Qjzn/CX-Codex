import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsup'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

// Frozen at build time, without Git probing or extra dependencies: the backend
// version comes from package.json and the buildId is a deterministic hash of
// that version plus this entry's source bytes.
function readFrozenBackendBuildConstants(): { version: string; buildId: string } {
  let version = 'unknown'
  try {
    const parsed = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version?: unknown }
    if (typeof parsed.version === 'string' && parsed.version.trim().length > 0) version = parsed.version.trim()
  } catch {
    version = 'unknown'
  }

  let entrySource = ''
  try {
    entrySource = readFileSync(join(repoRoot, 'src', 'cli', 'index.ts'), 'utf8')
  } catch {
    entrySource = ''
  }

  const buildId = createHash('sha256').update(`cx-codex-backend:${version}:${entrySource}`).digest('hex').slice(0, 16)
  return { version, buildId }
}

const frozenBackendBuild = readFrozenBackendBuildConstants()

export default defineConfig({
  entry: ['src/cli/index.ts'],
  outDir: 'dist-cli',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['express', 'commander', 'better-sqlite3'],
  define: {
    __CX_CODEX_BACKEND_VERSION__: JSON.stringify(frozenBackendBuild.version),
    __CX_CODEX_BACKEND_BUILD_ID__: JSON.stringify(frozenBackendBuild.buildId),
  },
})
