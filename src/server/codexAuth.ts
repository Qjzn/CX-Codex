import { readFile } from 'node:fs/promises'
import { getCodexAuthPath } from './codexPaths.js'

type CodexAuthPayload = {
  tokens?: {
    access_token?: string
    account_id?: string
  }
}

export type CodexAuthSession = {
  accessToken: string
  accountId?: string
}

export async function readCodexAuth(): Promise<CodexAuthSession | null> {
  try {
    const raw = await readFile(getCodexAuthPath(), 'utf8')
    const auth = JSON.parse(raw) as CodexAuthPayload
    const token = auth.tokens?.access_token
    if (!token) return null
    return { accessToken: token, accountId: auth.tokens?.account_id ?? undefined }
  } catch {
    return null
  }
}
