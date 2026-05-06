import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import {
  isWebAuthRequiredResponse,
  WEB_AUTH_EXPIRED_MESSAGE,
  WEB_AUTH_EXPIRED_STATUS,
  WEB_AUTH_STATUS_STORAGE_KEY,
} from './shared/webAuth'
import { initializeCapacitorBridge } from './mobile/capacitorBridge'
import './style.css'

console.log('Welcome to CX-Codex. GitHub: https://github.com/Qjzn/CX-Codex')

if (typeof window !== 'undefined') {
  void initializeCapacitorBridge()
  const nativeFetch = window.fetch.bind(window)
  let authReloadScheduled = false

  const persistAuthExpiryNotice = (message = WEB_AUTH_EXPIRED_MESSAGE): void => {
    try {
      window.sessionStorage.setItem(WEB_AUTH_STATUS_STORAGE_KEY, JSON.stringify({
        status: WEB_AUTH_EXPIRED_STATUS,
        message,
        at: Date.now(),
      }))
    } catch {
      // Keep auth recovery resilient if sessionStorage is unavailable.
    }
  }

  const scheduleAuthReload = (message?: string): void => {
    if (authReloadScheduled) return
    authReloadScheduled = true
    persistAuthExpiryNotice(message)
    window.setTimeout(() => {
      window.location.reload()
    }, 0)
  }

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await nativeFetch(input, init)
    if (isWebAuthRequiredResponse(response)) {
      let authMessage = WEB_AUTH_EXPIRED_MESSAGE
      try {
        const payload = await response.clone().json() as { error?: unknown }
        if (typeof payload?.error === 'string' && payload.error.trim()) {
          authMessage = payload.error.trim()
        }
      } catch {
        // Fall back to the default friendly message.
      }
      scheduleAuthReload(authMessage)
      return response
    }

    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
    if (
      url.includes('/codex-api/')
      && response.ok
      && response.headers.get('content-type')?.toLowerCase().includes('text/html')
    ) {
      scheduleAuthReload()
    }
    return response
  }) as typeof window.fetch
}

createApp(App).use(router).mount('#app')
