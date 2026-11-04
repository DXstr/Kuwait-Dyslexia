import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Stage0Repository } from './repository'

export const Stage0Context = createContext<Stage0Repository | null>(null)

const emptySubscribe = () => () => {}
const unavailableVersion = () => -1
const compatibilityVersion = () => 0

export function useStage0Repository() {
  return useContext(Stage0Context)
}

export function useStage0RepositoryState() {
  const repository = useStage0Repository()
  const subscribe = repository && typeof repository.subscribe === 'function' ? repository.subscribe : emptySubscribe
  const getVersion = repository && typeof repository.getVersion === 'function' ? repository.getVersion : repository ? compatibilityVersion : unavailableVersion
  const version = useSyncExternalStore(
    subscribe,
    getVersion,
    getVersion,
  )
  const currentVersion = getVersion()
  const readable = Boolean(
    repository &&
    version >= 0 &&
    version === currentVersion &&
    (typeof repository.canRead !== 'function' || repository.canRead()),
  )
  return { repository, version: readable ? currentVersion : -1, readable }
}
