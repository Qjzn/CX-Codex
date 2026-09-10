import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, open, rm, rmdir, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { classifyCodexSessionFileChange, CodexSessionFileChangeObserver } from '../src/server/codexSessionFileChangeObserver.js'
import { MAX_SESSION_METADATA_BYTES, readCodexSessionLogIdentity } from '../src/server/codexSessionIdentity.js'
import { resolveCodexSessionLogPath, validateCodexSessionLogPath } from '../src/server/codexSessionPathResolver.js'

const THREAD_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const FILE_SUFFIX_ID = '33333333-3333-4333-8333-333333333333'

function metadata(id = THREAD_ID, extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ type: 'session_meta', payload: { id, session_id: id, ...extra } })}\n`
}

async function withSessionHome(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cx-session-identity-'))
  try {
    await mkdir(join(root, 'sessions'), { recursive: true })
    await mkdir(join(root, 'archived_sessions'), { recursive: true })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('Session observation did not converge')
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

test('latest same-thread metadata wins over an older single-UUID filename', async () => {
  await withSessionHome(async (root) => {
    const oldPath = join(root, 'sessions', `rollout-old-${THREAD_ID}.jsonl`)
    const activePath = join(root, 'sessions', `rollout-active-${THREAD_ID}_${FILE_SUFFIX_ID}.jsonl`)
    await writeFile(oldPath, metadata())
    await writeFile(activePath, metadata())
    await utimes(oldPath, new Date(1_000), new Date(1_000))
    await utimes(activePath, new Date(2_000), new Date(2_000))
    assert.equal(await resolveCodexSessionLogPath(THREAD_ID, root), activePath)
    assert.equal(await resolveCodexSessionLogPath(FILE_SUFFIX_ID, root), '')
  })
})

test('a filename cannot impersonate a different metadata thread', async () => {
  await withSessionHome(async (root) => {
    const path = join(root, 'sessions', `rollout-${THREAD_ID}.jsonl`)
    await writeFile(path, metadata(OTHER_ID))
    assert.equal(await resolveCodexSessionLogPath(THREAD_ID, root), '')
    assert.equal(await resolveCodexSessionLogPath(OTHER_ID, root), '')
    assert.deepEqual(await classifyCodexSessionFileChange(`sessions/rollout-${THREAD_ID}.jsonl`, root), {
      source: 'session-log', threadId: OTHER_ID,
    })
  })
})

test('conflicting metadata identity is rejected', async () => {
  await withSessionHome(async (root) => {
    await writeFile(join(root, 'sessions', `rollout-${THREAD_ID}.jsonl`), metadata(THREAD_ID, { session_id: OTHER_ID }))
    assert.equal(await resolveCodexSessionLogPath(THREAD_ID, root), '')
  })
})

test('watcher routes double-UUID appends to metadata identity', async () => {
  await withSessionHome(async (root) => {
    const changes: string[] = []
    const errors: unknown[] = []
    const path = join(root, 'sessions', `rollout-${THREAD_ID}_${FILE_SUFFIX_ID}.jsonl`)
    await writeFile(path, metadata())
    const observer = new CodexSessionFileChangeObserver({
      codexHomeDir: root,
      debounceMs: 15,
      minEmitIntervalMs: 25,
      maxWaitMs: 50,
      onChange: (change) => changes.push(change.threadId),
      onError: (error) => errors.push(error),
    })
    try {
      observer.start()
      await appendFile(path, '{"type":"event_msg","payload":{}}\n')
      await waitUntil(() => changes.length > 0)
      assert.deepEqual([...new Set(changes)], [THREAD_ID])
      assert.deepEqual(errors, [])
    } finally {
      observer.dispose()
    }
  })
})

test('newest valid metadata is selected across live and archived roots', async () => {
  await withSessionHome(async (root) => {
    await mkdir(join(root, 'sessions', '2026', '09'), { recursive: true })
    const live = join(root, 'sessions', '2026', '09', `rollout-${THREAD_ID}.jsonl`)
    const archivedName = `rollout-archived-${THREAD_ID}_${FILE_SUFFIX_ID}.jsonl`
    const archived = join(root, 'archived_sessions', archivedName)
    const invalid = join(root, 'sessions', `rollout-newest-${THREAD_ID}.jsonl`)
    await writeFile(live, metadata())
    await writeFile(archived, metadata(THREAD_ID.toUpperCase()))
    await writeFile(invalid, '{"type":"session_meta","payload":')
    await utimes(live, new Date(1_000), new Date(1_000))
    await utimes(archived, new Date(2_000), new Date(2_000))
    await utimes(invalid, new Date(3_000), new Date(3_000))
    assert.equal(await resolveCodexSessionLogPath(THREAD_ID, root), archived)
    assert.deepEqual(await classifyCodexSessionFileChange(`archived_sessions/${archivedName}`, root), {
      source: 'session-log', threadId: THREAD_ID,
    })
  })
})

test('malformed, missing, conflicting, oversized and non-first metadata cannot establish identity', async () => {
  await withSessionHome(async (root) => {
    const relativePath = `sessions/rollout-${THREAD_ID}.jsonl`
    const path = join(root, relativePath)
    const malformedInputs = [
      '', '{}\n', '{not json}\n',
      `${JSON.stringify({ type: 'event_msg', payload: { id: THREAD_ID } })}\n${metadata()}`,
      metadata(THREAD_ID, { id: 'not-an-id' }),
      metadata(THREAD_ID, { thread_id: OTHER_ID }),
      metadata(THREAD_ID, { threadId: '' }),
      metadata(THREAD_ID, { sessionId: OTHER_ID }),
      metadata().trimEnd(),
      metadata(THREAD_ID, { padding: 'x'.repeat(MAX_SESSION_METADATA_BYTES) }),
    ]
    for (const input of malformedInputs) {
      await writeFile(path, input)
      assert.equal(await readCodexSessionLogIdentity(relativePath, root), null)
      assert.equal(await classifyCodexSessionFileChange(relativePath, root), null)
    }
    await writeFile(path, Buffer.concat([Buffer.from(metadata().trimEnd()), Buffer.from([0xff, 0x0a])]))
    assert.equal(await readCodexSessionLogIdentity(relativePath, root), null)
  })
})

test('large conversation bodies never enter metadata parsing', async () => {
  await withSessionHome(async (root) => {
    const relativePath = `sessions/rollout-${THREAD_ID}_${FILE_SUFFIX_ID}.jsonl`
    const path = join(root, relativePath)
    const header = metadata(THREAD_ID, { padding: 'x'.repeat(70_000) })
    await writeFile(path, Buffer.concat([Buffer.from(header), Buffer.from([0xff, 0xff, 0xff])]))
    const handle = await open(path, 'r+')
    try {
      await handle.truncate(160 * 1024 * 1024)
    } finally {
      await handle.close()
    }
    assert.equal((await readCodexSessionLogIdentity(relativePath, root))?.threadId, THREAD_ID)
    assert.equal(await resolveCodexSessionLogPath(THREAD_ID, root), path)
  })
})

test('escaped paths, invalid IDs and unrelated roots are rejected', async () => {
  await withSessionHome(async (root) => {
    await mkdir(join(root, 'outside'))
    await writeFile(join(root, 'outside', 'private.jsonl'), metadata())
    for (const path of [
      'sessions/../outside/private.jsonl', 'sessions/../../outside/private.jsonl',
      'sessions\\..\\outside\\private.jsonl', 'outside/private.jsonl',
      'sessions/.. /outside/private.jsonl', 'sessions/.../outside/private.jsonl',
      join(root, 'outside', 'private.jsonl'), 'sessions/file.jsonl:stream',
      'sessions//file.jsonl', 'sessions/./file.jsonl', 'sessions/file\0.jsonl',
    ]) {
      assert.equal(await classifyCodexSessionFileChange(path, root), null)
    }
    assert.equal(await resolveCodexSessionLogPath('../outside', root), '')
    assert.equal(await classifyCodexSessionFileChange(null, root), null)
    assert.deepEqual(await classifyCodexSessionFileChange(Buffer.from('session_index.jsonl'), root), {
      source: 'session-index', threadId: '',
    })
  })
})

test('directory junctions/symlinks and redirected session roots cannot expose outside logs', async () => {
  await withSessionHome(async (root) => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, `rollout-${THREAD_ID}.jsonl`), metadata())
    const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir'
    await symlink(outside, join(root, 'sessions', 'redirected'), directoryLinkType)
    await rmdir(join(root, 'archived_sessions'))
    await symlink(outside, join(root, 'archived_sessions'), directoryLinkType)
    assert.equal(await readCodexSessionLogIdentity(`sessions/redirected/rollout-${THREAD_ID}.jsonl`, root), null)
    assert.equal(await resolveCodexSessionLogPath(THREAD_ID, root), '')
  })
})

test('file symlinks cannot establish metadata identity', async (context) => {
  await withSessionHome(async (root) => {
    const outside = join(root, 'outside.jsonl')
    await writeFile(outside, metadata())
    const relativePath = `sessions/rollout-${THREAD_ID}.jsonl`
    try {
      await symlink(outside, join(root, relativePath), 'file')
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM') {
        context.skip('This host does not grant file-symlink creation; directory redirection is tested separately.')
        return
      }
      throw error
    }
    assert.equal(await readCodexSessionLogIdentity(relativePath, root), null)
    assert.equal(await resolveCodexSessionLogPath(THREAD_ID, root), '')
  })
})

test('partial headers retry on append and replaced files do not reuse an old identity', async () => {
  await withSessionHome(async (root) => {
    const relativePath = `sessions/rollout-${THREAD_ID}_${FILE_SUFFIX_ID}.jsonl`
    const path = join(root, relativePath)
    const changes: string[] = []
    const observer = new CodexSessionFileChangeObserver({
      codexHomeDir: root, debounceMs: 15, minEmitIntervalMs: 25, maxWaitMs: 50,
      onChange: (change) => changes.push(change.threadId),
    })
    try {
      observer.start()
      await writeFile(path, metadata().trimEnd())
      await new Promise((resolve) => setTimeout(resolve, 90))
      assert.equal(changes.length, 0)
      await appendFile(path, '\n')
      await waitUntil(() => changes.includes(THREAD_ID))
      await rm(path)
      await writeFile(path, metadata(OTHER_ID))
      await waitUntil(() => changes.includes(OTHER_ID))
      assert.equal(changes.includes(FILE_SUFFIX_ID), false)
    } finally {
      observer.dispose()
    }
  })
})

test('disposing an observer suppresses pending file emissions', async () => {
  await withSessionHome(async (root) => {
    const path = join(root, 'sessions', `rollout-${THREAD_ID}.jsonl`)
    await writeFile(path, metadata())
    const changes: string[] = []
    const observer = new CodexSessionFileChangeObserver({
      codexHomeDir: root, debounceMs: 30, minEmitIntervalMs: 0, maxWaitMs: 60,
      onChange: (change) => changes.push(change.threadId),
    })
    observer.start()
    await appendFile(path, '{}\n')
    await new Promise((resolve) => setTimeout(resolve, 5))
    observer.dispose()
    await new Promise((resolve) => setTimeout(resolve, 90))
    assert.deepEqual(changes, [])
  })
})

test('explicit RPC paths may have arbitrary names when same-thread metadata validates', async () => {
  await withSessionHome(async (root) => {
    const path = join(root, 'sessions', 'renamed-by-host.jsonl')
    await writeFile(path, metadata())
    assert.equal(await validateCodexSessionLogPath(path, THREAD_ID, root), path)
    assert.equal(await resolveCodexSessionLogPath(THREAD_ID, root), '')
  })
})

test('explicit RPC paths reject cross-thread metadata and invalid thread IDs', async () => {
  await withSessionHome(async (root) => {
    const path = join(root, 'sessions', `rollout-${THREAD_ID}.jsonl`)
    await writeFile(path, metadata(OTHER_ID))
    assert.equal(await validateCodexSessionLogPath(path, THREAD_ID, root), '')
    assert.equal(await validateCodexSessionLogPath(path, 'not-a-thread-id', root), '')
  })
})

test('explicit RPC paths must be absolute and remain within the session roots', async () => {
  await withSessionHome(async (root) => {
    const outside = join(root, 'outside.jsonl')
    await writeFile(outside, metadata())
    await writeFile(join(root, 'sessions', 'inside.jsonl'), metadata())
    assert.equal(await validateCodexSessionLogPath(outside, THREAD_ID, root), '')
    assert.equal(await validateCodexSessionLogPath('sessions/inside.jsonl', THREAD_ID, root), '')
    assert.equal(await validateCodexSessionLogPath(join(root, 'sessions', '..', 'outside.jsonl'), THREAD_ID, root), '')
  })
})

test('explicit RPC paths reject corrupt or conflicting metadata', async () => {
  await withSessionHome(async (root) => {
    const path = join(root, 'archived_sessions', 'host-renamed.jsonl')
    await writeFile(path, '{broken}\n')
    assert.equal(await validateCodexSessionLogPath(path, THREAD_ID, root), '')
    await writeFile(path, metadata(THREAD_ID, { thread_id: OTHER_ID }))
    assert.equal(await validateCodexSessionLogPath(path, THREAD_ID, root), '')
  })
})
