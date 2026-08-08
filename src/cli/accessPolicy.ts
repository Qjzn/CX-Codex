export function isLoopbackBindHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  if (normalized === 'localhost' || normalized === 'localhost.') return true
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true

  const octets = normalized.split('.')
  if (octets.length !== 4 || octets[0] !== '127') return false
  return octets.every((octet) => {
    if (!/^\d{1,3}$/u.test(octet)) return false
    const value = Number(octet)
    return value >= 0 && value <= 255
  })
}

export function assertPasswordProtectedBind(host: string, password: string | undefined): void {
  if (password && password.trim().length > 0) return
  if (isLoopbackBindHost(host)) return
  throw new Error(
    'Password protection is required when binding outside localhost. '
    + 'Provide --password or bind to localhost, 127.0.0.1, or ::1.',
  )
}
