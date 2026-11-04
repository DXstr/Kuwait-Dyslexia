import itemBankDocument from '../../../content/dist/item-bank.json'
import type { Item, ItemBank, ProbeRequest, ScoreItemResponse } from '../contracts/basira'
import { parseContract } from '../scorer/validation'
import type { AssessmentItem } from '../assessment/types'

export type ProbeBankItem = Item & { probe_only: true; review: Item['review'] & { status: 'approved' } }

const itemBank = parseContract('ItemBank', itemBankDocument as ItemBank)

function approvedProbeItem(item: Item): item is ProbeBankItem {
  return item.probe_only === true && item.review.status === 'approved' && item.validation.passed === true
}

/** Only reviewed, validated probe material may enter a Prove session. */
export function reviewedProbeItems(bank: ItemBank = itemBank): ProbeBankItem[] {
  const parsed = parseContract('ItemBank', bank)
  return parsed.items.filter(approvedProbeItem).map((item) => structuredClone(item))
}

export function asProbeSessionItem(item: ProbeBankItem, dialectLexiconId: string): AssessmentItem {
  if (!item.probe_only || item.review.status !== 'approved' || item.validation.passed !== true) {
    throw new Error('prove: unapproved probe material')
  }
  return {
    id: item.id,
    type: item.type,
    text: item.text,
    dialectLexiconId,
    synthetic: true,
  }
}

export function buildProbeRequest(
  sessionId: string,
  practised: readonly ScoreItemResponse[],
  unseen: readonly ScoreItemResponse[],
): ProbeRequest {
  return parseContract('ProbeRequest', {
    session_id: sessionId,
    practised: [...practised],
    unseen: [...unseen],
  })
}

export function freshProbeEventId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  if (!cryptoApi?.getRandomValues) throw new Error('prove: stable event identity unavailable')
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
