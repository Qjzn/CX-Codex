import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build, preview } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Synthetic UI only: no App shell, live runtime, authentication or model calls.
const root = resolve(import.meta.dirname, '..')
const fixtureRoot = resolve(root, 'output/async-question-preview')
mkdirSync(fixtureRoot, { recursive: true })
writeFileSync(resolve(fixtureRoot, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Async question fixture</title></head><body><div id="app"></div><script type="module" src="./main.ts"></script></body></html>', 'utf8')
writeFileSync(resolve(fixtureRoot, 'main.ts'), `import { createApp } from 'vue'
import Fixture from '../../src/components/content/AsyncQuestionRegressionFixture.vue'
import '../../src/style.css'
createApp(Fixture).mount('#app')
`, 'utf8')
await build({ configFile: false, root: fixtureRoot, plugins: [vue(), tailwindcss()], build: { outDir: 'dist' } })
const server = await preview({ configFile: false, root: fixtureRoot, build: { outDir: 'dist' }, preview: { host: '127.0.0.1', port: 17520, strictPort: true } })
server.printUrls()
