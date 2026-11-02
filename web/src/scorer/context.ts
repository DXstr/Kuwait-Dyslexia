import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ScorerRuntime, ScorerSnapshot } from './runtime'

export const ScorerContext = createContext<ScorerRuntime | null>(null)

const emptySnapshot: ScorerSnapshot = {
  phase: 'idle',
  issue: null,
  mode: null,
}
const emptySubscribe = () => () => {}
const getEmptySnapshot = () => emptySnapshot

export type ScorerHookValue = ScorerSnapshot & {
  scorer: ScorerSnapshot
  runtime: ScorerRuntime
  client: ReturnType<ScorerRuntime['getClient']>
}

export function useScorer(): ScorerHookValue | null {
  const runtime = useContext(ScorerContext)
  const snapshot = useSyncExternalStore(
    runtime?.subscribe ?? emptySubscribe,
    runtime?.getSnapshot ?? getEmptySnapshot,
    runtime?.getSnapshot ?? getEmptySnapshot,
  )
  if (!runtime) return null
  return {
    ...snapshot,
    scorer: snapshot,
    runtime,
    client: runtime.getClient(),
  }
}
