import { createClient } from '@supabase/supabase-js'
import type { PublicAuthConfig } from './config'
import { boundedSupabaseFetch } from './fetch'

export function createAuthClient(config: PublicAuthConfig, storage: Storage) {
  const storageKey = `basira.auth:${config.url}`
  const probeKey = `${storageKey}-storage-check`
  // An unavailable storage backend must fail before OAuth starts: a memory-only
  // fallback would lose the PKCE verifier during the provider redirect.
  storage.setItem(probeKey, '1')
  storage.removeItem(probeKey)
  const client = createClient(config.url, config.key, {
    global: { fetch: boundedSupabaseFetch },
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: false,
      autoRefreshToken: true,
      persistSession: true,
      storageKey,
      storage,
    },
  })
  function clearLocalSession() {
    // Remove this client's SDK-owned session/verifier keys only. Other projects,
    // unrelated application preferences and browser storage are untouched.
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key === storageKey || key?.startsWith(`${storageKey}-`)) storage.removeItem(key)
    }
  }
  return { client, clearLocalSession }
}
