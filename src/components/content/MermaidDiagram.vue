<template>
  <section class="mermaid-diagram" :class="{ 'mermaid-diagram--error': Boolean(errorMessage) }">
    <div v-if="isRendering" class="mermaid-diagram-status" role="status" aria-live="polite">
      正在绘制图表…
    </div>
    <div
      v-else-if="sanitizedSvg"
      class="mermaid-diagram-svg"
      role="img"
      aria-label="Mermaid 图表"
      v-html="sanitizedSvg"
    />
    <div v-else class="mermaid-diagram-fallback">
      <p class="mermaid-diagram-status" role="status">Mermaid 图表渲染失败，已保留源码。</p>
      <pre><code>{{ code }}</code></pre>
    </div>
  </section>
</template>

<script setup lang="ts">
import DOMPurify from 'dompurify'
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  code: string
  renderId: string
}>()

const sanitizedSvg = ref('')
const errorMessage = ref('')
const isRendering = ref(false)
let renderGeneration = 0

function sanitizeMermaidSvg(svg: string): string {
  const sanitized = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject'],
  })

  // Mermaid's class styles are not reliable after the SVG is inserted with
  // v-html (especially when the component is rendered inside a scoped style
  // boundary). Keep the diagram readable even when the generated stylesheet
  // is absent by applying high-contrast presentation attributes directly to
  // node shapes and labels.
  return sanitized
    .replace(/<(rect|circle|ellipse|polygon|path)(\b[^>]*class="[^"]*\b(?:basic|node)[^"]*"[^>]*)>/gu, '<$1$2 fill="#f7f1e8" stroke="#9b8268" stroke-width="1">')
    .replace(/<(text|tspan)\b([^>]*)>/gu, (_tag, elementName: string, attributes: string) => {
      // Mermaid's generated text elements do not always carry a class, and
      // the stylesheet inside an SVG inserted with v-html is not a reliable
      // place to keep the foreground color. Inline styling also covers the
      // nested tspan elements used by Mermaid 11's flowchart renderer.
      const withoutPresentationStyles = attributes
        .replace(/\sstyle=(['"]).*?\1/iu, '')
        .replace(/\sfill=(['"]).*?\1/iu, '')
      return `<${elementName}${withoutPresentationStyles} style="fill:#2d261f !important;color:#2d261f !important">`
    })
}

function forceSvgLabels(code: string): string {
  // Mermaid directives/front matter can override initialize() and turn node
  // labels back into foreignObject elements. They are intentionally removed
  // by the sanitizer, so keep the rendered representation SVG-only.
  return code.replace(/(["']?htmlLabels["']?\s*:\s*)(true|false)/giu, '$1false')
}

async function renderDiagram(): Promise<void> {
  const generation = ++renderGeneration
  sanitizedSvg.value = ''
  errorMessage.value = ''
  if (!props.code.trim()) return

  isRendering.value = true
  try {
    const module = await import('mermaid')
    if (generation !== renderGeneration) return
    const mermaid = module.default
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      // Mermaid 11 reads the global option in several flowchart renderers;
      // flowchart.htmlLabels is deprecated and does not cover every node
      // shape. Without this, node labels become foreignObject elements and
      // are removed by the SVG sanitizer while edge labels remain visible.
      htmlLabels: false,
      themeVariables: {
        background: '#24211d',
        primaryColor: '#f7f1e8',
        primaryTextColor: '#2d261f',
        primaryBorderColor: '#9b8268',
        lineColor: '#d0bda7',
        secondaryColor: '#efe4d5',
        secondaryTextColor: '#2d261f',
        secondaryBorderColor: '#9b8268',
        tertiaryColor: '#e7d9c7',
        tertiaryTextColor: '#2d261f',
        tertiaryBorderColor: '#9b8268',
      },
      flowchart: { htmlLabels: false },
    })
    await nextTick()
    const rendered = await mermaid.render(`mermaid-${props.renderId}`, forceSvgLabels(props.code))
    if (generation !== renderGeneration) return
    sanitizedSvg.value = sanitizeMermaidSvg(rendered.svg)
  } catch (error) {
    if (generation !== renderGeneration) return
    errorMessage.value = error instanceof Error ? error.message : 'Unknown Mermaid rendering error'
  } finally {
    if (generation === renderGeneration) isRendering.value = false
  }
}

watch(() => props.code, () => { void renderDiagram() }, { immediate: true })

onBeforeUnmount(() => {
  renderGeneration += 1
})
</script>

<style scoped>
.mermaid-diagram {
  overflow: auto;
  border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.1));
  border-radius: var(--ui-radius-card, 12px);
  background: var(--ui-bg-surface-muted, #24211d);
  padding: 0.75rem;
}

.mermaid-diagram-svg {
  min-width: min-content;
  color: var(--ui-text-primary, #f4efe7);
}

.mermaid-diagram-svg :deep(svg) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto;
}

.mermaid-diagram-svg :deep(.node rect),
.mermaid-diagram-svg :deep(.node circle),
.mermaid-diagram-svg :deep(.node ellipse),
.mermaid-diagram-svg :deep(.node polygon),
.mermaid-diagram-svg :deep(.node path) {
  fill: #f7f1e8 !important;
  stroke: #9b8268 !important;
}

.mermaid-diagram-svg :deep(.nodeLabel),
.mermaid-diagram-svg :deep(.label text),
.mermaid-diagram-svg :deep(.node text),
.mermaid-diagram-svg :deep(.node tspan),
.mermaid-diagram-svg :deep(.node .label),
.mermaid-diagram-svg :deep(.node .label foreignObject),
.mermaid-diagram-svg :deep(.node .label span) {
  color: #2d261f !important;
  fill: #2d261f !important;
}

.mermaid-diagram-status {
  margin: 0;
  color: var(--ui-text-secondary, #c6b9a8);
  font-size: 0.75rem;
  line-height: 1.5;
}

.mermaid-diagram-fallback pre {
  max-height: 22rem;
  margin: 0.5rem 0 0;
  overflow: auto;
  color: var(--ui-text-primary, #f4efe7);
  font: 0.75rem/1.5 var(--font-mono-ui, monospace);
  white-space: pre-wrap;
}
</style>
