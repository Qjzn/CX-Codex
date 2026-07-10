import { defineConfig } from 'tsup'

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
})
