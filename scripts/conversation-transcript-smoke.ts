import assert from 'node:assert/strict'
import './send-feedback-smoke.js'
import { projectConversation } from '../src/conversation-transcript/index.js'
import { buildThreadMarkdown } from '../src/utils/threadExport.js'

const baseIso = '2026-08-30T00:00:00.000Z'
const at = (offsetMs: number): string => new Date(Date.parse(baseIso) + offsetMs).toISOString()

function projectAttachmentMessage(text: string, extraContent: unknown[] = []) {
  return projectConversation({
    nowMs: Date.parse(baseIso),
    threadRead: { thread: { id: 'attachment-thread', turns: [{
      id: 'attachment-turn', status: 'completed', items: [{
        type: 'userMessage', id: 'attachment-user', clientMessageId: 'attachment-client',
        content: [{ type: 'text', text }, ...extraContent],
      }],
    }] } },
  }).turns[0]?.opener
}

const attachmentRequest = '### 检查附件\n\n- 保留列表\n- 保留 `inline code`\n\n```md\n## My request:\n```'
const attachmentEnvelope = '# Files mentioned by the user:\n\n## report.txt: C:\\uploads\\report.txt\n\n## My request for Codex:\n\n'
const attachmentMessage = projectAttachmentMessage(`${attachmentEnvelope}${attachmentRequest}\n`, [
  { type: 'mention', name: 'report.txt', path: 'c:/uploads/report.txt' },
  { type: 'localImage', path: 'C:\\uploads\\screen.png' },
])
assert.equal(attachmentMessage?.text, attachmentRequest, 'the public projection must show the request, not the attachment transport envelope')
assert.deepEqual(attachmentMessage?.mentions, [{ name: 'report.txt', path: 'c:/uploads/report.txt' }], 'transport files and structured mentions must not duplicate the same Windows path')
assert.deepEqual(attachmentMessage?.images, ['C:\\uploads\\screen.png'], 'image facts remain separate from the attachment text presentation')
assert.equal(attachmentMessage?.clientMessageId, 'attachment-client', 'attachment presentation must not replace the message identity')

for (const [drivePath, fileUri] of [
  ['C:\\uploads\\report.txt', 'file:///C:/uploads/report.txt'],
  ['c:/Uploads/图片 一.png', 'FILE:///C:/uploads/%E5%9B%BE%E7%89%87%20%E4%B8%80.png'],
  ['C:/uploads/report#1.txt', 'file:///C:/uploads/report%231.txt'],
  ['C:/uploads/report%23.txt', 'file:///C:/uploads/report%2523.txt'],
  ['C:/uploads/report%25.txt', 'file:///C:/uploads/report%2525.txt'],
]) {
  for (const paths of [[drivePath!, fileUri!], [fileUri!, drivePath!]]) {
    const mentions = paths.map((path, index) => ({ type: 'mention', name: `attachment-${index}`, path }))
    const projected = projectAttachmentMessage(attachmentRequest, mentions)
    assert.deepEqual(projected?.mentions, [{ name: 'attachment-0', path: paths[0] }], 'equivalent Windows drive paths and file URIs keep the first original attachment without decoding raw paths')
    assert.equal(projected?.text, attachmentRequest, 'attachment comparison must not rewrite user Markdown')
  }
}
assert.deepEqual(
  projectAttachmentMessage(`${attachmentEnvelope}${attachmentRequest}`, [
    { type: 'mention', name: 'selected-report.txt', path: 'file:///C:/uploads/report.txt' },
  ])?.mentions,
  [{ name: 'selected-report.txt', path: 'file:///C:/uploads/report.txt' }],
  'a structured file URI and the same drive path in the transport envelope produce one attachment',
)

for (const paths of [
  ['C:/uploads/report#1.txt', 'C:/uploads/report%231.txt'],
  ['file:///C:/uploads/report%231.txt', 'file:///C:/uploads/report%25231.txt'],
  ['/C:/uploads/report.txt', 'file:///C:/uploads/report.txt'],
  ['C:uploads/report.txt', 'file:///C:/uploads/report.txt'],
  ['C:/uploads/report.txt', 'file:///C:/uploads/report.txt#preview'],
  ['C:/uploads/report.txt', 'file:///C:/uploads/report.txt?download=1'],
  ['C:/uploads/report#1.txt', 'file:///C:/uploads/report#1.txt'],
  ['C:/uploads/report%ZZ.txt', 'file:///C:/uploads/report%ZZ.txt'],
  ['C:/uploads/report\u0000.txt', 'file:///C:/uploads/report%00.txt'],
  ['C:/uploads/nested/report.txt', 'file:///C:/uploads/nested%2Freport.txt'],
  ['C:/uploads/nested/report.txt', 'file:///C:/uploads/nested%5Creport.txt'],
  ['C:/uploads/report.txt', 'https://example.test/C:/uploads/report.txt'],
  ['C:/uploads/report.txt', 'file://server/C:/uploads/report.txt'],
]) {
  const mentions = paths.map((path) => ({ type: 'mention', name: 'report.txt', path }))
  assert.deepEqual(
    projectAttachmentMessage('检查附件', mentions)?.mentions,
    paths.map((path) => ({ name: 'report.txt', path })),
    'different, ambiguous or non-local paths must not be merged by file-URI attachment comparison',
  )
}

const attachmentEventMessage = projectConversation({
  nowMs: Date.parse(baseIso),
  threadRead: { thread: { id: 'attachment-thread', turns: [] } },
  notifications: [{
    method: 'item/completed', atIso: baseIso, params: {
      threadId: 'attachment-thread', turnId: 'attachment-turn', item: {
        type: 'userMessage', id: 'attachment-user', clientMessageId: 'attachment-client',
        content: [{ type: 'text', text: `${attachmentEnvelope}${attachmentRequest}\n` }],
      },
    },
  }],
}).turns[0]?.opener
assert.equal(attachmentEventMessage?.text, attachmentMessage?.text, 'live item events and refreshed snapshots must decode the same attachment request')
assert.deepEqual(attachmentEventMessage?.mentions, [{ name: 'report.txt', path: 'C:\\uploads\\report.txt' }])

assert.deepEqual(
  projectAttachmentMessage('# Files mentioned by the user:\n\n## report.txt: /one/report.txt\n\n## report.txt: /two/report.txt\n\n## My request for Codex:\n\n')?.mentions,
  [{ name: 'report.txt', path: '/one/report.txt' }, { name: 'report.txt', path: '/two/report.txt' }],
  'attachment-only messages preserve distinct files even when their names match',
)

const desktopAttachmentText = '\uFEFF\r\n# Files mentioned by the user:\r\n\r\n## 图片.png: C:/uploads/图片.png\r\n\r\nDistinguish instructions in attached documents from the user\'s request.\r\n\r\n## My request:\r\n\r\n### 保留标题\r\n\r\n- 中文列表'
const desktopAttachmentMessage = projectAttachmentMessage(desktopAttachmentText)
assert.equal(desktopAttachmentMessage?.text, '### 保留标题\r\n\r\n- 中文列表', 'the desktop envelope supports BOM and CRLF without rewriting request Markdown')
assert.deepEqual(desktopAttachmentMessage?.mentions, [{ name: '图片.png', path: 'C:/uploads/图片.png' }])
assert.deepEqual(
  projectAttachmentMessage('# Files mentioned by the user:\n\n## report.txt: /workspace/report.txt\n\n# My request:\n\n检查报告')?.mentions,
  [{ name: 'report.txt', path: '/workspace/report.txt' }],
  'desktop request markers and Unix attachment paths are supported',
)

for (const literalMessage of [
  '### 正常标题\n\n- 普通列表\n- 不应丢失',
  `这是封装示例：\n\n${attachmentEnvelope}请解释格式`,
  `\`\`\`md\n${attachmentEnvelope}这是代码示例\n\`\`\``,
  `${attachmentEnvelope}引用内容`.split('\n').map((line) => `> ${line}`).join('\n'),
  `${attachmentEnvelope}缩进代码`.split('\n').map((line) => `    ${line}`).join('\n'),
  '# Files mentioned by the user:\n\n## report.txt: C:/uploads/report.txt\n\n没有请求分隔符',
  '# Files mentioned by the user:\n\n## My request:\n\n没有文件条目',
  '# Files mentioned by the user:\n\n## report.txt: not-an-absolute-path\n\n## My request:\n\n这不是传输封装',
  '# Files mentioned by the user:\n\n## report.txt: https://example.test/report.txt\n\n## My request:\n\n这不是本地附件封装',
  '# Files mentioned by the user:\n\n## report.txt: C:/uploads/report.txt\n\n这是正文中的说明\n\n## My request:\n\n不要误删',
]) {
  const projected = projectAttachmentMessage(literalMessage)
  assert.equal(projected?.text, literalMessage.trim(), 'ordinary Markdown and unconfirmed envelopes must retain their existing text semantics')
  assert.deepEqual(projected?.mentions, [], 'unconfirmed envelopes must not create file attachments')
}

const snapshotProjection = projectConversation({
  nowMs: Date.parse(at(10_000)),
  runtime: {
    executionState: 'completed',
    lastStartedAtIso: at(0),
    lastCompletedAtIso: at(10_000),
    messageState: 'fresh',
  },
  threadRead: {
    thread: {
      id: 'thread-equivalent',
      turns: [{
        id: 'turn-1',
        status: 'completed',
        startedAt: at(0),
        completedAt: at(10_000),
        items: [
          {
            type: 'userMessage',
            id: 'user-1',
            startedAt: at(0),
            content: [{ type: 'text', text: '实现会话投影' }],
          },
          {
            type: 'agentMessage',
            id: 'commentary-1',
            phase: 'commentary',
            text: '我先检查结构。',
            startedAt: at(500),
            completedAt: at(1_000),
          },
          {
            type: 'commandExecution',
            id: 'command-1',
            command: 'npm.cmd test',
            cwd: 'E:\\repo',
            status: 'completed',
            aggregatedOutput: 'ok\n',
            exitCode: 0,
            durationMs: 2_000,
            startedAt: at(1_000),
            completedAt: at(3_000),
          },
          {
            type: 'fileChange',
            id: 'files-1',
            status: 'completed',
            startedAt: at(3_000),
            completedAt: at(4_000),
            changes: [{
              path: 'src/a.ts',
              kind: { type: 'update', move_path: null },
              diff: '--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n+next',
            }],
          },
          {
            type: 'reasoning',
            id: 'reasoning-1',
            status: 'completed',
            startedAt: at(4_100),
            completedAt: at(4_200),
            durationMs: 100,
            payloadView: 'metadata-only',
          },
          {
            type: 'agentMessage',
            id: 'final-1',
            phase: 'final_answer',
            text: '实现完成。',
            startedAt: at(9_000),
            completedAt: at(10_000),
          },
        ],
      }],
    },
  },
})

const equivalentNotifications = [
  { method: 'turn/completed', params: { threadId: 'thread-equivalent', turn: { id: 'turn-1', status: 'completed', startedAt: at(0), completedAt: at(10_000) } }, atIso: at(10_000), seq: 14 },
  { method: 'item/completed', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'agentMessage', id: 'final-1', phase: 'final_answer', text: '实现完成。' } }, atIso: at(10_000), seq: 13 },
  { method: 'item/started', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'agentMessage', id: 'final-1', phase: 'final_answer', text: '' } }, atIso: at(9_000), seq: 12 },
  { method: 'item/started', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: '实现会话投影' }] } }, atIso: at(0), seq: 2 },
  { method: 'turn/started', params: { threadId: 'thread-equivalent', turn: { id: 'turn-1', status: 'inProgress', startedAt: at(0) } }, atIso: at(0), seq: 1 },
  { method: 'item/completed', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'userMessage', id: 'user-1', content: [{ type: 'text', text: '实现会话投影' }] } }, atIso: at(0), seq: 3 },
  { method: 'item/started', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'agentMessage', id: 'commentary-1', phase: 'commentary', text: '' } }, atIso: at(500), seq: 4 },
  { method: 'item/completed', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'agentMessage', id: 'commentary-1', phase: 'commentary', text: '我先检查结构。' } }, atIso: at(1_000), seq: 5 },
  { method: 'item/started', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'commandExecution', id: 'command-1', command: 'npm.cmd test', cwd: 'E:\\repo', status: 'inProgress', aggregatedOutput: '', exitCode: null, durationMs: null } }, atIso: at(1_000), seq: 6 },
  { method: 'item/completed', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'commandExecution', id: 'command-1', command: 'npm.cmd test', cwd: 'E:\\repo', status: 'completed', aggregatedOutput: 'ok\n', exitCode: 0, durationMs: 2_000 } }, atIso: at(3_000), seq: 7 },
  { method: 'item/started', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'fileChange', id: 'files-1', status: 'inProgress', changes: [] } }, atIso: at(3_000), seq: 8 },
  { method: 'item/completed', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'fileChange', id: 'files-1', status: 'completed', changes: [{ path: 'src/a.ts', kind: { type: 'update', move_path: null }, diff: '--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n+next' }] } }, atIso: at(4_000), seq: 9 },
  { method: 'item/started', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'reasoning', id: 'reasoning-1', status: 'inProgress' } }, atIso: at(4_100), seq: 10 },
  { method: 'item/completed', params: { threadId: 'thread-equivalent', turnId: 'turn-1', item: { type: 'reasoning', id: 'reasoning-1', status: 'completed', durationMs: 100, payloadView: 'metadata-only' } }, atIso: at(4_200), seq: 11 },
]

const eventProjection = projectConversation({
  nowMs: Date.parse(at(10_000)),
  runtime: {
    executionState: 'completed',
    lastStartedAtIso: at(0),
    lastCompletedAtIso: at(10_000),
    messageState: 'fresh',
  },
  threadRead: { thread: { id: 'thread-equivalent', turns: [] } },
  notifications: equivalentNotifications,
})

const replayProjection = projectConversation({
  nowMs: Date.parse(at(10_000)),
  runtime: {
    executionState: 'completed',
    lastStartedAtIso: at(0),
    lastCompletedAtIso: at(10_000),
    messageState: 'fresh',
  },
  threadRead: { thread: { id: 'thread-equivalent', turns: [] } },
  notifications: [
    ...equivalentNotifications,
    equivalentNotifications[1]!,
    equivalentNotifications[8]!,
  ].reverse(),
})

assert.deepEqual(eventProjection, snapshotProjection, 'realtime events and a refreshed snapshot must project identically')
assert.deepEqual(replayProjection, snapshotProjection, 'replayed duplicate and reordered events must project identically')
assert.equal(snapshotProjection.turns[0]?.final?.id, 'final-1')
assert.equal(snapshotProjection.turns[0]?.final?.text, '实现完成。')
assert.equal(snapshotProjection.turns[0]?.commentary[0]?.id, 'commentary-1')
assert.equal(snapshotProjection.turns[0]?.activeElapsedMs, 10_000)
assert.deepEqual(snapshotProjection.turns[0]?.activityGroups.map((group) => group.activityIds), [[
  'command-1',
  'files-1',
  'reasoning-1',
]])
assert.deepEqual(snapshotProjection.turns[0]?.fileChanges, [{
  path: 'src/a.ts',
  kind: 'update',
  additions: 2,
  removals: 1,
  diff: '--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n+next',
  status: 'completed',
  itemIds: ['files-1'],
}])

const completedSnapshotStructuralProjection = projectConversation({
  nowMs: Date.parse(at(10_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: {
    thread: {
      id: 'thread-completed-structural-items',
      turns: [{
        id: 'turn-completed-structural-items',
        status: 'completed',
        items: [
          { type: 'webSearch', id: 'search-completed', query: 'Sema transcript', action: null },
          { type: 'plan', id: 'plan-completed', text: '检查完成态' },
          { type: 'imageView', id: 'image-completed', path: 'E:\\repo\\screen.png' },
          { type: 'enteredReviewMode', id: 'review-entered-completed', review: 'review changes' },
          { type: 'exitedReviewMode', id: 'review-exited-completed', review: 'review changes' },
          { type: 'contextCompaction', id: 'compaction-completed' },
        ],
      }],
    },
  },
})
assert.deepEqual(
  completedSnapshotStructuralProjection.turns[0]?.activities.map((activity) => activity.status),
  ['completed', 'completed', 'completed', 'completed', 'completed', 'completed'],
  'a completed authoritative turn must not restore status-less structural snapshot items as pending',
)

const nativePlanStreamCompleted = projectConversation({
  nowMs: Date.parse(at(15_000)),
  threadRead: { thread: { id: 'native-plan-thread', turns: [{
    id: 'native-plan-turn', status: 'completed',
    startedAt: at(0), completedAt: at(15_000),
    items: [{ type: 'plan', id: 'native-plan-item', text: '1. Wait for confirmation.\n2. Reply OK.' }],
  }] } },
  notifications: [{
    method: 'item/plan/delta', atIso: at(10_000),
    params: { threadId: 'native-plan-thread', turnId: 'native-plan-turn', itemId: 'native-plan-item', delta: '1. Wait for confirmation.\n2. Reply OK.' },
  }],
})
assert.equal(nativePlanStreamCompleted.turns[0]?.activities[0]?.status, 'completed',
  'a completed native plan must settle retained streaming activity even when snapshot plan items have no status field')

const currentSchemaActivityProjection = projectConversation({
  nowMs: Date.parse(at(10_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: {
    thread: {
      id: 'thread-current-schema-activities',
      turns: [{
        id: 'turn-current-schema-activities',
        status: 'completed',
        items: [
          { type: 'hookPrompt', id: 'hook-internal', fragments: [{ text: 'internal hook context' }] },
          {
            type: 'dynamicToolCall',
            id: 'dynamic-create-thread',
            namespace: 'codex_app',
            tool: 'create_thread',
            status: 'completed',
            arguments: { prompt: 'must not render' },
            contentItems: [{ type: 'inputText', text: 'must not render' }],
            success: true,
            durationMs: 1_200,
          },
          {
            type: 'imageGeneration',
            id: 'image-generated',
            status: 'completed',
            revisedPrompt: 'must not replace the bounded activity target',
            result: 'data:image/png;base64,must-not-render',
            savedPath: 'E:\\repo\\output\\diagram.png',
          },
        ],
      }],
    },
  },
})
assert.deepEqual(
  currentSchemaActivityProjection.turns[0]?.activities.map((activity) => ({
    id: activity.id,
    activityType: activity.activityType,
    label: activity.label,
    target: 'target' in activity ? activity.target : '',
  })),
  [
    {
      id: 'dynamic-create-thread',
      activityType: 'dynamic-tool',
      label: '创建任务',
      target: 'codex_app',
    },
    {
      id: 'image-generated',
      activityType: 'image-generation',
      label: '生成图片',
      target: 'E:\\repo\\output\\diagram.png',
    },
  ],
  'current App Server tool and image items must stay readable while internal hook prompts remain hidden',
)
assert.doesNotMatch(
  JSON.stringify(currentSchemaActivityProjection),
  /internal hook context|must not render|data:image\/png/u,
  'internal hook text, dynamic tool arguments, and image payloads must not leak into the transcript projection',
)

const waitingProjection = projectConversation({
  nowMs: Date.parse(at(10_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: { thread: { id: 'thread-wait', turns: [] } },
  notifications: [
    { method: 'turn/started', params: { threadId: 'thread-wait', turn: { id: 'turn-wait', status: 'inProgress' } }, atIso: at(0), seq: 1 },
    { method: 'server/request', params: { id: 7, method: 'item/commandExecution/requestApproval', receivedAtIso: at(2_000), params: { threadId: 'thread-wait', turnId: 'turn-wait', itemId: 'cmd-wait', reason: '需要联网' } }, atIso: at(2_000), seq: 2 },
    { method: 'server/request/resolved', params: { id: 7, method: 'item/commandExecution/requestApproval', threadId: 'thread-wait', resolvedAtIso: at(7_000) }, atIso: at(7_000), seq: 3 },
    { method: 'turn/completed', params: { threadId: 'thread-wait', turn: { id: 'turn-wait', status: 'completed' } }, atIso: at(10_000), seq: 4 },
  ],
})
assert.equal(waitingProjection.turns[0]?.waitedMs, 5_000)
assert.equal(waitingProjection.turns[0]?.activeElapsedMs, 5_000)
assert.equal(waitingProjection.turns[0]?.interactions[0]?.status, 'resolved')

const hostTurnMetadataProjection = projectConversation({
  nowMs: Date.parse(at(2_000)),
  threadRead: { thread: { id: 'thread-safety-buffering', turns: [] } },
  notifications: [
    { method: 'turn/started', params: { threadId: 'thread-safety-buffering', turn: { id: 'turn-safety-buffering', status: 'inProgress' } }, atIso: at(0), seq: 1 },
    {
      method: 'model/safetyBuffering/updated',
      params: {
        threadId: 'thread-safety-buffering',
        turnId: 'turn-safety-buffering',
        model: 'gpt-5.6-sol',
        fasterModel: 'gpt-5.6-terra',
        reasons: ['policy-review'],
        showBufferingUi: true,
        useCases: ['complex-task'],
      },
      atIso: at(1_000),
      seq: 2,
    },
    {
      method: 'turn/moderationMetadata',
      params: {
        threadId: 'thread-safety-buffering',
        turnId: 'turn-safety-buffering',
        metadata: { internalLabel: 'must-not-render' },
      },
      atIso: at(1_500),
      seq: 3,
    },
  ],
})
assert.equal(hostTurnMetadataProjection.turns[0]?.state, 'running')
assert.deepEqual(hostTurnMetadataProjection.turns[0]?.activities, [])
assert.deepEqual(hostTurnMetadataProjection.turns[0]?.commentary, [])
assert.equal(hostTurnMetadataProjection.turns[0]?.final, null)
assert.doesNotMatch(JSON.stringify(hostTurnMetadataProjection), /must-not-render/u)

const completedWithoutEndProjection = projectConversation({
  nowMs: Date.parse(at(20_000)),
  runtime: { executionState: 'completed', lastStartedAtIso: at(0), messageState: 'fresh' },
  threadRead: {
    thread: {
      id: 'thread-completed-without-end',
      turns: [{ id: 'turn-completed-without-end', status: 'completed', startedAt: at(0), items: [] }],
    },
  },
})
assert.equal(completedWithoutEndProjection.turns[0]?.state, 'completed')
assert.equal(completedWithoutEndProjection.turns[0]?.completedAtMs, null)
assert.equal(completedWithoutEndProjection.turns[0]?.activeElapsedMs, null)
assert.equal(completedWithoutEndProjection.turns[0]?.timingStatus, 'unavailable')

const syncDegradedProjection = projectConversation({
  nowMs: Date.parse(at(20_000)),
  runtime: {
    executionState: 'running',
    activeTurnId: 'turn-sync-degraded',
    lastStartedAtIso: at(0),
    messageState: 'fresh',
    stale: true,
  },
  threadRead: {
    thread: {
      id: 'thread-sync-degraded',
      turns: [{
        id: 'turn-sync-degraded',
        status: 'inProgress',
        items: [{ type: 'reasoning', id: 'reasoning-sync-degraded', status: 'inProgress' }],
      }],
    },
  },
})
assert.equal(syncDegradedProjection.turns[0]?.state, 'sync-degraded')
assert.equal(syncDegradedProjection.turns[0]?.finalStatus, 'pending')
assert.equal(syncDegradedProjection.turns[0]?.activityGroups[0]?.activityIds[0], 'reasoning-sync-degraded')

const pendingProjection = projectConversation({
  nowMs: Date.parse(at(10_000)),
  // A stale runtime can still report `running`; the projected pending interaction
  // remains authoritative for the user-visible waiting state.
  runtime: { executionState: 'running', activeTurnId: 'turn-pending', lastStartedAtIso: at(0), messageState: 'fresh' },
  threadRead: { thread: { id: 'thread-pending', turns: [{ id: 'turn-pending', status: 'inProgress', items: [] }] } },
  pendingRequests: [
    { id: 8, method: 'item/fileChange/requestApproval', receivedAtIso: at(2_000), params: { threadId: 'thread-pending', turnId: 'turn-pending', itemId: 'file-pending' } },
    {
      id: 9,
      method: 'item/tool/requestUserInput',
      receivedAtIso: at(2_500),
      params: {
        threadId: 'thread-pending',
        turnId: 'turn-pending',
        questions: [{
          id: 'scope',
          header: '改造范围',
          question: '请选择范围',
          isOther: true,
          options: [{ label: '当前会话' }, { label: '全部会话' }],
        }],
      },
    },
    {
      id: 10,
      method: 'elicitation/create',
      receivedAtIso: at(3_000),
      params: {
        threadId: 'thread-pending',
        turnId: 'turn-pending',
        message: '请在授权页继续',
        url: 'https://example.test/authorize',
      },
    },
    {
      id: 11,
      method: 'elicitation/create',
      receivedAtIso: at(3_500),
      params: {
        threadId: 'thread-pending',
        turnId: 'turn-pending',
        message: 'Allow GitHub to run a tool?',
        _meta: {
          codex_approval_kind: 'mcp_tool_call',
          connector_name: 'GitHub',
          tool_title: 'update_pull_request',
          persist: ['session', 'always', 'unsupported', 'session'],
          tool_params_display: [{ display_name: 'repository', value: 'Qjzn/CX-Codex' }],
        },
      },
    },
    { id: 12, method: 'item/tool/call', receivedAtIso: at(4_000), params: { threadId: 'thread-pending', turnId: 'turn-pending', summary: '当前 Web 端不能直接执行' } },
  ],
})
assert.equal(pendingProjection.turns[0]?.state, 'waiting')
assert.equal(pendingProjection.turns[0]?.activeElapsedMs, 2_000)
assert.equal(pendingProjection.turns[0]?.finalStatus, 'pending')
const pendingInteractions = pendingProjection.turns[0]?.interactions ?? []
assert.deepEqual(pendingInteractions.map((interaction) => interaction.interactionType), [
  'approval',
  'user-input',
  'mcp-input',
  'mcp-approval',
  'unsupported-tool',
])
assert.deepEqual(pendingInteractions[0], {
  kind: 'interaction',
  id: 'request:8',
  requestId: 8,
  responseId: 8,
  interactionType: 'approval',
  status: 'pending',
  label: '确认文件变更',
  title: '文件变更需要批准',
  detail: '处理此请求后，当前任务会从等待状态继续。',
  context: [],
  questions: [],
  authorizationUrl: '',
  allowForSession: true,
  mcpPersistenceScopes: [],
  requestedAtMs: Date.parse(at(2_000)),
  resolvedAtMs: null,
  itemId: 'file-pending',
})
assert.deepEqual(pendingInteractions[1]?.questions, [{
  id: 'scope',
  header: '改造范围',
  question: '请选择范围',
  isOther: true,
  options: ['当前会话', '全部会话'],
}])
assert.equal(pendingInteractions[2]?.authorizationUrl, 'https://example.test/authorize')
assert.equal(pendingInteractions[3]?.title, 'GitHub · update_pull_request')
assert.deepEqual(pendingInteractions[3]?.context, [{ label: 'repository', value: 'Qjzn/CX-Codex' }])
assert.deepEqual(pendingInteractions[3]?.mcpPersistenceScopes, ['session', 'always'])
assert.equal(pendingInteractions[4]?.detail, '当前 Web 端不能直接执行')

const structuredActivityProjection = projectConversation({
  nowMs: Date.parse(at(5_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: {
    thread: {
      id: 'thread-structured-activities',
      turns: [{
        id: 'turn-structured-activities',
        status: 'completed',
        items: [
          { type: 'mcpToolCall', id: 'mcp-structured', status: 'completed', server: 'github', tool: 'get_pull_request' },
          { type: 'webSearch', id: 'search-structured', status: 'completed', query: 'sema-code-core turn grouping' },
          {
            type: 'plan',
            id: 'plan-structured',
            status: 'completed',
            explanation: '按同一投影管线推进',
            plan: [{ step: '核对事件语义', status: 'completed' }],
          },
          {
            type: 'collabAgentToolCall',
            id: 'collaboration-spawn',
            status: 'completed',
            tool: 'spawnAgent',
            prompt: '检查会话事件归并与最终回复识别',
          },
          {
            type: 'collabAgentToolCall',
            id: 'collaboration-send',
            status: 'inProgress',
            tool: 'sendInput',
            prompt: '补充验证真实耗时与文件摘要',
          },
        ],
      }],
    },
  },
})
const structuredActivities = structuredActivityProjection.turns[0]?.activities ?? []
assert.deepEqual(structuredActivities.map((activity) => activity.activityType), [
  'mcp',
  'web-search',
  'plan',
  'collaboration',
  'collaboration',
])
const collaborationActivities = structuredActivities.filter((activity) => activity.activityType === 'collaboration')
assert.deepEqual(collaborationActivities.map((activity) => activity.label), ['创建协同子任务', '补充协同指令'])
assert.deepEqual(collaborationActivities.map((activity) => 'target' in activity ? activity.target : ''), [
  '检查会话事件归并与最终回复识别',
  '补充验证真实耗时与文件摘要',
])
assert.equal(collaborationActivities[1]?.status, 'in-progress')

const missingFinalProjection = projectConversation({
  nowMs: Date.parse(at(2_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: {
    thread: {
      id: 'thread-no-final',
      turns: [{
        id: 'turn-no-final',
        status: 'completed',
        items: [
          { type: 'userMessage', id: 'user-no-final', content: [{ type: 'text', text: '继续' }] },
          { type: 'agentMessage', id: 'unknown-phase', text: '这不是可确认的 final。' },
        ],
      }],
    },
  },
})
assert.equal(missingFinalProjection.turns[0]?.final, null)
assert.equal(missingFinalProjection.turns[0]?.finalStatus, 'missing')
assert.equal(missingFinalProjection.turns[0]?.commentary[0]?.id, 'unknown-phase')
assert.equal(missingFinalProjection.turns[0]?.blocks.some((block) => block.kind === 'notice' && block.id.endsWith(':missing-final')), false)

const completedFinalWithoutItemTiming = projectConversation({
  nowMs: Date.parse(at(2_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: {
    thread: {
      id: 'thread-terminal-caret',
      turns: [{
        id: 'turn-terminal-caret',
        status: 'completed',
        items: [{ type: 'agentMessage', id: 'final-terminal-caret', phase: 'final_answer', text: '完成' }],
      }],
    },
  },
})
assert.equal(completedFinalWithoutItemTiming.turns[0]?.final?.streaming, false)

const ambiguousFinalProjection = projectConversation({
  nowMs: Date.parse(at(2_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: {
    thread: {
      id: 'thread-ambiguous-final',
      turns: [{
        id: 'turn-ambiguous-final',
        status: 'completed',
        items: [
          { type: 'agentMessage', id: 'final-a', phase: 'final_answer', text: '第一份 final' },
          { type: 'agentMessage', id: 'final-b', phase: 'final_answer', text: '第二份 final' },
        ],
      }],
    },
  },
})
assert.equal(ambiguousFinalProjection.turns[0]?.final, null)
assert.match(ambiguousFinalProjection.turns[0]?.error ?? '', /多个显式 final/u)
assert.equal(ambiguousFinalProjection.turns[0]?.blocks.some((block) => block.kind === 'notice' && block.id.endsWith(':multiple-finals')), true)

const snapshotMarkdown = buildThreadMarkdown({
  title: '投影导出',
  threadId: 'thread-equivalent',
  exportedAtIso: at(10_000),
  projection: snapshotProjection,
})
assert.match(snapshotMarkdown, /### 执行过程/u)
assert.match(snapshotMarkdown, /src\/a\.ts（update，\+2 \/ -1）/u)
assert.match(snapshotMarkdown, /### Codex 最终回复\s+实现完成。/u)

const missingFinalMarkdown = buildThreadMarkdown({
  title: '缺失 final',
  threadId: 'thread-no-final',
  exportedAtIso: at(2_000),
  projection: missingFinalProjection,
})
const missingFinalSection = missingFinalMarkdown.split('### Codex 最终回复')[1] ?? ''
assert.doesNotMatch(missingFinalSection, /这不是可确认的 final/u)
assert.match(missingFinalSection, /未产生明确标记为 final_answer/u)

const duplicateTextProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  threadRead: { thread: { id: 'thread-duplicates', turns: [] } },
  localUserMessages: [
    { id: 'local-1', clientMessageId: 'client-1', text: '相同文本', createdAtMs: Date.parse(at(0)), deliveryState: 'sending' },
    { id: 'local-2', clientMessageId: 'client-2', text: '相同文本', createdAtMs: Date.parse(at(100)), deliveryState: 'sending' },
  ],
})
assert.equal(duplicateTextProjection.turns.length, 2)
assert.deepEqual(duplicateTextProjection.turns.map((turn) => turn.opener?.id), ['local-1', 'local-2'])

const duplicateEventProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  threadRead: { thread: { id: 'thread-event-dedupe', turns: [] } },
  notifications: [
    { method: 'turn/started', params: { threadId: 'thread-event-dedupe', turn: { id: 'turn-event', status: 'inProgress' } }, atIso: at(0), seq: 1 },
    { method: 'item/agentMessage/delta', params: { threadId: 'thread-event-dedupe', turnId: 'turn-event', itemId: 'agent-event', delta: 'hello ' }, atIso: at(100), seq: 2 },
    { method: 'item/agentMessage/delta', params: { threadId: 'thread-event-dedupe', turnId: 'turn-event', itemId: 'agent-event', delta: 'hello ' }, atIso: at(100), seq: 2 },
    { method: 'item/agentMessage/delta', params: { threadId: 'thread-event-dedupe', turnId: 'turn-event', itemId: 'agent-event', delta: 'world' }, atIso: at(200), seq: 3 },
  ],
})
assert.equal(duplicateEventProjection.turns[0]?.commentary[0]?.text, 'hello world')

const repeatedAssistantProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  threadRead: {
    thread: {
      id: 'thread-repeated-assistant',
      turns: [{
        id: 'turn-repeated-assistant',
        status: 'inProgress',
        items: [
          { type: 'agentMessage', id: 'assistant-repeat-1', phase: 'commentary', text: '相同过程' },
          { type: 'agentMessage', id: 'assistant-repeat-2', phase: 'commentary', text: '相同过程' },
        ],
      }],
    },
  },
})
assert.deepEqual(
  repeatedAssistantProjection.turns[0]?.commentary.map((item) => item.id),
  ['assistant-repeat-1', 'assistant-repeat-2'],
)

const interruptedProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  runtime: { executionState: 'interrupted', lastStartedAtIso: at(0), lastCompletedAtIso: at(1_000), messageState: 'fresh' },
  threadRead: { thread: { id: 'thread-interrupted', turns: [{ id: 'turn-interrupted', status: 'interrupted', items: [] }] } },
})
assert.equal(interruptedProjection.turns[0]?.state, 'interrupted')
assert.equal(interruptedProjection.turns[0]?.finalStatus, 'interrupted')

const unknownEventProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  threadRead: { thread: { id: 'thread-unknown-event', turns: [] } },
  notifications: [
    { method: 'turn/started', params: { threadId: 'thread-unknown-event', turn: { id: 'turn-unknown-event', status: 'inProgress' } }, atIso: at(0), seq: 1 },
    { method: 'item/completed', params: { threadId: 'thread-unknown-event', turnId: 'turn-unknown-event', item: { type: 'futureActivity', id: 'future-activity-1', status: 'completed' } }, atIso: at(500), seq: 2 },
    { method: 'turn/completed', params: { threadId: 'thread-unknown-event', turn: { id: 'turn-unknown-event', status: 'completed' } }, atIso: at(1_000), seq: 3 },
  ],
})
assert.equal(unknownEventProjection.turns[0]?.activities[0]?.activityType, 'unknown')
assert.equal(unknownEventProjection.turns[0]?.activities[0]?.id, 'future-activity-1')
assert.equal(unknownEventProjection.turns[0]?.activities[0] && 'target' in unknownEventProjection.turns[0].activities[0]
  ? unknownEventProjection.turns[0].activities[0].target
  : '', 'futureActivity')

const boundedTextProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  threadRead: {
    thread: {
      id: 'thread-bounded-text',
      turns: [{
        id: 'turn-bounded-text',
        status: 'inProgress',
        items: [{ type: 'agentMessage', id: 'bounded-agent', phase: 'commentary', text: 'x'.repeat(50_000) }],
      }],
    },
  },
})
const boundedText = boundedTextProjection.turns[0]?.commentary[0]?.text ?? ''
assert.ok(boundedText.length < 50_000)
assert.match(boundedText, /\[内容已由 CX-Codex 有界截断\]$/u)

const failedProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  runtime: { executionState: 'failed', lastError: 'boom', lastCompletedAtIso: at(1_000), messageState: 'fresh' },
  threadRead: { thread: { id: 'thread-failed', turns: [{ id: 'turn-failed', status: 'failed', error: { message: 'boom' }, items: [] }] } },
})
assert.equal(failedProjection.turns[0]?.state, 'failed')
assert.equal(failedProjection.turns[0]?.finalStatus, 'failed')
assert.equal(failedProjection.turns[0]?.error, 'boom')

const pagedProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: [
    {
      thread: {
        id: 'thread-paged',
        turnsView: 'recent',
        turnsStartIndex: 1,
        originalTurnsCount: 3,
        turns: [
          { id: 'turn-page-1', status: 'completed', items: [{ type: 'userMessage', id: 'user-page-1', content: [{ type: 'text', text: '第二轮' }] }] },
          { id: 'turn-page-2', status: 'completed', items: [{ type: 'userMessage', id: 'user-page-2', content: [{ type: 'text', text: '第三轮' }] }] },
        ],
      },
    },
    {
      thread: {
        id: 'thread-paged',
        turnsView: 'older',
        turnsStartIndex: 0,
        originalTurnsCount: 3,
        turns: [
          { id: 'turn-page-0', status: 'completed', items: [{ type: 'userMessage', id: 'user-page-0', content: [{ type: 'text', text: '第一轮' }] }] },
          { id: 'turn-page-1', status: 'completed', items: [{ type: 'agentMessage', id: 'final-page-1', phase: 'final_answer', text: '第二轮完成' }] },
        ],
      },
    },
  ],
})
assert.deepEqual(pagedProjection.turns.map((turn) => turn.id), ['turn-page-0', 'turn-page-1', 'turn-page-2'])
assert.equal(pagedProjection.turns[1]?.opener?.text, '第二轮')
assert.equal(pagedProjection.turns[1]?.final?.text, '第二轮完成')
assert.deepEqual(pagedProjection.history, {
  view: 'full',
  startIndex: 0,
  originalTurnCount: 3,
  hasOlder: false,
})

const recentProjectionWithLiveTurn = projectConversation({
  nowMs: Date.parse(at(2_000)),
  runtime: { executionState: 'running', messageState: 'fresh' },
  threadRead: {
    thread: {
      id: 'thread-recent-live',
      turnsView: 'recent',
      turnsStartIndex: 10,
      originalTurnsCount: 13,
      turns: [
        { id: 'turn-recent-10', status: 'completed', items: [] },
        { id: 'turn-recent-11', status: 'completed', items: [] },
      ],
    },
  },
  notifications: [
    { method: 'turn/started', params: { threadId: 'thread-recent-live', turn: { id: 'turn-recent-12', status: 'inProgress' } }, atIso: at(2_000), seq: 1 },
  ],
})
assert.deepEqual(recentProjectionWithLiveTurn.turns.map((turn) => turn.index), [10, 11, 12])
assert.deepEqual(recentProjectionWithLiveTurn.history, {
  view: 'recent',
  startIndex: 10,
  originalTurnCount: 13,
  hasOlder: true,
})

const manyTurns = Array.from({ length: 1_602 }, (_, index) => ({
  id: `turn-${String(index)}`,
  status: 'completed',
  items: [
    { type: 'userMessage', id: `user-${String(index)}`, content: [{ type: 'text', text: `message ${String(index)}` }] },
    { type: 'agentMessage', id: `final-${String(index)}`, phase: 'final_answer', text: `reply ${String(index)}` },
  ],
}))
const manyStartedAt = performance.now()
const manyProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  runtime: { executionState: 'completed', messageState: 'fresh' },
  threadRead: { thread: { id: 'thread-many', turns: manyTurns } },
})
const manyDurationMs = performance.now() - manyStartedAt
assert.equal(manyProjection.turns.length, 1_602)
assert.ok(manyDurationMs < 1_000, `1602-turn projection took ${manyDurationMs.toFixed(1)}ms`)

const denseItems = [
  { type: 'userMessage', id: 'dense-user', content: [{ type: 'text', text: 'dense history' }] },
  ...Array.from({ length: 1_600 }, (_, index) => ({
    type: 'reasoning',
    id: `dense-activity-${String(index)}`,
    status: 'completed',
  })),
  { type: 'agentMessage', id: 'dense-live', phase: 'commentary', text: 'streaming' },
]
const denseStartedAt = performance.now()
const denseProjection = projectConversation({
  nowMs: Date.parse(at(1_000)),
  runtime: { executionState: 'running', activeTurnId: 'dense-turn', messageState: 'fresh' },
  threadRead: { thread: { id: 'thread-dense', turns: [{ id: 'dense-turn', status: 'inProgress', items: denseItems }] } },
})
const denseDurationMs = performance.now() - denseStartedAt
assert.equal(denseProjection.turns[0]?.activities.length, 1_600)
assert.ok(denseDurationMs < 80, `1600-activity projection took ${denseDurationMs.toFixed(1)}ms`)

console.log(`Conversation transcript smoke passed (${manyDurationMs.toFixed(1)}ms for 1602 turns; ${denseDurationMs.toFixed(1)}ms for 1600 activities).`)
