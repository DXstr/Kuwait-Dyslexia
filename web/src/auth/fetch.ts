// The stock SDK still owns authentication and all API routes. This wrapper only
// bounds transport lifetime (including response bodies) and prevents private caching.
export const boundedSupabaseFetch: typeof fetch = (input, init) => {
  const controller = new AbortController()
  const upstream = init?.signal ?? (input instanceof Request ? input.signal : null)
  const abort = () => controller.abort()
  const timer = setTimeout(() => {
    upstream?.removeEventListener('abort', abort)
    controller.abort()
  }, 30_000)
  // Keep the deadline live while the SDK consumes the body, not just to headers.
  // Node's synthetic test runner must not be held open solely by this deadline.
  const nodeTimer = timer as unknown as { unref?: () => void }
  nodeTimer.unref?.()
  if (upstream?.aborted) controller.abort()
  else upstream?.addEventListener('abort', abort, { once: true })
  return fetch(input, { ...init, cache: 'no-store', signal: controller.signal })
}
