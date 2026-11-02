export type ScorerConfig = {
  mode: 'mock' | 'real'
  baseUrl: string | null
}

function configurationError(): never {
  // Do not include rejected environment values: a URL or key may contain a secret.
  throw new Error('Scorer configuration is invalid')
}

function isBlank(value: unknown): value is undefined | null | string {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

function hasUnsafeCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code === 0x7f || code <= 0x1f || /\s/u.test(character)) return true
  }
  return false
}

function isAllowedHttpLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function normalizeScorerUrl(raw: unknown): string | null {
  if (isBlank(raw)) return null
  if (typeof raw !== 'string' || hasUnsafeCharacters(raw)) configurationError()
  if (!/^https?:\/\//iu.test(raw) || raw.includes('?') || raw.includes('#')) configurationError()

  const authorityStart = raw.indexOf('//') + 2
  const remainder = raw.slice(authorityStart)
  const authorityEnd = remainder.search(/[/?#]/u)
  const authority = remainder.slice(0, authorityEnd === -1 ? remainder.length : authorityEnd)
  if (authority.includes('@')) configurationError()

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return configurationError()
  }

  const isHttps = url.protocol === 'https:'
  const isLocalHttp = url.protocol === 'http:' && isAllowedHttpLoopback(url.hostname)
  if ((!isHttps && !isLocalHttp) || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    configurationError()
  }

  return url.href.replace(/\/+$/u, '')
}

export function readScorerConfig(environment: Record<string, unknown>): ScorerConfig {
  const rawLegacyUrl = environment.VITE_SCORER_BASE_URL
  if (!isBlank(rawLegacyUrl)) configurationError()
  if (rawLegacyUrl !== undefined && rawLegacyUrl !== null && typeof rawLegacyUrl !== 'string') configurationError()

  const rawMode = environment.VITE_SCORER_MODE
  let mode: ScorerConfig['mode'] = 'mock'
  if (!isBlank(rawMode)) {
    if (typeof rawMode !== 'string' || (rawMode !== 'mock' && rawMode !== 'real')) configurationError()
    mode = rawMode
  }

  const baseUrl = normalizeScorerUrl(environment.VITE_SCORER_URL)
  if (mode === 'real' && baseUrl === null) configurationError()
  return { mode, baseUrl }
}
