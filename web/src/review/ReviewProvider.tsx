import type { ReactNode } from 'react'
import { ReviewContext } from './context'
import type { ReviewAccess } from './context'

export function ReviewProvider({ access, children }: { access: ReviewAccess; children: ReactNode }) {
  return <ReviewContext.Provider value={access}>{children}</ReviewContext.Provider>
}
