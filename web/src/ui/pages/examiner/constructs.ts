import type { Stage0Construct } from '../../../contracts/basira'
import type { MessageKey } from '../../../i18n/messages'
import type { Stage0Result } from '../../../stage0/repository'
import { stage0Catalog } from '../../../stage0/catalog'
import type { ExaminerConstructItem, ExaminerConstructState } from './ExaminerSidebar'

export const constructLabels: Record<Stage0Construct, MessageKey> = {
  itpa: 'stage0ConstructItpa',
  reversal: 'stage0ConstructReversal',
  nonverbal_iq: 'stage0ConstructNonverbalIq',
  visual_agnosia: 'stage0ConstructVisualAgnosia',
  dyscalculia: 'stage0ConstructDyscalculia',
  phonological_awareness: 'stage0ConstructPhonologicalAwareness',
  reading_fluency: 'stage0ConstructReadingFluency',
}

export function constructItems(saved: Partial<Record<Stage0Construct, Stage0Result>>, activeConstruct: Stage0Construct | null): ExaminerConstructItem[] {
  return stage0Catalog.map((entry) => {
    let state: ExaminerConstructState = entry.unavailable ? 'unavailable' : 'available'
    if (saved[entry.construct]) state = 'saved'
    if (activeConstruct === entry.construct) state = 'active'
    const status: MessageKey = state === 'unavailable'
      ? 'stage0LicenseStatus'
      : state === 'saved'
        ? 'stage0ResultPending'
        : state === 'active'
          ? 'stage0TaskNotice'
          : 'stage0TaskAvailable'
    return { construct: entry.construct, label: constructLabels[entry.construct], state, status }
  })
}
