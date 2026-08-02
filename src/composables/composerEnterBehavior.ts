export function resolveSendWithEnterPreference(
  storedPreference: string | null,
  isMobile: boolean,
): boolean {
  if (storedPreference === '1') return true
  if (storedPreference === '0') return false
  return !isMobile
}
