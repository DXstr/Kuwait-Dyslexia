import type { ReactNode } from 'react'
import { ScorerContext } from './context'
import type { ScorerRuntime } from './runtime'

export function ScorerProvider({ runtime, children }: { runtime: ScorerRuntime; children: ReactNode }) {
  return <ScorerContext.Provider value={runtime}>{children}</ScorerContext.Provider>
}
