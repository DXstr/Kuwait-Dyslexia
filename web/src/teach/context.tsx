import { createContext, useContext } from 'react'
import type { TeachRepository } from './repository'

export const TeachContext = createContext<TeachRepository | null>(null)

export function useTeachRepository(): TeachRepository | null {
  return useContext(TeachContext)
}
