import itemBankDocument from '../../../content/dist/item-bank.json'
import phoneticInventoryDocument from '../../../contracts/phonetic-inventory.json'
import type { Item, ItemBank, PhoneticInventory, PhoneticLetter, SkillId } from '../contracts/basira'
import { isCanonicalSkillId } from '../learning-map/engine'
import { parseContract } from '../scorer/validation'

const ARABIC_CHAR = /^\p{Script=Arabic}$/u
const ARABIC_MARK = /^\p{Mark}$/u
const SAFE_PUNCTUATION = /^[\s،؛؟!.,:٠-٩]+$/u

type RawPlan = {
  id?: unknown
  child_id?: unknown
  skill_ids?: unknown
  item_ids?: unknown
  review_status?: unknown
}

export type ApprovedTeachPlan = {
  id: string
  childId: string
  skillIds: SkillId[]
  itemIds: string[]
  reviewStatus: 'approved'
  source: 'approved_practice_plan'
}

export type TeachItem = Item & {
  skillIds: SkillId[]
}

export class TeachCatalogueError extends Error {
  readonly code: 'invalid_bank' | 'invalid_inventory' | 'invalid_plan' | 'unapproved_material' | 'missing_item'

  constructor(code: TeachCatalogueError['code']) {
    super(`teach_catalogue:${code}`)
    this.name = 'TeachCatalogueError'
    this.code = code
  }
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function arabicOnly(value: string): boolean {
  return [...value].every((character) => ARABIC_CHAR.test(character) || ARABIC_MARK.test(character) || SAFE_PUNCTUATION.test(character))
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => !text(entry))) throw new TeachCatalogueError('invalid_plan')
  return [...value]
}

function parsedBank(): ItemBank {
  try {
    return parseContract('ItemBank', itemBankDocument)
  } catch {
    throw new TeachCatalogueError('invalid_bank')
  }
}

export function getCanonicalTeachBank(): ItemBank {
  return parsedBank()
}

export function getCanonicalPhoneticInventory(): PhoneticInventory {
  try {
    return parseContract('PhoneticInventory', phoneticInventoryDocument)
  } catch {
    throw new TeachCatalogueError('invalid_inventory')
  }
}

export function resolveApprovedTeachPlan(raw: unknown): ApprovedTeachPlan {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TeachCatalogueError('invalid_plan')
  const value = raw as RawPlan
  if (!text(value.id) || !text(value.child_id) || value.review_status !== 'approved') {
    throw new TeachCatalogueError('invalid_plan')
  }
  const skillIds = stringArray(value.skill_ids) as SkillId[]
  const itemIds = stringArray(value.item_ids)
  if (skillIds.some((skill) => !isCanonicalSkillId(skill)) || itemIds.length === 0 || new Set(itemIds).size !== itemIds.length) throw new TeachCatalogueError('invalid_plan')
  return {
    id: value.id,
    childId: value.child_id,
    skillIds,
    itemIds,
    reviewStatus: 'approved',
    source: 'approved_practice_plan',
  }
}

function approvedItem(item: Item): boolean {
  return item.review.status === 'approved' && item.validation.passed === true && !item.probe_only &&
    typeof item.audio_path === 'string' && item.audio_path.startsWith('audio/') &&
    arabicOnly(item.text) && arabicOnly(item.text_plain)
}

export function selectApprovedTeachItems(
  plan: ApprovedTeachPlan,
  bank: ItemBank = parsedBank(),
  focusSkillIds: readonly string[] = [],
): TeachItem[] {
  if (plan.reviewStatus !== 'approved' || plan.source !== 'approved_practice_plan') {
    throw new TeachCatalogueError('unapproved_material')
  }
  const byId = new Map(bank.items.map((item) => [item.id, item]))
  const selected = plan.itemIds.map((itemId) => {
    const item = byId.get(itemId)
    if (!item || !approvedItem(item) || item.skill_ids.some((skill) => !plan.skillIds.includes(skill))) {
      throw new TeachCatalogueError(item ? 'unapproved_material' : 'missing_item')
    }
    return item
  })
  const focus = new Set(focusSkillIds)
  const ordered = focus.size === 0 ? selected : [...selected].sort((left, right) => {
    const leftFocused = left.skill_ids.some((skill) => focus.has(skill)) ? 0 : 1
    const rightFocused = right.skill_ids.some((skill) => focus.has(skill)) ? 0 : 1
    return leftFocused - rightFocused
  })
  return ordered.map((item) => ({ ...item, skillIds: [...item.skill_ids] }))
}

export function itemLetter(item: Item, inventory: PhoneticInventory = getCanonicalPhoneticInventory()): PhoneticLetter | null {
  const firstLetter = [...item.text].find((character) => /[\u0600-\u06ff]/u.test(character))
  return inventory.letters.find((letter) => letter.char === firstLetter && letter.review.status === 'approved') ?? null
}

export function isArabicOnlyText(value: string): boolean {
  return arabicOnly(value)
}
