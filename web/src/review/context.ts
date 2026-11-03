import { createContext, useContext } from 'react'
import type { ScorerClient } from '../scorer/client'
import type { createReviewRepository } from './repository'

export type ReviewAccess = {
  repository: ReturnType<typeof createReviewRepository>
  scorer: ScorerClient | null
}
export const ReviewContext = createContext<ReviewAccess | null>(null)
export function useReviewAccess() { return useContext(ReviewContext) }
