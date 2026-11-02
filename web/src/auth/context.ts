import { createContext, useContext, useSyncExternalStore } from 'react'
import type { AuthController } from './controller'

export const AuthContext = createContext<AuthController | null>(null)

export function useAuth() {
  const controller = useContext(AuthContext)
  if (!controller) throw new Error('AuthProvider is required')
  const auth = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  return { auth, controller }
}
