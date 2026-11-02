export interface PublicAuthConfig {
  url: string
  key: string
}

function configurationError(): never {
  // Deliberately omit the rejected value: VITE_* values may have been misconfigured
  // with a secret and must not be repeated in logs or rendered into the page.
  throw new Error('Supabase browser configuration is invalid')
}

function isPublicKey(key: string) {
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) return true
  const parts = key.split('.')
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false
  try {
    const payload: unknown = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    // This is configuration validation, NOT identity verification. Only Supabase
    // verifies user tokens; decoding here merely rejects legacy service-role keys.
    return typeof payload === 'object' && payload !== null &&
      'role' in payload && payload.role === 'anon'
  } catch {
    return false
  }
}

export function readAuthConfig(environment: Record<string, unknown>): PublicAuthConfig | null {
  const rawURL = environment.VITE_SUPABASE_URL
  const rawKey = environment.VITE_SUPABASE_ANON_KEY
  if (!rawURL && !rawKey) return null
  if (typeof rawURL !== 'string' || typeof rawKey !== 'string') configurationError()
  if (rawURL !== rawURL.trim() || rawKey !== rawKey.trim() || !isPublicKey(rawKey)) configurationError()
  let url: URL
  try {
    url = new URL(rawURL)
  } catch {
    return configurationError()
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') configurationError()
  return { url: url.origin, key: rawKey }
}
