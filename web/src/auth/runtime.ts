import { createAuthClient } from './client'
import { readAuthConfig } from './config'
import { createAuthController } from './controller'

export function readOAuthCallback(url: URL) {
  if (url.pathname !== '/auth/callback') return undefined
  const codes = url.searchParams.getAll('code')
  const hash = new URLSearchParams(url.hash.slice(1))
  const error = ['error', 'error_code', 'error_description', 'access_token', 'refresh_token']
    .some((key) => url.searchParams.has(key) || hash.has(key)) ||
    codes.length !== 1 || !codes[0] || /\s/.test(codes[0]) ||
    [...codes[0]].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    codes[0].length > 8192
  return { code: error ? null : codes[0], error }
}

export function startBrowserAuth(environment: Record<string, unknown>, browser: Window = window) {
  const callback = readOAuthCallback(new URL(browser.location.href))
  const clearCallbackUrl = () => browser.history.replaceState(null, '', '/auth/callback')
  // Scrub codes/errors even when public configuration or storage is unavailable.
  // The code survives in memory only until the SDK's one-time exchange.
  if (callback) clearCallbackUrl()
  let connection: ReturnType<typeof createAuthClient> | null = null
  try {
    const config = readAuthConfig(environment)
    if (config) connection = createAuthClient(config, browser.sessionStorage)
  } catch {
    console.warn('auth_configuration_invalid')
  }
  const controller = createAuthController(connection?.client ?? null, {
    origin: browser.location.origin,
    callback,
    clearCallbackUrl,
    clearLocalSession: connection?.clearLocalSession,
    isOnline: () => browser.navigator.onLine,
  })
  // Start once outside React StrictMode: effect replay cannot redeem a PKCE code
  // twice. The controller independently deduplicates initialization and retries.
  const stop = controller.start()
  const revalidate = () => { void controller.retry() }
  const onFocus = () => {
    if (['signedIn', 'redirecting'].includes(controller.getSnapshot().status)) revalidate()
  }
  const onVisibility = () => { if (browser.document.visibilityState === 'visible') onFocus() }
  browser.addEventListener('online', revalidate)
  browser.addEventListener('offline', revalidate)
  browser.addEventListener('focus', onFocus)
  browser.document.addEventListener('visibilitychange', onVisibility)
  return {
    controller,
    dispose() {
      stop()
      browser.removeEventListener('online', revalidate)
      browser.removeEventListener('offline', revalidate)
      browser.removeEventListener('focus', onFocus)
      browser.document.removeEventListener('visibilitychange', onVisibility)
      connection?.client.auth.dispose()
    },
  }
}
