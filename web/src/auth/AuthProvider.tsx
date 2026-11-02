import type { ReactNode } from 'react'
import { AuthContext } from './context'
import type { AuthController } from './controller'

export function AuthProvider({ controller, children }: { controller: AuthController; children: ReactNode }) {
  return <AuthContext.Provider value={controller}>{children}</AuthContext.Provider>
}
