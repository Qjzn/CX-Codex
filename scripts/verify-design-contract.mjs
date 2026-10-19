// DESIGN.md 契约校验（零依赖，纯标准库）。
//
// 三个目的：
// 1. frontmatter 里的 {colors.x} / {typography.x} / {rounded.x} / {spacing.x} 引用必须能解析；
// 2. 组件的文字色与背景色必须满足 WCAG AA（4.5:1）；
// 3. DESIGN.md 的数值必须与 src/style.css 的真实变量一致——这条是防漂移的关键，
//    原来只能靠人眼看，出现过「文档写 8/12/16/24、代码里却有 10px」的情况。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const designPath = fileURLToPath(new URL('DESIGN.md', root))
const cssPath = fileURLToPath(new URL('src/style.css', root))

const failures = []
const notes = []

function fail(message) { failures.push(message) }

function normalize(text) {
  return text.split('\r\n').join('\n').replace(/^\uFEFF/, '')
}

// 极简 YAML：只支持本文件用到的两层映射 + 引号字符串。
function parseFrontmatter(text) {
  const source = normalize(text)
  if (!source.startsWith('---\n')) throw new Error('DESIGN.md 缺少 YAML frontmatter')
  const end = source.indexOf('\n---\n', 4)
  if (end < 0) throw new Error('DESIGN.md 的 frontmatter 没有结束标记')
  const lines = source.slice(4, end).split('\n')
  const rootNode = {}
  const stack = [{ indent: -1, node: rootNode }]
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    const separator = raw.trim().indexOf(':')
    if (separator < 0) continue
    const key = raw.trim().slice(0, separator).trim()
    const value = raw.trim().slice(separator + 1).trim()
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop()
    const parent = stack[stack.length - 1].node
    if (value === '') {
      parent[key] = {}
      stack.push({ indent, node: parent[key] })
    } else {
      parent[key] = value.replace(/^["']|["']$/g, '')
    }
  }
  return rootNode
}

function toRgb(hex) {
  const h = String(hex).trim().replace('#', '')
  if (h.length !== 6 || !/^[0-9a-f]+$/i.test(h)) return null
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function resolveRef(ref, tokens) {
  const value = String(ref).trim()
  if (!value.startsWith('{') || !value.endsWith('}')) return null
  const [group, name] = value.slice(1, -1).split('.')
  if (!group || !name) return null
  return tokens[group]?.[name] ?? null
}

// DESIGN.md 名 → style.css 变量名。只映射两边都真实存在的语义。
const COLOR_VARS = {
  primary: '--ui-text-primary',
  secondary: '--ui-text-secondary',
  tertiary: '--ui-text-tertiary',
  neutral: '--ui-bg-window',
  surface: '--ui-bg-surface',
  border: '--ui-border-subtle',
  accent: '--ui-accent',
  warning: '--ui-warning',
  danger: '--ui-danger',
}

const SPACING_VARS = {
  sm: '--ui-space-2',
  md: '--ui-space-3',
  lg: '--ui-space-4',
  xl: '--ui-space-6',
}

const TYPOGRAPHY_VARS = {
  meta: '--ui-text-xs',
  status: '--ui-text-sm',
  body: '--ui-text-base',
}

const ROUNDED_VARS = {
  sm: '--ui-radius-xs',
  md: '--ui-radius-row',
  lg: '--ui-radius-composer',
  pill: '--ui-radius-pill',
}

function readCssVars(css) {
  const vars = new Map()
  const pattern = /(--ui-[a-z0-9-]+)\s*:\s*([^;]+);/gi
  for (const match of normalize(css).matchAll(pattern)) {
    if (!vars.has(match[1])) vars.set(match[1], match[2].trim())
  }
  return vars
}

const design = readFileSync(designPath, 'utf8')
const css = readFileSync(cssPath, 'utf8')
const tokens = parseFrontmatter(design)
const vars = readCssVars(css)

// 1) 引用解析 + 2) 对比度
for (const [componentName, component] of Object.entries(tokens.components ?? {})) {
  const fg = component.textColor ? resolveRef(component.textColor, tokens) : null
  const bg = component.backgroundColor ? resolveRef(component.backgroundColor, tokens) : null
  if (component.textColor && !fg) fail(`${componentName}: textColor 引用无法解析 (${component.textColor})`)
  if (component.backgroundColor && !bg) fail(`${componentName}: backgroundColor 引用无法解析 (${component.backgroundColor})`)
  for (const key of ['typography', 'rounded', 'padding']) {
    const value = component[key]
    if (typeof value === 'string' && value.startsWith('{') && !resolveRef(value, tokens)) {
      fail(`${componentName}: ${key} 引用无法解析 (${value})`)
    }
  }
  if (fg && bg) {
    const fgRgb = toRgb(fg)
    const bgRgb = toRgb(bg)
    if (fgRgb && bgRgb) {
      const ratio = contrast(fgRgb, bgRgb)
      if (ratio < 4.5) fail(`${componentName}: 对比度 ${ratio.toFixed(2)}:1 低于 4.5:1 (${fg} on ${bg})`)
      else notes.push(`${componentName}: ${ratio.toFixed(2)}:1`)
    }
  }
}

// 3) 与 style.css 的数值漂移
function compare(group, mapping, label) {
  for (const [name, cssVar] of Object.entries(mapping)) {
    const expected = tokens[group]?.[name]
    const actual = vars.get(cssVar)
    if (expected === undefined) { fail(`${label}.${name}: DESIGN.md 未定义`); continue }
    if (actual === undefined) { fail(`${label}.${name}: style.css 缺少 ${cssVar}`); continue }
    const a = String(expected).trim().toLowerCase()
    const b = String(actual).trim().toLowerCase()
    if (a !== b) fail(`${label}.${name}: DESIGN.md 写 ${a}，${cssVar} 实际是 ${b}`)
  }
}

compare('colors', COLOR_VARS, 'colors')
compare('spacing', SPACING_VARS, 'spacing')
compare('rounded', ROUNDED_VARS, 'rounded')

for (const [name, cssVar] of Object.entries(TYPOGRAPHY_VARS)) {
  const expected = tokens.typography?.[name]?.fontSize
  const actual = vars.get(cssVar)
  if (expected === undefined) { fail(`typography.${name}: DESIGN.md 未定义 fontSize`); continue }
  if (actual === undefined) { fail(`typography.${name}: style.css 缺少 ${cssVar}`); continue }
  if (String(expected).trim() !== String(actual).trim()) {
    fail(`typography.${name}: DESIGN.md 写 ${expected}，${cssVar} 实际是 ${actual}`)
  }
}

if (failures.length > 0) {
  console.error('Design contract failed:')
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

console.log(`Design contract passed: ${Object.keys(tokens.colors ?? {}).length} colors, ${Object.keys(tokens.components ?? {}).length} components, ${notes.length} contrast pairs, tokens match style.css.`)
