import { describe, expect, it } from 'vitest'
import { buildPlanSelection, getCanonicalTeachBank, resolveApprovedTeachPlan, selectApprovedTeachItems } from '../teach/catalogue'
import { selectScreeningItems } from './screening'

const child = { id: 'child-1', firstName: 'سارة', grade: 3, dialectLexiconId: 'kw', isDemo: true }

describe('real assessment and practice material', () => {
  it('builds a varied screening set from approved bank items with the child dialect', () => {
    const items = selectScreeningItems(child)
    const bank = new Map(getCanonicalTeachBank().items.map((item) => [item.id, item]))
    expect(items).toHaveLength(10)
    expect(new Set(items.map((item) => item.id)).size).toBe(10)
    expect(new Set(items.map((item) => item.type))).toEqual(new Set(['letter_sound', 'real_word', 'pseudoword', 'minimal_pair', 'passage_vowelized']))
    for (const item of items) {
      expect(bank.get(item.id)?.review.status).toBe('approved')
      expect(item.dialectLexiconId).toBe('kw')
    }
  })

  it('builds a plan the teach screen accepts, leading with the focus skill', () => {
    const selection = buildPlanSelection(['emph.saad-siin'])
    const plan = resolveApprovedTeachPlan({ id: 'plan-1', child_id: 'child-1', skill_ids: selection.skillIds, item_ids: selection.itemIds, review_status: 'approved' })
    const items = selectApprovedTeachItems(plan)
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].skill_ids).toContain('emph.saad-siin')
  })
})
