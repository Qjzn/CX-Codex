import type { CapacitorConfig } from '@capacitor/cli'

const serverUrl = process.env.CAP_SERVER_URL?.trim() ?? ''

const config: CapacitorConfig = {
  appId: 'com.cxcodex.bridge',
  appName: 'CX-Codex',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: /^http:\/\//iu.test(serverUrl),
      }
    : undefined,
}

export default config
