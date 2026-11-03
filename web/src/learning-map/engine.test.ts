import { describe, expect, it } from 'vitest'
import type { ProbeResponse, SkillEvidence, SkillId } from '../contracts/basira'
import {
  CANONICAL_SKILL_IDS,
  createLearningMap,
  LearningMapError,
  selectNextPlan,
} from './index'
import type { LearningMapEvent, LearningMapProbe } from './types'

const CHILD = 'child-1'
const at = (value: number): string => new Date(value).toISOString()

function event(
  skill_id: SkillId,
  correct: boolean,
  time: number,
  options: Partial<Pick<LearningMapEvent, 'sessionId' | 'eventId' | 'synthetic'>> = {},
  source: SkillEvidence['source'] = 'audio',
): LearningMapEvent {
  return {
    childId: CHILD,
    sessionId: options.sessionId ?? `s-${time}`,
    eventId: options.eventId ?? `e-${time}-${skill_id}`,
    at: at(time),
    synthetic: options.synthetic ?? false,
    evidence: [{ skill_id, correct, source }],
  }
}

function eventWithEvidence(
  evidence: SkillEvidence[],
  time: number,
  options: Partial<Pick<LearningMapEvent, 'sessionId' | 'eventId' | 'synthetic'>> = {},
): LearningMapEvent {
  return {
    childId: CHILD,
    sessionId: options.sessionId ?? `s-${time}`,
    eventId: options.eventId ?? `e-${time}`,
    at: at(time),
    synthetic: options.synthetic ?? false,
    evidence,
  }
}

function probe(
  sessionId: string,
  time: number,
  skill_id: SkillId | null,
  transfer: ProbeResponse['per_skill'][number]['transfer'],
  options: Partial<Pick<LearningMapProbe, 'completed' | 'eventId'>> & { nPractised?: number; nUnseen?: number; synthetic?: boolean } = {},
): LearningMapProbe {
  return {
    childId: CHILD,
    sessionId,
    eventId: options.eventId ?? `probe-${sessionId}-${time}`,
    at: at(time),
    completed: options.completed ?? true,
    response: {
      session_id: sessionId,
      model_version: 'test',
      synthetic: options.synthetic ?? false,
      per_skill: skill_id === null ? [] : [{
        skill_id,
        practised_accuracy: 1,
        unseen_accuracy: transfer === 'insufficient_data' ? null : 1,
        n_practised: options.nPractised ?? 1,
        n_unseen: options.nUnseen ?? 1,
        transfer,
      }],
    },
  }
}

function evidenceEvents(skill_id: SkillId, correct: number, total: number, start = 1): LearningMapEvent[] {
  return Array.from({ length: total }, (_, index) => event(skill_id, index < correct, start + index))
}

function state(result: ReturnType<typeof createLearningMap>, skill_id: SkillId) {
  return result.bySkillId[skill_id]
}

describe('createLearningMap', () => {
  it('loads all 53 canonical skills and leaves absent evidence unknown', () => {
    const result = createLearningMap([], [], { childId: CHILD })
    expect(result.skills).toHaveLength(53)
    expect(result.skills.map((skill) => skill.skill_id)).toEqual(CANONICAL_SKILL_IDS)
    expect(state(result, 'ls.alif')).toMatchObject({ mastery: null, band: 'unknown', mastered: false, noGainFlag: false })
    expect(result.synthetic).toBe(false)
  })

  it('uses exact 0.6 and 0.85 boundaries and requires transfer for mastery', () => {
    const events = [
      ...evidenceEvents('ls.alif', 3, 5),
      ...evidenceEvents('ls.baa', 17, 20, 100),
    ]
    const beforeProbe = createLearningMap(events, [], { childId: CHILD })
    expect(state(beforeProbe, 'ls.alif').band).toBe('growing')
    expect(state(beforeProbe, 'ls.baa')).toMatchObject({ mastery: 0.85, band: 'probe_due' })

    const mastered = createLearningMap(events, [probe('p1', 200, 'ls.baa', 'transfer_shown')], { childId: CHILD })
    expect(state(mastered, 'ls.baa')).toMatchObject({ band: 'mastered', mastered: true, latestTransfer: 'transfer_shown' })
  })

  it('demotes a mastered skill when its latest per-skill probe does not show transfer', () => {
    const events = evidenceEvents('ls.alif', 17, 20)
    const result = createLearningMap(events, [
      probe('p1', 100, 'ls.alif', 'transfer_shown'),
      probe('p2', 200, 'ls.alif', 'no_transfer_yet'),
    ], { childId: CHILD })
    expect(state(result, 'ls.alif')).toMatchObject({ band: 'probe_due', mastered: false, latestTransfer: 'no_transfer_yet' })

    const insufficient = createLearningMap(events, [
      probe('p1', 100, 'ls.alif', 'transfer_shown'),
      probe('p2', 200, 'ls.alif', 'insufficient_data'),
    ], { childId: CHILD })
    expect(state(insufficient, 'ls.alif')).toMatchObject({ band: 'probe_due', latestTransfer: 'insufficient_data' })
  })

  it('uses the latest completed probe that actually provides that skill', () => {
    const result = createLearningMap(evidenceEvents('ls.alif', 17, 20), [
      probe('p1', 100, 'ls.alif', 'transfer_shown'),
      probe('p2', 200, null, 'no_transfer_yet'),
    ], { childId: CHILD })
    expect(state(result, 'ls.alif')).toMatchObject({ band: 'mastered', latestTransfer: 'transfer_shown' })
  })

  it('does not count incomplete probes as a gate or no-gain cycle', () => {
    const events = evidenceEvents('ls.alif', 1, 2)
    const result = createLearningMap(events, [
      probe('p1', 10, 'ls.alif', 'no_transfer_yet'),
      probe('p2', 20, null, 'no_transfer_yet', { completed: false }),
      probe('p3', 30, null, 'no_transfer_yet'),
      probe('p4', 40, null, 'no_transfer_yet'),
    ], { childId: CHILD })
    expect(state(result, 'ls.alif').noGainFlag).toBe(false)
    expect(state(result, 'ls.alif').latestTransfer).toBe('no_transfer_yet')
  })

  it('requires a baseline plus three valid completed probe intervals for no-gain', () => {
    const events = evidenceEvents('ls.alif', 1, 2)
    const probes = [10, 20, 30, 40].map((time, index) => probe(`p${index}`, time, 'ls.alif', 'no_transfer_yet'))
    expect(state(createLearningMap(events, probes.slice(0, 3), { childId: CHILD }), 'ls.alif').noGainFlag).toBe(false)
    expect(state(createLearningMap(events, probes, { childId: CHILD }), 'ls.alif').noGainFlag).toBe(true)
  })

  it('counts separately identified actual probe cycles for the same practice session', () => {
    const events = evidenceEvents('ls.alif', 1, 2)
    const probes = [10, 20, 30, 40].map((time) => probe('replayed-session', time, 'ls.alif', 'no_transfer_yet'))
    expect(state(createLearningMap(events, probes, { childId: CHILD }), 'ls.alif').noGainFlag).toBe(true)
  })

  it('cannot manufacture probe cycles by replaying one record with changed timestamps', () => {
    const events = evidenceEvents('ls.alif', 1, 2)
    const original = probe('practice-session', 10, 'ls.alif', 'no_transfer_yet', { eventId: 'actual-probe-record' })
    expect(state(createLearningMap(events, [original, structuredClone(original)], { childId: CHILD }), 'ls.alif').noGainFlag).toBe(false)
    expect(() => createLearningMap(events, [original, { ...original, at: at(20) }], { childId: CHILD }))
      .toThrowError(new LearningMapError('conflicting_duplicate'))
    expect(() => createLearningMap(events, [{ ...original, eventId: '' }], { childId: CHILD }))
      .toThrowError(new LearningMapError('invalid_input'))
  })

  it('ignores response object key order for exact probe retries', () => {
    const original = probe('ordered', 10, 'ls.alif', 'no_transfer_yet')
    const reordered: LearningMapProbe = {
      ...original,
      response: {
        per_skill: original.response.per_skill,
        synthetic: original.response.synthetic,
        model_version: original.response.model_version,
        session_id: original.response.session_id,
      },
    }
    const result = createLearningMap([event('ls.alif', true, 1)], [original, reordered], { childId: CHILD })
    expect(state(result, 'ls.alif').latestProbeAt).toBe(10)
    expect(() => createLearningMap([event('ls.alif', true, 1)], [original, {
      ...original,
      completed: false,
    }], { childId: CHILD })).toThrowError(new LearningMapError('conflicting_duplicate'))
  })

  it('resets trailing no-gain after a genuine mastery increase', () => {
    const events = [event('ls.alif', true, 1), event('ls.alif', false, 2), event('ls.alif', true, 25)]
    const probes = [10, 20, 30, 40, 50, 60].map((time, index) => probe(`p${index}`, time, 'ls.alif', 'no_transfer_yet'))
    expect(state(createLearningMap(events, probes.slice(0, 5), { childId: CHILD }), 'ls.alif').noGainFlag).toBe(false)
    expect(state(createLearningMap(events, probes, { childId: CHILD }), 'ls.alif').noGainFlag).toBe(true)
  })

  it('deduplicates exact retries, rejects conflicting identities, and preserves inputs', () => {
    const original = event('ls.alif', true, 1, { eventId: 'retry' })
    const copy = structuredClone([original])
    const result = createLearningMap([original, structuredClone(original)], [], { childId: CHILD })
    expect(state(result, 'ls.alif').evidenceCounts).toEqual({ total: 1, correct: 1, incorrect: 0 })
    expect([original]).toEqual(copy)
    expect(() => createLearningMap([
      original,
      { ...structuredClone(original), evidence: [{ skill_id: 'ls.alif', correct: false, source: 'audio' }] },
    ], [], { childId: CHILD })).toThrowError(new LearningMapError('conflicting_duplicate'))
  })

  it('counts repeated canonical observations within one event in original order', () => {
    const result = createLearningMap([eventWithEvidence([
      { skill_id: 'ls.alif', correct: true, source: 'audio' },
      { skill_id: 'ls.alif', correct: false, source: 'audio' },
      { skill_id: 'ls.alif', correct: true, source: 'audio' },
    ], 1, { eventId: 'decode' })], [], { childId: CHILD })
    expect(state(result, 'ls.alif')).toMatchObject({
      mastery: 2 / 3,
      evidenceCounts: { total: 3, correct: 2, incorrect: 1 },
    })
  })

  it('deduplicates whole-event retries without collapsing repeated evidence', () => {
    const original = eventWithEvidence([
      { skill_id: 'ls.alif', correct: true, source: 'audio' },
      { skill_id: 'ls.alif', correct: false, source: 'audio' },
      { skill_id: 'ls.alif', correct: true, source: 'audio' },
    ], 1, { eventId: 'decode-retry' })
    const result = createLearningMap([original, structuredClone(original)], [], { childId: CHILD })
    expect(state(result, 'ls.alif').evidenceCounts).toEqual({ total: 3, correct: 2, incorrect: 1 })
    expect(() => createLearningMap([
      original,
      eventWithEvidence([
        { skill_id: 'ls.alif', correct: true, source: 'audio' },
        { skill_id: 'ls.alif', correct: true, source: 'audio' },
        { skill_id: 'ls.alif', correct: true, source: 'audio' },
      ], 1, { eventId: 'decode-retry' }),
    ], [], { childId: CHILD })).toThrowError(new LearningMapError('conflicting_duplicate'))
  })

  it('accepts empty events as valid zero-observation envelopes', () => {
    const empty = eventWithEvidence([], 1, { eventId: 'empty' })
    const result = createLearningMap([empty, structuredClone(empty)], [], { childId: CHILD })
    expect(state(result, 'ls.alif')).toMatchObject({ mastery: null, evidenceCounts: { total: 0, correct: 0, incorrect: 0 }, history: [] })
    expect(() => createLearningMap([
      empty,
      event('ls.alif', true, 1, { eventId: 'empty' }),
    ], [], { childId: CHILD })).toThrowError(new LearningMapError('conflicting_duplicate'))
  })

  it('sorts out-of-order evidence into deterministic session history', () => {
    const result = createLearningMap([
      event('ls.alif', false, 30, { sessionId: 'late' }),
      event('ls.alif', true, 10, { sessionId: 'early' }),
    ], [], { childId: CHILD })
    expect(state(result, 'ls.alif').history.map((point) => point.sessionId)).toEqual(['early', 'late'])
    expect(state(result, 'ls.alif').mastery).toBe(0.5)
  })

  it('rejects cross-child data, invalid skills, disallowed sources, bad times, and malformed probes', () => {
    expect(() => createLearningMap([{ ...event('ls.alif', true, 1), childId: 'other' }], [], { childId: CHILD })).toThrowError(LearningMapError)
    expect(() => createLearningMap([{ ...event('ls.alif', true, 1), evidence: [{ skill_id: 'not.real', correct: true, source: 'audio' }] }], [], { childId: CHILD })).toThrowError(LearningMapError)
    expect(() => createLearningMap([event('vowel.fatha', true, 1, {}, 'audio')], [], { childId: CHILD })).toThrowError(LearningMapError)
    expect(() => createLearningMap([{ ...event('ls.alif', true, 1), at: 'not-a-time' }], [], { childId: CHILD })).toThrowError(LearningMapError)
    expect(() => createLearningMap([], [probe('p1', 1, 'ls.alif', 'transfer_shown', { nUnseen: -1 })], { childId: CHILD })).toThrowError(LearningMapError)
  })

  it('unlocks prerequisites recursively only after they are mastered', () => {
    const prerequisiteIds: SkillId[] = ['vowel.fatha', 'vowel.kasra', 'vowel.damma']
    const prerequisiteEvents = prerequisiteIds.flatMap((skill_id, index) => evidenceEvents(skill_id, 17, 20, index * 30 + 1).map((item) => ({
      ...item,
      evidence: [{ ...item.evidence[0], source: 'tap' as const }],
    })))
    const childEvents = [...prerequisiteEvents, ...evidenceEvents('vowel.sukun', 17, 20, 100).map((item) => ({
      ...item,
      evidence: [{ ...item.evidence[0], source: 'tap' as const }],
    }))]
    const locked = createLearningMap(childEvents, [probe('p', 300, 'vowel.sukun', 'transfer_shown')], { childId: CHILD })
    expect(state(locked, 'vowel.fatha').unlocked).toBe(true)
    expect(state(locked, 'vowel.sukun')).toMatchObject({ mastered: true, unlocked: false })

    const unlocked = createLearningMap(childEvents, [
      ...prerequisiteIds.map((skill_id, index) => probe(`p${index}`, 250 + index, skill_id, 'transfer_shown')),
      probe('p4', 300, 'vowel.sukun', 'transfer_shown'),
    ], { childId: CHILD })
    expect(state(unlocked, 'vowel.sukun').unlocked).toBe(true)
  })

  it('selects the weakest unlocked practice skill, growing reviews, and probe queue deterministically', () => {
    const events = [
      ...evidenceEvents('ls.alif', 1, 2),
      ...evidenceEvents('ls.baa', 3, 5, 10),
      ...evidenceEvents('ls.taa', 17, 20, 20),
    ]
    const result = createLearningMap(events, [probe('p', 100, 'ls.taa', 'no_transfer_yet')], { childId: CHILD })
    const plan = selectNextPlan(result)
    expect(plan.primarySkillId).toBe('ls.thaa')
    expect(plan.reviewSkillIds).toEqual(['ls.baa'])
    expect(plan.probeDueIds).toEqual(['ls.taa'])
    expect(plan.focusSkillIds).toEqual(['ls.thaa', 'ls.baa', 'ls.taa'])
  })

  it('propagates synthetic provenance without changing scoring', () => {
    const result = createLearningMap([event('ls.alif', true, 1, { synthetic: true })], [
      probe('p', 2, 'ls.alif', 'no_transfer_yet', { synthetic: true }),
    ], { childId: CHILD })
    expect(result.synthetic).toBe(true)
    expect(state(result, 'ls.alif').synthetic).toBe(true)
    expect(state(result, 'ls.alif').mastery).toBe(1)
  })
})
