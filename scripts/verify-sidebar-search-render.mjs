// Render the real production template through Vue's renderer. No service,
// browser, API mocks, user data, or copied visibility conditions are involved.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'

const source = readFileSync(fileURLToPath(new URL('../src/components/sidebar/SidebarThreadTree.vue', import.meta.url)), 'utf8')
const { descriptor, errors } = parse(source)
assert.deepEqual(errors, [])
const { code } = compile(descriptor.template.content, { mode: 'function', prefixIdentifiers: true, hoistStatic: false })
const render = new Function('Vue', code)(Vue)

// Minimal inspectable host DOM for Vue's public custom-renderer API. Assertions
// query rendered elements/attributes, not SFC source strings or compiler AST.
const node = (tag, text = '') => ({ tag, text, props: {}, children: [], parent: null })
const detach = child => {
  if (!child.parent) return
  child.parent.children.splice(child.parent.children.indexOf(child), 1)
  child.parent = null
}
const renderer = Vue.createRenderer({
  createElement: tag => node(tag), createText: text => node('#text', text), createComment: text => node('#comment', text),
  patchProp: (target, key, _previous, value) => { target.props[key] = value },
  insert(child, parent, anchor = null) {
    detach(child)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    child.parent = parent
  },
  remove: detach, setText: (target, text) => { target.text = text },
  setElementText(target, text) { target.children = []; target.text = text },
  parentNode: target => target.parent,
  nextSibling: target => target.parent?.children[target.parent.children.indexOf(target) + 1] ?? null,
  querySelector: () => node('teleport-host'),
})
function findAll(root, predicate) {
  return [...(predicate(root) ? [root] : []), ...root.children.flatMap(child => findAll(child, predicate))]
}
const hasClass = (target, name) => String(target.props.class ?? '').split(/\s+/).includes(name)
const withClass = (root, name) => findAll(root, target => hasClass(target, name))
const textOf = target => (target.tag === '#comment' ? '' : target.text) + target.children.map(textOf).join('')
const thread = { id: 'sidebar-test-thread', title: 'LOCAL_MATCH test', preview: '', cwd: '/fixture', projectName: 'fixture', inProgress: false, unread: false }
const groups = [{ projectName: 'fixture', threads: [thread] }]
const noop = () => undefined

function mount({ search = true, state = 'pending', matching = true, empty = false, loading = false, title = thread.title } = {}) {
  const fixtureGroups = empty ? [] : [{ ...groups[0], threads: [{ ...thread, title }] }]
  const ctx = Vue.reactive({
    isSearchActive: search, isFullSearchPending: state === 'pending', hasFullSearchFailed: state === 'failed', hasPartialSearchResults: state === 'partial',
    groups: fixtureGroups, filteredGroups: matching || !search ? fixtureGroups : [], displayedGroups: matching || !search ? fixtureGroups : [],
    isLoading: loading, pinnedThreads: [], visiblePinnedThreads: [], hasCollapsedPinnedThreads: false,
    selectedThreadId: thread.id, isOrganizeMenuOpen: false, useDesktopListParity: false, groupsContainerStyle: {},
    openProjectMenuGroup: null, openThreadMenuThread: null, renameThreadDialogVisible: false, deleteThreadDialogVisible: false,
    isCollapsed: () => false, isDraggingProject: () => false, projectGroupStyle: () => ({}),
    getProjectDisplayName: name => name, getProjectToggleAriaLabel: group => group.projectName,
    getProjectSummary: group => `${group.threads.length}个会话`, getProjectMenuAriaLabel: name => name,
    getNewThreadButtonAriaLabel: name => name, isProjectMenuOpen: () => false, hasThreads: group => group.threads.length > 0,
    visibleThreads: group => group.threads, hasHiddenThreads: () => false, isPinned: () => false, isThreadMenuOpen: () => false,
    getThreadOpenAriaLabel: value => `打开会话：${value.title}`, getThreadPreview: value => value.preview,
    getThreadPinActionLabel: () => '置顶', getThreadMenuAriaLabel: () => '会话操作', formatRelativeThread: () => 'now',
    toggleOrganizeMenu: noop, retryFullSearch: noop, toggleProjectCollapse: noop, onThreadRowContextMenu: noop, setProjectGroupRef: noop,
    toggleProjectMenu: noop, onStartNewThread: noop, onSelect: noop, toggleThreadMenu: noop, togglePin: noop,
  })
  const root = node('root')
  const warnings = []
  const app = renderer.createApp({ setup: () => ctx, render })
  app.config.warnHandler = message => warnings.push(message)
  // Layout/icon children are passive slot wrappers here; the tested production
  // search template and its conditional branches are compiled unchanged above.
  app.component('SidebarMenuRow', { props: ['as'], setup: (props, { attrs, slots }) => () => Vue.h(props.as || 'div', attrs, Object.values(slots).flatMap(slot => slot?.() ?? [])) })
  for (const name of ['ChevronDown', 'ChevronRight', 'Dots', 'FilePencil', 'Folder', 'FolderOpen', 'GitFork', 'Pin']) app.component(`IconTabler${name}`, { render: () => Vue.h('svg') })
  app.mount(root)
  return { root, ctx, warnings, close: () => app.unmount() }
}
function assertRows(fixture, count) {
  assert.equal(withClass(fixture.root, 'thread-main-button').length, count)
  assert.equal(findAll(fixture.root, target => target.props['data-thread-id'] === thread.id).length, count)
  assert.deepEqual(fixture.warnings, [], 'Unexpected rendering warnings invalidate the template fixture')
}
function assertNoDuplicatePlaceholder(fixture, expectedClass) {
  const placeholders = ['thread-tree-search-state', 'thread-tree-no-results', 'thread-tree-loading', 'thread-tree-empty-row']
  for (const name of placeholders) assert.equal(withClass(fixture.root, name).length, name === expectedClass ? 1 : 0, name)
  assert.equal(withClass(fixture.root, 'thread-tree-groups').length, 0, 'Empty states must not mount an empty results directory')
  assertRows(fixture, 0)
}

test('pending local title match remains mounted when an empty partial index reply arrives', async () => {
  const fixture = mount()
  try {
    assertRows(fixture, 1)
    const original = withClass(fixture.root, 'thread-main-button')[0]
    fixture.ctx.isFullSearchPending = false
    fixture.ctx.hasPartialSearchResults = true
    await Vue.nextTick()
    assertRows(fixture, 1)
    assert.equal(withClass(fixture.root, 'thread-main-button')[0], original, 'Background search must not unmount the existing result')
    assert.match(textOf(fixture.root), /已显示本地匹配，更多会话仍在整理/)
    assert.equal(withClass(fixture.root, 'thread-tree-search-retry').length, 1)
  } finally { fixture.close() }
})

test('partial remote-ID match renders alongside the progress hint, then survives completion', async () => {
  const fixture = mount({ state: 'partial', title: 'Title without the local query' })
  try {
    assertRows(fixture, 1)
    assert.equal(withClass(fixture.root, 'thread-tree-search-state').length, 1)
    fixture.ctx.hasPartialSearchResults = false
    await Vue.nextTick()
    assertRows(fixture, 1)
    assert.equal(withClass(fixture.root, 'thread-tree-search-state').length, 0)
  } finally { fixture.close() }
})

for (const [state, expectedClass, expectedText] of [
  ['pending', 'thread-tree-search-state', '正在搜索全部会话'],
  ['failed', 'thread-tree-search-state', '完整搜索暂时不可用'],
  ['partial', 'thread-tree-search-state', '已搜索本地记录'],
  ['idle', 'thread-tree-no-results', '没有匹配的会话'],
]) test(`${state} with no matches renders exactly one appropriate placeholder`, () => {
  const fixture = mount({ state, matching: false })
  try { assertNoDuplicatePlaceholder(fixture, expectedClass); assert(textOf(fixture.root).includes(expectedText)) } finally { fixture.close() }
})

for (const loading of [true, false]) test(`non-search empty list (${loading ? 'loading' : 'idle'}) has no empty results container`, () => {
  const fixture = mount({ search: false, state: 'idle', empty: true, loading })
  try { assertNoDuplicatePlaceholder(fixture, loading ? 'thread-tree-loading' : 'thread-tree-empty-row') } finally { fixture.close() }
})

test('ordinary non-search populated list remains rendered without search notices', () => {
  const fixture = mount({ search: false, state: 'idle' })
  try { assertRows(fixture, 1); assert.equal(withClass(fixture.root, 'thread-tree-search-state').length, 0) } finally { fixture.close() }
})
