const THREAD_SEARCH_RESULT_HOLD_MAX_DELTA = 4

export function shouldHoldThreadSearchResults(resultQuery: string, currentQuery: string): boolean {
  const resultKey = resultQuery.trim().toLowerCase()
  const currentKey = currentQuery.trim().toLowerCase()

  if (!resultKey || !currentKey) return false
  if (resultKey === currentKey) return true
  if (!currentKey.startsWith(resultKey) && !resultKey.startsWith(currentKey)) return false

  return Math.abs(currentKey.length - resultKey.length) <= THREAD_SEARCH_RESULT_HOLD_MAX_DELTA
}
