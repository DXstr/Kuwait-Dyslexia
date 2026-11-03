import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { AssessmentRuntime } from './runtime'
import type { QueueSnapshot } from './types'

export const AssessmentContext = createContext<AssessmentRuntime | null>(null)
const emptyQueue: QueueSnapshot = { pending: 0, processing: 0, exhausted: 0, frozen: false, lastError: null }
const emptySnapshot = { activeSession: null, queue: emptyQueue }
const emptySubscribe = () => () => {}
const getEmptySnapshot = () => emptySnapshot

export function useAssessment() {
  const runtime = useContext(AssessmentContext)
  const snapshot = useSyncExternalStore(
    runtime?.subscribe ?? emptySubscribe,
    runtime?.getSnapshot ?? getEmptySnapshot,
    runtime?.getSnapshot ?? getEmptySnapshot,
  )
  return useMemo(() => runtime ? {
    runtime,
    queue: runtime.queue,
    snapshot: snapshot.queue,
    activeSession: snapshot.activeSession,
  } : null, [runtime, snapshot])
}
