export class AppServerLineBuffer {
  private buffer = ''

  push(chunk: string, onLine: (line: string) => void): void {
    this.buffer += chunk

    let lineEnd = this.buffer.indexOf('\n')
    while (lineEnd !== -1) {
      const line = this.buffer.slice(0, lineEnd).trim()
      this.buffer = this.buffer.slice(lineEnd + 1)

      if (line.length > 0) {
        onLine(line)
      }

      lineEnd = this.buffer.indexOf('\n')
    }
  }

  clear(): void {
    this.buffer = ''
  }

  get pendingLength(): number {
    return this.buffer.length
  }
}
