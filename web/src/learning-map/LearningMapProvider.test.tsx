import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { LearningMapRead, LearningMapRepository } from './repository'
import { LearningMapProvider } from './LearningMapProvider'
import { useLearningMap } from './context'

const childA = { id: 'child-a', firstName: 'طفل قديم', isDemo: true }
const childB = { id: 'child-b', firstName: 'طفل جديد', isDemo: true }

function readFor(child: typeof childA, evidenceCount: number): LearningMapRead {
  return {
    child,
    events: Array.from({ length: evidenceCount }, (_, index) => ({
      childId: child.id,
      sessionId: `${child.id}-session-${index}`,
      eventId: `${child.id}-event-${index}`,
      at: Date.parse('2026-11-02T00:00:00.000Z'),
      synthetic: true,
      evidence: [{ skill_id: 'ls.alif' as const, correct: true, source: 'audio' as const }],
    })),
    probes: [],
    storedMastery: [],
    sessionsRead: evidenceCount,
    sessionsTruncated: false,
    resultsTruncated: false,
  }
}

function createFakeRepository(initialChildren: typeof childA[], reads: Record<string, LearningMapRead> = {}) {
  let version = 0
  let readable = true
  let children = initialChildren
  const listeners = new Set<() => void>()
  const pendingReads = new Map<string, Promise<LearningMapRead>>()
  const resolveReads = new Map<string, (value: LearningMapRead) => void>()
  const repository: LearningMapRepository = {
    listAssignedChildren: vi.fn(async (options) => {
      if (options?.signal?.aborted) throw new Error('aborted')
      return children
    }),
    getAssignedChildren: vi.fn(async (options) => repository.listAssignedChildren(options)),
    readChild: vi.fn(async (childId, options) => {
      if (options?.signal?.aborted) throw new Error('aborted')
      const pending = pendingReads.get(childId)
      if (pending) return pending
      return reads[childId] ?? readFor(childA, 1)
    }),
    canRead: () => readable,
    getVersion: () => readable ? version : -1,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    clearCache: vi.fn(),
    dispose: vi.fn(),
  }

  return {
    repository,
    setIdentity(nextVersion: number, nextChildren: typeof childA[], nextReads: Record<string, LearningMapRead> = {}) {
      version = nextVersion
      children = nextChildren
      Object.assign(reads, nextReads)
      listeners.forEach((listener) => listener())
    },
    revoke() {
      readable = false
      listeners.forEach((listener) => listener())
    },
    holdRead(childId: string) {
      pendingReads.set(childId, new Promise<LearningMapRead>((resolve) => resolveReads.set(childId, resolve)))
    },
    resolveRead(childId: string, value: LearningMapRead) {
      resolveReads.get(childId)?.(value)
      pendingReads.delete(childId)
      resolveReads.delete(childId)
    },
  }
}

function Inspector() {
  const value = useLearningMap()
  return (
    <>
      <output data-testid="children">{value?.children.map((child) => child.firstName).join('|')}</output>
      <output data-testid="map-count">{value?.map?.skills.find((skill) => skill.skill_id === 'ls.alif')?.evidenceCounts.total ?? ''}</output>
      <output data-testid="state">{value?.state}</output>
      <button type="button" onClick={() => value?.selectChild('child-b')}>select-b</button>
    </>
  )
}

describe('LearningMapProvider privacy boundaries', () => {
  it('hides old child names and numeric map data synchronously across a verified specialist epoch', async () => {
    const oldRead = readFor(childA, 1)
    const newRead = readFor(childB, 2)
    const fake = createFakeRepository([childA], { [childA.id]: oldRead, [childB.id]: newRead })
    render(<LearningMapProvider repository={fake.repository}><Inspector /></LearningMapProvider>)

    await waitFor(() => expect(screen.getByTestId('children')).toHaveTextContent(childA.firstName))
    expect(screen.getByTestId('map-count')).toHaveTextContent('1')

    act(() => fake.setIdentity(1, [childB]))

    expect(screen.getByTestId('children')).not.toHaveTextContent(childA.firstName)
    expect(screen.getByTestId('map-count')).toBeEmptyDOMElement()
  })

  it('clears the previous child map immediately while the replacement child is loading', async () => {
    const fake = createFakeRepository([childA, childB], {
      [childA.id]: readFor(childA, 1),
      [childB.id]: readFor(childB, 2),
    })
    fake.holdRead(childB.id)
    render(<LearningMapProvider repository={fake.repository}><Inspector /></LearningMapProvider>)

    await waitFor(() => expect(screen.getByTestId('map-count')).toHaveTextContent('1'))
    fireEvent.click(screen.getByRole('button', { name: 'select-b' }))

    expect(screen.getByTestId('map-count')).toBeEmptyDOMElement()
    expect(screen.getByTestId('state')).toHaveTextContent('loading')

    act(() => fake.resolveRead(childB.id, readFor(childB, 2)))
    await waitFor(() => expect(screen.getByTestId('map-count')).toHaveTextContent('2'))
  })
})
