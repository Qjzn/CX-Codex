import fs from 'node:fs'
const source = new URL('../src/server/assistant-assets/', import.meta.url)
const target = new URL('../dist-cli/assistant-assets/', import.meta.url)
for (const file of ['cxcodex-assistant-core/SKILL.md', 'worker-brief.md']) {
  const from = new URL(file, source)
  if (!fs.lstatSync(from).isFile()) throw new Error('Assistant asset must be a regular file')
  const to = new URL(file, target)
  fs.mkdirSync(new URL('.', to), { recursive: true })
  fs.copyFileSync(from, to)
}
console.log('Copied 2 assistant instruction assets.')
