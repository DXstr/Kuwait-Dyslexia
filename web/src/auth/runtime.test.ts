import { describe, expect, it } from 'vitest'
import { readOAuthCallback } from './runtime'

describe('OAuth callback parsing', () => {
  it('does not process auth parameters on unrelated routes', () => {
    expect(readOAuthCallback(new URL('https://example.test/specialist?code=synthetic&role=admin'))).toBeUndefined()
  })

  it('accepts only one PKCE code and ignores any user-selected destination or role', () => {
    expect(readOAuthCallback(new URL('https://example.test/auth/callback?code=synthetic&next=https://evil.test&role=admin')))
      .toEqual({ code: 'synthetic', error: false })
  })

  it.each(['', '?code=a&code=b', '?code=synthetic&error=access_denied', '#error=access_denied', '#access_token=synthetic', '?code=%20', '?refresh_token=synthetic'])(
    'rejects missing, ambiguous, denied or implicit-token callbacks', (suffix) => {
      expect(readOAuthCallback(new URL(`https://example.test/auth/callback${suffix}`)))
        .toEqual({ code: null, error: true })
    },
  )
})
