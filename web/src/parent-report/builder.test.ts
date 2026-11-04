import { describe, expect, it } from 'vitest'
import type { FingerprintResponse } from '../contracts/basira'
import fingerprintFixture from '../../../contracts/fixtures/FingerprintResponse.example.json'
import skillGraph from '../../../contracts/skill-graph.json'
import { buildParentReport } from './builder'
import { ParentReportBuildError, type ApprovedReportSource, type ParentReportCopy } from './types'

const fingerprint = fingerprintFixture as FingerprintResponse
const skillId = skillGraph.skills[0].id

function source(overrides: Partial<ApprovedReportSource> = {}): ApprovedReportSource {
  return {
    detail: {
      session: {
        id: 'session-1',
        child_id: 'child-1',
        type: 'assessment',
        status: 'completed',
        started_at: '2026-01-01T10:00:00.000Z',
        ended_at: '2026-01-01T10:08:00.000Z',
        run_by: 'specialist-1',
      },
      child: {
        id: 'child-1',
        display_name: 'سارة',
        first_name: 'سارة',
        grade: 2,
        dialect_lexicon_id: 'kw',
        is_demo: true,
        specialist_id: 'specialist-1',
      },
      items: [],
      taps: [],
      fingerprints: [],
      plans: [],
      reports: [],
    },
    fingerprint: {
      id: 'fingerprint-1',
      session_id: 'session-1',
      response: { ...fingerprint, session_id: 'session-1' },
      review_status: 'approved',
      reviewed_by: 'specialist-1',
      reviewed_at: '2026-01-01T10:10:00.000Z',
      review_note: null,
    },
    plan: {
      id: 'plan-1',
      child_id: 'child-1',
      skill_ids: [skillId],
      item_ids: ['item-1'],
      review_status: 'approved',
      approved_by: 'specialist-1',
      approved_at: '2026-01-01T10:11:00.000Z',
    },
    ...overrides,
  }
}

function copy(overrides: Partial<ParentReportCopy> = {}): ParentReportCopy {
  return {
    progressNotes: [{ skill_id: skillId, note_ar: 'تدرّبت سارة على قراءة الحرف بحركاته.' }],
    homePlan: [{ title_ar: 'قراءة الكلمات', minutes: 5, words: ['بَابٌ', 'تِينٌ'], how_ar: 'اقرؤوا الكلمات بهدوء ثم أعيدوا المحاولة.' }],
    nextFocusAr: 'نواصل قراءة الكلمات المشكولة.',
    specialist: { name: 'أ. ليلى', contact: '555 1234' },
    ...overrides,
  }
}

const invalidSources: Array<[string, Partial<ApprovedReportSource>]> = [
  ['pending fingerprint', { fingerprint: { ...source().fingerprint, review_status: 'pending_review' } }],
  ['rejected plan', { plan: { ...source().plan, review_status: 'rejected' } }],
  ['mismatched fingerprint session', { fingerprint: { ...source().fingerprint, session_id: 'other-session' } }],
  ['incomplete session', { detail: { ...source().detail, session: { ...source().detail.session, status: 'abandoned' } } as unknown as ApprovedReportSource['detail'] }],
]

describe('buildParentReport', () => {
  it('correlates approved sources and excludes scorer payload fields from the family contract', () => {
    const responseBefore = structuredClone(source().fingerprint.response)
    const report = buildParentReport(source(), copy())

    expect(report).toMatchObject({ language: 'ar', child_first_name: 'سارة', session_date: '2026-01-01', duration_min: 8 })
    expect(report.practised).toEqual([{ skill_id: skillId, plain_ar: skillGraph.skills[0].label_ar }])
    expect(JSON.stringify(report)).not.toMatch(/phoneme|risk|diagnos|score/i)
    expect(source().fingerprint.response).toEqual(responseBefore)
  })

  it.each(invalidSources)('does not build from %s', (_label, overrides) => {
    expect(() => buildParentReport(source(overrides), copy())).toThrow(ParentReportBuildError)
  })

  it('rejects English family-facing copy instead of producing a mixed-language report', () => {
    try {
      buildParentReport(source(), copy({ nextFocusAr: 'Read the words.' }))
      throw new Error('expected invalid copy')
    } catch (error) {
      expect(error).toBeInstanceOf(ParentReportBuildError)
      expect((error as ParentReportBuildError).code).toBe('invalid_copy')
    }
    try {
      buildParentReport(source(), copy({ homePlan: [{ ...copy().homePlan[0], words: ['word'] }] }))
      throw new Error('expected invalid copy')
    } catch (error) {
      expect(error).toBeInstanceOf(ParentReportBuildError)
      expect((error as ParentReportBuildError).code).toBe('invalid_copy')
    }
  })
})
