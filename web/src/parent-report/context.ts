import { createContext, useContext } from 'react'
import type { ParentReportRepository } from './types'

export type ParentReportAccess = {
  repository: ParentReportRepository
}

export const ParentReportContext = createContext<ParentReportAccess | null>(null)

export function useParentReportAccess() {
  return useContext(ParentReportContext)
}
