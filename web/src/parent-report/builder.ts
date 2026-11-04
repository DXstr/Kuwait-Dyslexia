import type { ParentReport } from '../contracts/basira'
import skillGraph from '../../../contracts/skill-graph.json'
import { parseContract } from '../scorer/validation'
import type { ApprovedReportSource, ParentReportCopy } from './types'
import { ParentReportBuildError } from './types'

const skills = new Map(skillGraph.skills.map((skill) => [skill.id, skill.label_ar]))

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function arabicText(value: unknown): value is string {
  return text(value) && /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/u.test(value) && !/[A-Za-z]/u.test(value)
}

function fail(code: ConstructorParameters<typeof ParentReportBuildError>[0]): never {
  throw new ParentReportBuildError(code)
}

function dateOnly(value: string): string {
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.valueOf())) fail('invalid_source')
  return parsed.toISOString().slice(0, 10)
}

function durationMinutes(startedAt: string, endedAt: string): number {
  const started = Date.parse(startedAt)
  const ended = Date.parse(endedAt)
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) fail('invalid_source')
  return Math.max(0, Math.round((ended - started) / 60_000))
}

function validateSource(source: ApprovedReportSource): void {
  const { detail, fingerprint, plan } = source
  if (!detail || detail.session.status !== 'completed' || detail.session.child_id !== detail.child.id) fail('invalid_source')
  if (detail.child.specialist_id.length === 0 || detail.child.id.length === 0 || !arabicText(detail.child.first_name)) fail('invalid_source')
  if (!['approved', 'delivered'].includes(fingerprint.review_status) || !['approved', 'delivered'].includes(plan.review_status)) fail('source_not_approved')
  if (fingerprint.session_id !== detail.session.id || fingerprint.response.session_id !== detail.session.id) fail('source_mismatch')
  try {
    parseContract('FingerprintResponse', fingerprint.response)
  } catch {
    fail('source_mismatch')
  }
  if (plan.child_id !== detail.child.id || plan.skill_ids.length === 0) fail('source_mismatch')
  if (skills.size === 0 || plan.skill_ids.some((skillId) => !skills.has(skillId))) fail('source_mismatch')
  dateOnly(detail.session.started_at)
  durationMinutes(detail.session.started_at, detail.session.ended_at)
}

function validateCopy(copy: ParentReportCopy): void {
  if (!copy || !arabicText(copy.nextFocusAr) || !arabicText(copy.specialist.name) || !text(copy.specialist.contact)) fail('invalid_copy')
  if (!Array.isArray(copy.progressNotes) || copy.progressNotes.some((entry) => !text(entry.skill_id) || !arabicText(entry.note_ar))) fail('invalid_copy')
  if (!Array.isArray(copy.homePlan) || copy.homePlan.length < 1 || copy.homePlan.length > 3) fail('invalid_copy')
  if (copy.homePlan.some((entry) => !arabicText(entry.title_ar) || !Number.isInteger(entry.minutes) || entry.minutes < 5 || entry.minutes > 10 || !Array.isArray(entry.words) || entry.words.some((word) => !arabicText(word)) || !arabicText(entry.how_ar))) fail('invalid_copy')
}

/**
 * Builds only the family-safe canonical contract. Scorer/fingerprint JSON is
 * read for source correlation and never copied, summarized, or mutated.
 */
export function buildParentReport(source: ApprovedReportSource, copy: ParentReportCopy): ParentReport {
  validateSource(source)
  validateCopy(copy)
  const { detail, plan } = source
  const report: ParentReport = {
    language: 'ar',
    child_first_name: detail.child.first_name,
    session_date: dateOnly(detail.session.started_at),
    duration_min: durationMinutes(detail.session.started_at, detail.session.ended_at),
    practised: plan.skill_ids.map((skill_id) => ({ skill_id, plain_ar: skills.get(skill_id) as string })),
    progress_notes: copy.progressNotes.map((entry) => ({ skill_id: entry.skill_id, note_ar: entry.note_ar })),
    home_plan: copy.homePlan.map((entry) => ({
      title_ar: entry.title_ar,
      minutes: entry.minutes,
      words: [...entry.words],
      how_ar: entry.how_ar,
    })) as ParentReport['home_plan'],
    next_focus_ar: copy.nextFocusAr,
    specialist: { name: copy.specialist.name, contact: copy.specialist.contact },
  }
  try {
    return parseContract('ParentReport', report)
  } catch {
    fail('invalid_copy')
  }
}
