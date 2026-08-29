import { chmod, writeFile } from 'node:fs/promises'

export async function writePrivateUtf8File(path: string, content: string): Promise<void> {
  if (process.platform !== 'win32') {
    try {
      await chmod(path, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 })
  if (process.platform !== 'win32') {
    await chmod(path, 0o600)
  }
}
