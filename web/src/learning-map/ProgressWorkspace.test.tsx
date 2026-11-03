import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/I18nProvider'
import { ar } from '../i18n/messages'
import { createLearningMap } from './engine'
import { LearningMapContext } from './context'
import type { LearningMapContextValue } from './context'
import type { LearningMapRepository } from './repository'
import { ProgressWorkspace } from './ProgressWorkspace'

const childId = 'child-1'
const event = {
  childId,
  sessionId: 'session-1',
  eventId: 'item-result-1',
  at: '2026-11-02T00:00:00.000Z',
  synthetic: true,
  evidence: [{ skill_id: 'ls.alif' as const, correct: true, source: 'audio' as const }],
}

function value(overrides: Partial<LearningMapContextValue> = {}): LearningMapContextValue {
  const read = {
    child: { id: childId, firstName: 'طفل تجريبي', isDemo: true },
    events: [event],
    probes: [],
    storedMastery: [],
    sessionsRead: 1,
    sessionsTruncated: false,
    resultsTruncated: false,
  }
  const map = createLearningMap(read.events, read.probes, { childId })
  return {
    repository: {} as LearningMapRepository,
    state: 'ready',
    children: [read.child],
    selectedChildId: childId,
    selectedChild: read.child,
    read,
    map,
    nextPlan: null,
    getNextPlan: () => null,
    error: null,
    truncated: false,
    selectChild: () => {},
    reload: () => {},
    ...overrides,
  }
}

function renderWorkspace(context: LearningMapContextValue | null) {
  return render(
    <I18nProvider allowEnglish>
      <LearningMapContext.Provider value={context}>
        <ProgressWorkspace />
      </LearningMapContext.Provider>
    </I18nProvider>,
  )
}

describe('ProgressWorkspace', () => {
  it('renders no private progress view without its verified provider context', () => {
    const { container } = renderWorkspace(null)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows demo and synthetic banners next to the professional progress view', () => {
    renderWorkspace(value())
    expect(screen.getByText(ar.learningMapDemoBanner)).toBeVisible()
    expect(screen.getByText(ar.learningMapSyntheticBanner)).toBeVisible()
    expect(screen.getByText(ar.learningMapProvisionalDescription)).toBeVisible()
    expect(screen.getByRole('combobox', { name: ar.learningMapSkillLabel })).toHaveValue('ls.alif')
    expect(screen.getByRole('combobox', { name: ar.learningMapSkillLabel }).querySelectorAll('option')).toHaveLength(53)
    expect(screen.getByRole('table', { name: ar.learningMapTableCaption })).toBeVisible()
    expect(screen.getByText(ar.learningMapNoStoredHistory)).toBeVisible()
    expect(screen.getByText(/تشخيص/)).toBeVisible()
  })

  it('does not show a mastery claim or a no-gain flag when live probes are absent', () => {
    renderWorkspace(value())
    expect(screen.queryByText(ar.learningMapBandMastered)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.learningMapFlagged)).not.toBeInTheDocument()
    expect(screen.queryByText(ar.learningMapNoEvents)).not.toBeInTheDocument()
  })
})
