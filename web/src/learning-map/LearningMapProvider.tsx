import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createLearningMap, selectNextPlan } from './engine'
import { LearningMapError } from './types'
import { LearningMapContext } from './context'
import type { LearningMapContextValue, LearningMapLoadState } from './context'
import type { LearningMapChild, LearningMapRead, LearningMapRepository } from './repository'
import { LearningMapRepositoryError } from './repository'

type Versioned<T> = {
  version: number
  value: T
}

type ProviderOperation = {
  number: number
  version: number
  controller: AbortController
}

export function LearningMapProvider({ repository, children }: { repository: LearningMapRepository; children: ReactNode }) {
  const repositorySnapshot = useSyncExternalStore(repository.subscribe, repository.getVersion, repository.getVersion)
  const [state, setState] = useState<LearningMapLoadState>('idle')
  const [assignedState, setAssignedState] = useState<Versioned<LearningMapChild[]> | null>(null)
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null)
  const [readState, setReadState] = useState<Versioned<LearningMapRead> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestNumber = useRef(0)
  const operation = useRef<ProviderOperation | null>(null)

  // useSyncExternalStore may have rendered with a snapshot from before an auth
  // callback. Re-checking the scalar getter here keeps private state fail-closed
  // during that same render, before passive effects can clear it.
  const currentVersion = repository.getVersion()
  const readable = repositorySnapshot >= 0 && repositorySnapshot === currentVersion && repository.canRead()
  const version = readable ? currentVersion : -1
  const assignedChildren = useMemo(
    () => readable && assignedState?.version === version ? assignedState.value : [],
    [assignedState, readable, version],
  )
  const read = readable && readState?.version === version ? readState.value : null
  const visibleSelectedChildId = readable && assignedState?.version === version ? selectedChildId : null
  const cancelOperation = useCallback(() => {
    operation.current?.controller.abort()
    operation.current = null
    requestNumber.current += 1
  }, [])

  const startOperation = useCallback((): ProviderOperation => {
    cancelOperation()
    const next: ProviderOperation = {
      number: requestNumber.current + 1,
      version: repository.getVersion(),
      controller: new AbortController(),
    }
    requestNumber.current = next.number
    operation.current = next
    return next
  }, [cancelOperation, repository])

  const isCurrent = useCallback((next: ProviderOperation) => (
    operation.current === next &&
    !next.controller.signal.aborted &&
    repository.getVersion() === next.version &&
    repository.canRead()
  ), [repository])

  const readChild = useCallback(async (childId: string, next: ProviderOperation) => {
    if (!isCurrent(next)) return
    setState('loading')
    setError(null)
    try {
      const result = await repository.readChild(childId, { signal: next.controller.signal })
      if (!isCurrent(next)) return
      setReadState({ version: next.version, value: result })
      setSelectedChildId(childId)
      setState('ready')
    } catch (cause) {
      if (!isCurrent(next)) return
      if (cause instanceof LearningMapRepositoryError && cause.code === 'stale') return
      setReadState(null)
      setState(cause instanceof LearningMapRepositoryError && cause.code === 'not_authorized' ? 'unavailable' : 'error')
      setError(cause instanceof LearningMapRepositoryError ? cause.code : 'invalid_data')
    }
  }, [isCurrent, repository])

  const loadChildren = useCallback(async () => {
    const next = startOperation()
    setAssignedState(null)
    setReadState(null)
    setSelectedChildId(null)
    setError(null)
    if (!isCurrent(next)) {
      setState('unavailable')
      return
    }
    setState('loading')
    try {
      const nextChildren = await repository.listAssignedChildren({ signal: next.controller.signal })
      if (!isCurrent(next)) return
      setAssignedState({ version: next.version, value: nextChildren })
      if (nextChildren.length === 0) {
        setState('ready')
        return
      }
      await readChild(nextChildren[0].id, next)
    } catch (cause) {
      if (!isCurrent(next)) return
      if (cause instanceof LearningMapRepositoryError && cause.code === 'stale') return
      setAssignedState(null)
      setReadState(null)
      setState(cause instanceof LearningMapRepositoryError && cause.code === 'not_authorized' ? 'unavailable' : 'error')
      setError(cause instanceof LearningMapRepositoryError ? cause.code : 'invalid_data')
    }
  }, [isCurrent, readChild, repository, startOperation])

  useEffect(() => {
    const timer = setTimeout(() => { void loadChildren() }, 0)
    return () => {
      clearTimeout(timer)
      cancelOperation()
    }
  }, [cancelOperation, loadChildren, repositorySnapshot])

  const selectChild = useCallback((childId: string) => {
    if (!readable || !assignedChildren.some((child) => child.id === childId)) return
    const next = startOperation()
    setReadState(null)
    setSelectedChildId(childId)
    setError(null)
    void readChild(childId, next)
  }, [assignedChildren, readable, readChild, startOperation])

  const reload = useCallback(() => {
    cancelOperation()
    repository.clearCache()
    void loadChildren()
  }, [cancelOperation, loadChildren, repository])

  const mapResult = useMemo(() => {
    if (!read) return null
    try {
      return { map: createLearningMap(read.events, read.probes, { childId: read.child.id }), error: null }
    } catch (cause) {
      return { map: null, error: cause instanceof LearningMapError ? cause.reason : 'invalid_data' }
    }
  }, [read])
  const map = mapResult?.map ?? null
  const visibleState: LearningMapLoadState = readable
    ? (state === 'ready' && mapResult?.error ? 'error' : state)
    : 'unavailable'
  const getNextPlan = useCallback(() => map ? selectNextPlan(map) : null, [map])

  const value = useMemo<LearningMapContextValue>(() => ({
    repository,
    state: visibleState,
    children: assignedChildren,
    selectedChildId: visibleSelectedChildId,
    selectedChild: assignedChildren.find((child) => child.id === visibleSelectedChildId) ?? null,
    read,
    map,
    nextPlan: getNextPlan(),
    getNextPlan,
    error: readable ? (error ?? mapResult?.error ?? null) : null,
    truncated: readable ? Boolean(read?.sessionsTruncated || read?.resultsTruncated) : false,
    selectChild,
    reload,
  }), [assignedChildren, error, getNextPlan, map, mapResult?.error, read, reload, readable, repository, selectChild, visibleSelectedChildId, visibleState])

  return <LearningMapContext.Provider value={value}>{children}</LearningMapContext.Provider>
}
