export type BoundedAsyncRecoveryOptions<TResult> = {
  run: (attemptIndex: number) => Promise<TResult>
  recover: (error: unknown, attemptIndex: number) => Promise<TResult | null>
  shouldRetry: (error: unknown) => boolean
  retryDelaysMs: readonly number[]
  onRetry?: (retryNumber: number, maxRetries: number, error: unknown) => void | Promise<void>
  wait?: (delayMs: number) => Promise<void>
}

async function waitForRetry(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, Math.max(0, delayMs))
  })
}

export async function runWithBoundedRecovery<TResult>(
  options: BoundedAsyncRecoveryOptions<TResult>,
): Promise<TResult> {
  const wait = options.wait ?? waitForRetry
  for (let attemptIndex = 0; attemptIndex <= options.retryDelaysMs.length; attemptIndex += 1) {
    try {
      return await options.run(attemptIndex)
    } catch (error) {
      const recovered = await options.recover(error, attemptIndex)
      if (recovered !== null) return recovered
      if (!options.shouldRetry(error) || attemptIndex >= options.retryDelaysMs.length) {
        throw error
      }
      const retryNumber = attemptIndex + 1
      await options.onRetry?.(retryNumber, options.retryDelaysMs.length, error)
      await wait(options.retryDelaysMs[attemptIndex] ?? 0)
    }
  }
  throw new Error('Bounded recovery exhausted without a result')
}
