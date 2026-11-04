import { describe, expect, it } from 'vitest'
import type { Item, ItemBank, PhoneticInventory } from '../contracts/basira'
import {
  getCanonicalPhoneticInventory,
  getCanonicalTeachBank,
  isArabicOnlyText,
  itemLetter,
  resolveApprovedTeachPlan,
  selectApprovedTeachItems,
  TeachCatalogueError,
} from './catalogue'

function planFor(item: Item, overrides: Record<string, unknown> = {}) {
  return resolveApprovedTeachPlan({
    id: 'plan-1',
    child_id: 'child-1',
    skill_ids: [...item.skill_ids],
    item_ids: [item.id],
    review_status: 'approved',
    ...overrides,
  })
}

describe('Teach catalogue gates', () => {
  it('selects only approved, validated, Arabic items with an actual audio source', () => {
    const bank = getCanonicalTeachBank()
    const item = bank.items.find((candidate) => candidate.type === 'vowel_tap') as Item
    const selected = selectApprovedTeachItems(planFor(item), bank)

    expect(selected).toHaveLength(1)
    expect(selected[0]).toMatchObject({ id: item.id, text: item.text, audio_path: item.audio_path })
    expect(isArabicOnlyText(selected[0].text)).toBe(true)
    expect(isArabicOnlyText(selected[0].text_plain)).toBe(true)
  })

  it('rejects probe-only material even when a plan incorrectly references it', () => {
    const bank = getCanonicalTeachBank()
    const probe = bank.items.find((candidate) => candidate.probe_only)
    expect(probe).toBeDefined()

    expect(() => selectApprovedTeachItems(planFor(probe!), bank)).toThrowError(
      expect.objectContaining({ code: 'unapproved_material' }),
    )
  })

  it('rejects a plan with duplicate or unknown item references before selection', () => {
    const bank = getCanonicalTeachBank()
    const item = bank.items[0]
    expect(() => resolveApprovedTeachPlan({
      id: 'plan-1', child_id: 'child-1', skill_ids: item.skill_ids, item_ids: [item.id, item.id], review_status: 'approved',
    })).toThrowError(TeachCatalogueError)
    expect(() => resolveApprovedTeachPlan({
      id: 'plan-1', child_id: 'child-1', skill_ids: ['not.canonical'], item_ids: [item.id], review_status: 'approved',
    })).toThrowError(TeachCatalogueError)
  })

  it('fails closed when an otherwise approved item has no audio path', () => {
    const bank = getCanonicalTeachBank()
    const item = bank.items.find((candidate) => candidate.type === 'letter_sound') as Item
    const noAudio = { ...item, audio_path: null }
    const altered: ItemBank = { ...bank, items: [noAudio] }

    expect(() => selectApprovedTeachItems(planFor(item), altered)).toThrowError(
      expect.objectContaining({ code: 'unapproved_material' }),
    )
  })

  it('renders a cue only from an approved canonical inventory row', () => {
    const bank = getCanonicalTeachBank()
    const item = bank.items[0]
    const inventory = getCanonicalPhoneticInventory()
    const approved = itemLetter(item, inventory)
    expect(approved?.review.status).toBe('approved')

    const blocked: PhoneticInventory = {
      ...inventory,
      letters: inventory.letters.map((letter) => letter.char === approved?.char
        ? { ...letter, review: { ...letter.review, status: 'unreviewed' } }
        : letter),
    }
    expect(itemLetter(item, blocked)).toBeNull()
  })

  it('does not treat English child copy as Arabic-only', () => {
    expect(isArabicOnlyText('قَلَم')).toBe(true)
    expect(isArabicOnlyText('Read قَلَم')).toBe(false)
    expect(isArabicOnlyText('قَلَم wrong')).toBe(false)
  })
})
