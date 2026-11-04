import type { ReactNode } from 'react'
import { ProbeContext } from './context'
import type { ProbeRuntime } from './runtime'

export function ProbeProvider({ runtime, children }: { runtime: ProbeRuntime; children: ReactNode }) {
  return <ProbeContext.Provider value={runtime}>{children}</ProbeContext.Provider>
}
