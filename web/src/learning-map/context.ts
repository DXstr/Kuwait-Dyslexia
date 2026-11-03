import { createContext, useContext } from 'react'
import type { LearningMap, LearningPlanSelection } from './types'
import type { LearningMapChild, LearningMapRead, LearningMapRepository } from './repository'

export type LearningMapLoadState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'

export type LearningMapContextValue = {
  repository: LearningMapRepository
  state: LearningMapLoadState
  children: LearningMapChild[]
  selectedChildId: string | null
  selectedChild: LearningMapChild | null
  read: LearningMapRead | null
  map: LearningMap | null
  nextPlan: LearningPlanSelection | null
  getNextPlan: () => LearningPlanSelection | null
  error: string | null
  truncated: boolean
  selectChild: (childId: string) => void
  reload: () => void
}

export const LearningMapContext = createContext<LearningMapContextValue | null>(null)

export function useLearningMap(): LearningMapContextValue | null {
  return useContext(LearningMapContext)
}
