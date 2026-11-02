import { vi } from 'vitest'
import type { AuthController, AuthSnapshot } from '../auth/controller'

// Component-test fixture only. Real identity/role verification is tested in the
// controller suite; production never imports this module or exposes a role picker.
export function createTestAuth(initial: AuthSnapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const controller: AuthController = {
    getSnapshot: () => snapshot,
    getVerifiedSession: () => snapshot.status === 'signedIn' && snapshot.role
      ? { id: 'synthetic-adult-test-id', role: snapshot.role, accessToken: 'synthetic-test-token-not-valid-anywhere' }
      : null,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    start: vi.fn(() => () => {}),
    retry: vi.fn(async () => {}),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
  }
  return {
    controller,
    update(next: AuthSnapshot) {
      snapshot = next
      listeners.forEach((listener) => listener())
    },
  }
}
