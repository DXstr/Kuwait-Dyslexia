import type { ReactNode } from 'react'
import { AssessmentContext } from './context'
import type { AssessmentRuntime } from './runtime'

export function AssessmentProvider({ runtime, children }: { runtime: AssessmentRuntime; children: ReactNode }) {
  return <AssessmentContext.Provider value={runtime}>{children}</AssessmentContext.Provider>
}
