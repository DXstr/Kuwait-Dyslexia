import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { Stage0Context } from './context'
import type { Stage0Repository } from './repository'

export function Stage0Provider({ repository, children }: { repository: Stage0Repository; children: ReactNode }) {
  const version = useSyncExternalStore(repository.subscribe, repository.getVersion, repository.getVersion)
  const currentVersion = repository.getVersion()
  const readable = version >= 0 && version === currentVersion && repository.canRead()
  return <Stage0Context.Provider value={readable ? repository : null}>{children}</Stage0Context.Provider>
}
