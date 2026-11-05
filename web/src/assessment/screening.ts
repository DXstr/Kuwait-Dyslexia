import { getCanonicalTeachBank } from '../teach/catalogue'
import type { Item } from '../contracts/basira'
import type { AssessmentChild, AssessmentItem } from './types'

// A short screening set: every sound type the scorer can judge, from approved bank items only.
const SCREENING_MIX: ReadonlyArray<{ type: Item['type']; count: number; prefix?: string }> = [
  { type: 'letter_sound', count: 2 },
  { type: 'real_word', count: 3 },
  { type: 'pseudoword', count: 2 },
  { type: 'minimal_pair', count: 1, prefix: 'dot.' },
  { type: 'minimal_pair', count: 1, prefix: 'emph.' },
  { type: 'passage_vowelized', count: 1 },
]

function gradeBand(grade: number): string {
  return grade >= 4 ? '4-6' : '2-3'
}

export function selectScreeningItems(child: AssessmentChild, bank = getCanonicalTeachBank()): AssessmentItem[] {
  const approved = bank.items.filter((item) => item.review.status === 'approved' && item.validation.passed === true && !item.probe_only)
  const band = gradeBand(child.grade)
  const selected: Item[] = []
  for (const { type, count, prefix } of SCREENING_MIX) {
    const matches = (item: Item) => item.type === type && !selected.includes(item) &&
      (!prefix || item.skill_ids.some((skill) => skill.startsWith(prefix)))
    const inBand = approved.filter((item) => matches(item) && item.grade_band === band)
    const pool = inBand.length >= count ? inBand : approved.filter(matches)
    selected.push(...pool.slice(0, count))
  }
  return selected.map((item) => ({
    id: item.id,
    type: item.type,
    text: item.text,
    dialectLexiconId: child.dialectLexiconId as AssessmentItem['dialectLexiconId'],
    synthetic: true,
  }))
}
