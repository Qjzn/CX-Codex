import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Network } from '@capacitor/network'
import {
  MOBILE_APP_PAUSE_EVENT,
  MOBILE_APP_RESUME_EVENT,
  MOBILE_BACK_BUTTON_EVENT,
  MOBILE_NETWORK_OFFLINE_EVENT,
  MOBILE_NETWORK_ONLINE_EVENT,
} from './events'

type MobileLifecycleEventDetail = {
  source: 'capacitor'
}

let initialized = false

function dispatchMobileEvent(name: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<MobileLifecycleEventDetail>(name, {
    detail: { source: 'capacitor' },
  }))
}

async function dispatchMobileBackButtonEvent(): Promise<void> {
  if (typeof window === 'undefined') return
  const event = new CustomEvent<MobileLifecycleEventDetail>(MOBILE_BACK_BUTTON_EVENT, {
    cancelable: true,
    detail: { source: 'capacitor' },
  })
  const shouldExitApp = window.dispatchEvent(event)
  if (shouldExitApp) {
    await CapacitorApp.exitApp()
  }
}

export async function initializeCapacitorBridge(): Promise<void> {
  if (initialized || typeof window === 'undefined') return
  initialized = true

  if (!Capacitor.isNativePlatform()) return

  try {
    await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      dispatchMobileEvent(isActive ? MOBILE_APP_RESUME_EVENT : MOBILE_APP_PAUSE_EVENT)
    })
    await CapacitorApp.addListener('resume', () => {
      dispatchMobileEvent(MOBILE_APP_RESUME_EVENT)
    })
    await CapacitorApp.addListener('pause', () => {
      dispatchMobileEvent(MOBILE_APP_PAUSE_EVENT)
    })
    await CapacitorApp.addListener('backButton', () => {
      void dispatchMobileBackButtonEvent().catch((error) => {
        console.warn('[mobile] failed to handle Android back button', error)
      })
    })

    await Network.addListener('networkStatusChange', ({ connected }) => {
      dispatchMobileEvent(connected ? MOBILE_NETWORK_ONLINE_EVENT : MOBILE_NETWORK_OFFLINE_EVENT)
    })
  } catch (error) {
    console.warn('[mobile] failed to initialize Capacitor bridge', error)
  }

  try {
    const status = await Network.getStatus()
    dispatchMobileEvent(status.connected ? MOBILE_NETWORK_ONLINE_EVENT : MOBILE_NETWORK_OFFLINE_EVENT)
  } catch {
    // Ignore startup network probe failures.
  }
}
