import type { ReactNode } from 'react'
import { ParentReportContext } from './context'
import type { ParentReportAccess } from './context'

export function ParentReportProvider({ access, children }: { access: ParentReportAccess; children: ReactNode }) {
  return <ParentReportContext.Provider value={access}>{children}</ParentReportContext.Provider>
}
