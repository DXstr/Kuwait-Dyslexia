import graphDocument from '../../../contracts/skill-graph.json'
import type { ProbeResponse, SkillEvidence, SkillId } from '../contracts/basira'
import { parseContract } from '../scorer/validation'
import {
  LearningMapError,
  type EvidenceCounts,
  type LearningMap,
  type LearningMapEvent,
  type LearningMapHistoryPoint,
  type LearningMapOptions,
  type LearningMapProbe,
  type LearningPlanSelection,
  type MasteryBand,
  type SkillState,
} from './types'

type GraphSkill = {
  id: SkillId
  prerequisites: SkillId[]
  evidence: SkillEvidence['source'][]
}

type ParsedGraph = {
  order: GraphSkill[]
  byId: Map<SkillId, GraphSkill>
}

type EventEnvelope = {
  childId: string
  sessionId: string
  eventId: string
  time: number
  synthetic: boolean
  evidence: SkillEvidence[]
}
type NormalizedEvent = EventEnvelope & {
  observationIndex: number
  skill_id: SkillId
  correct: boolean
  source: SkillEvidence['source']
}
type NormalizedProbe = {
  childId: string
  sessionId: string
  eventId: string
  at: number
  completed: boolean
  response: ProbeResponse
}
type ProbeSkillRow = ProbeResponse['per_skill'][number]
type Snapshot = { correct: number; total: number }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function stableEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((value, index) => stableEqual(value, b[index]))
  }
  if (isRecord(a) || isRecord(b)) {
    if (!isRecord(a) || !isRecord(b)) return false
    const aKeys = Object.keys(a).sort()
    const bKeys = Object.keys(b).sort()
    return aKeys.length === bKeys.length && aKeys.every((key, index) =>
      key === bKeys[index] && stableEqual(a[key], b[key]))
  }
  return false
}

const nonEmptyId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const fail = (reason: ConstructorParameters<typeof LearningMapError>[0]): never => {
  throw new LearningMapError(reason)
}

function parseCanonicalEvidence(value: unknown, reason: 'invalid_contract' | 'invalid_graph' = 'invalid_contract'): SkillEvidence {
  try {
    return parseContract('SkillEvidence', value)
  } catch {
    return fail(reason)
  }
}

function parseCanonicalSkillId(value: unknown, reason: 'invalid_contract' | 'invalid_graph'): SkillId {
  try {
    return parseContract('SkillId', value)
  } catch {
    return fail(reason)
  }
}

function parseGraph(value: unknown): ParsedGraph {
  if (!isRecord(value) || !Array.isArray(value.skills) || value.skills.length === 0) fail('invalid_graph')
  const document = value as Record<string, unknown>
  const skills = document.skills as unknown[]
  const order: GraphSkill[] = []
  const byId = new Map<SkillId, GraphSkill>()
  for (const raw of skills) {
    if (!isRecord(raw)) fail('invalid_graph')
    const item = raw as Record<string, unknown>
    if (!nonEmptyId(item.id)) fail('invalid_graph')
    const skillId = parseCanonicalSkillId(item.id, 'invalid_graph')
    if (!Array.isArray(item.prerequisites) || !Array.isArray(item.evidence)) fail('invalid_graph')
    const prerequisitesRaw = item.prerequisites as unknown[]
    const evidenceRaw = item.evidence as unknown[]
    const prerequisites = prerequisitesRaw.map((id: unknown) => parseCanonicalSkillId(id, 'invalid_graph'))
    const evidence = evidenceRaw.map((source: unknown) => {
      return parseCanonicalEvidence({ skill_id: skillId, correct: false, source }, 'invalid_graph').source
    })
    if (byId.has(skillId)) fail('invalid_graph')
    const skill: GraphSkill = { id: skillId, prerequisites, evidence }
    byId.set(skill.id, skill)
    order.push(skill)
  }
  for (const skill of order) {
    for (const prerequisite of skill.prerequisites) {
      if (!byId.has(prerequisite)) fail('invalid_graph')
    }
  }
  const visiting = new Set<SkillId>()
  const visited = new Set<SkillId>()
  const visit = (id: SkillId): void => {
    if (visiting.has(id)) fail('invalid_graph')
    if (visited.has(id)) return
    visiting.add(id)
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) visit(prerequisite)
    visiting.delete(id)
    visited.add(id)
  }
  for (const skill of order) visit(skill.id)
  return { order, byId }
}

const GRAPH = parseGraph(graphDocument)
const GRAPH_INDEX = new Map(GRAPH.order.map((skill, index) => [skill.id, index]))

export const SKILL_GRAPH_STATUS = String((graphDocument as { status?: unknown }).status ?? '')
export const CANONICAL_SKILL_IDS: readonly SkillId[] = GRAPH.order.map((skill) => skill.id)

export const isCanonicalSkillId = (value: unknown): value is SkillId =>
  typeof value === 'string' && GRAPH.byId.has(value as SkillId)

function assertInputId(value: unknown): asserts value is string {
  if (!nonEmptyId(value)) fail('invalid_input')
}

function parseTime(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid_input')
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fail('invalid_input')
}

function parseEvent(value: unknown, childId: string): EventEnvelope {
  if (!isRecord(value)) fail('invalid_input')
  const event = value as Record<string, unknown>
  const eventChildId = event.childId
  const sessionId = event.sessionId
  const eventId = event.eventId
  assertInputId(eventChildId)
  assertInputId(sessionId)
  assertInputId(eventId)
  const time = parseTime(event.at)
  if (eventChildId !== childId) fail('cross_child_data')
  if (typeof event.synthetic !== 'boolean' || !Array.isArray(event.evidence)) {
    fail('invalid_input')
  }
  const evidence = event.evidence as unknown[]
  const synthetic = event.synthetic as boolean
  const canonicalEvidence = evidence.map((raw: unknown): SkillEvidence => {
    const item = parseCanonicalEvidence(raw)
    const skill = GRAPH.byId.get(item.skill_id)
    if (!skill || (item.source !== 'probe' && !skill.evidence.includes(item.source))) {
      fail('invalid_contract')
    }
    return item
  })
  return { childId, sessionId, eventId, time, synthetic, evidence: canonicalEvidence }
}

function normalizeEvents(values: readonly LearningMapEvent[], childId: string): NormalizedEvent[] {
  const byIdentity = new Map<string, EventEnvelope>()
  for (const value of values) {
    const event = parseEvent(value, childId)
    const key = `${event.childId}\u0000${event.sessionId}\u0000${event.eventId}`
    const prior = byIdentity.get(key)
    if (prior && !stableEqual(prior, event)) fail('conflicting_duplicate')
    if (!prior) byIdentity.set(key, event)
  }
  return [...byIdentity.values()].flatMap((event) => event.evidence.map((item, observationIndex) => ({
    ...event,
    observationIndex,
    skill_id: item.skill_id,
    correct: item.correct,
    source: item.source,
  }))).sort((a, b) =>
    a.time - b.time || a.sessionId.localeCompare(b.sessionId) || a.eventId.localeCompare(b.eventId) ||
    a.observationIndex - b.observationIndex)
}

function parseProbe(value: unknown, childId: string): NormalizedProbe {
  if (!isRecord(value)) fail('invalid_input')
  const probe = value as Record<string, unknown>
  const probeChildId = probe.childId
  const sessionId = probe.sessionId
  const eventId = probe.eventId
  const completed = probe.completed
  assertInputId(probeChildId)
  assertInputId(sessionId)
  assertInputId(eventId)
  const at = parseTime(probe.at)
  if (probeChildId !== childId) fail('cross_child_data')
  if (typeof completed !== 'boolean' || !isRecord(probe.response)) fail('invalid_input')
  let response: ProbeResponse
  try {
    response = parseContract('ProbeResponse', probe.response)
  } catch {
    return fail('invalid_contract')
  }
  if (response.session_id !== sessionId) fail('invalid_contract')
  const perSkill: ProbeSkillRow[] = []
  const seen = new Set<SkillId>()
  for (const item of response.per_skill) {
    if (!isCanonicalSkillId(item.skill_id) || seen.has(item.skill_id)) fail('invalid_contract')
    perSkill.push({ ...item })
    seen.add(item.skill_id)
  }
  return {
    childId,
    sessionId,
    eventId,
    at,
    completed: completed as boolean,
    response: {
      session_id: response.session_id,
      model_version: response.model_version,
      synthetic: response.synthetic,
      per_skill: perSkill,
    },
  }
}

function sameProbe(a: NormalizedProbe, b: NormalizedProbe): boolean {
  return stableEqual(a, b)
}

function normalizeProbes(values: readonly LearningMapProbe[], childId: string): NormalizedProbe[] {
  const byIdentity = new Map<string, NormalizedProbe>()
  for (const value of values) {
    const probe = parseProbe(value, childId)
    const key = `${probe.childId}\u0000${probe.eventId}`
    const prior = byIdentity.get(key)
    if (prior && !sameProbe(prior, probe)) fail('conflicting_duplicate')
    if (!prior) byIdentity.set(key, probe)
  }
  return [...byIdentity.values()].sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId))
}

function fraction(correct: number, total: number): number | null {
  return total === 0 ? null : correct / total
}

function fractionAtLeast(correct: number, total: number, numerator: number, denominator: number): boolean {
  return total > 0 && correct * denominator >= total * numerator
}

function fractionLessThan(correct: number, total: number, numerator: number, denominator: number): boolean {
  return total > 0 && correct * denominator < total * numerator
}

function evidenceCounts(events: readonly NormalizedEvent[]): EvidenceCounts {
  let correct = 0
  for (const event of events) if (event.correct) correct += 1
  return { total: events.length, correct, incorrect: events.length - correct }
}

function masteryAt(events: readonly NormalizedEvent[], at: number): Snapshot {
  let correct = 0
  let total = 0
  for (const event of events) {
    if (event.time > at) break
    total += 1
    if (event.correct) correct += 1
  }
  return { correct, total }
}

function buildHistory(events: readonly NormalizedEvent[]): LearningMapHistoryPoint[] {
  const groups = new Map<string, NormalizedEvent[]>()
  for (const event of events) groups.set(event.sessionId, [...(groups.get(event.sessionId) ?? []), event])
  const ordered = [...groups.entries()].sort((a, b) => {
    const atA = Math.max(...a[1].map((event) => event.time))
    const atB = Math.max(...b[1].map((event) => event.time))
    return atA - atB || a[0].localeCompare(b[0])
  })
  let correct = 0
  let total = 0
  let synthetic = false
  return ordered.map(([sessionId, sessionEvents]) => {
    for (const event of sessionEvents) {
      total += 1
      if (event.correct) correct += 1
      synthetic ||= event.synthetic
    }
    const at = Math.max(...sessionEvents.map((event) => event.time))
    return {
      sessionId,
      at,
      mastery: fraction(correct, total) as number,
      evidenceCounts: { total, correct, incorrect: total - correct },
      synthetic,
    }
  })
}

function rowsForSkill(probes: readonly NormalizedProbe[], skillId: SkillId): { probe: NormalizedProbe; row: ProbeSkillRow }[] {
  const rows: { probe: NormalizedProbe; row: ProbeSkillRow }[] = []
  for (const probe of probes) {
    const row = probe.response.per_skill.find((candidate) => candidate.skill_id === skillId)
    if (probe.completed && row) rows.push({ probe, row })
  }
  return rows
}

function noGainForSkill(
  events: readonly NormalizedEvent[],
  probes: readonly NormalizedProbe[],
  skillId: SkillId,
  cycles: number,
): boolean {
  const skillEvents = events.filter((event) => event.skill_id === skillId)
  const snapshots: Snapshot[] = []
  for (const { probe, row } of rowsForSkill(probes, skillId)) {
    if (row.n_practised === 0 || row.n_unseen === 0 || row.transfer === 'insufficient_data') continue
    const snapshot = masteryAt(skillEvents, probe.at)
    if (snapshot.total > 0) snapshots.push(snapshot)
  }
  if (snapshots.length < cycles + 1) return false
  let trailing = 0
  for (let index = snapshots.length - 1; index > 0; index -= 1) {
    const current = snapshots[index]
    const previous = snapshots[index - 1]
    if (current.correct * previous.total <= previous.correct * current.total) trailing += 1
    else break
  }
  return trailing >= cycles
}

function baseBand(snapshot: Snapshot): MasteryBand {
  if (snapshot.total === 0) return 'unknown'
  if (fractionLessThan(snapshot.correct, snapshot.total, 60, 100)) return 'working_on'
  if (!fractionAtLeast(snapshot.correct, snapshot.total, 85, 100)) return 'growing'
  return 'probe_due'
}

function computeUnlocked(states: Map<SkillId, SkillState>): void {
  const cache = new Map<SkillId, boolean>()
  const visit = (id: SkillId, path: Set<SkillId>): boolean => {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    if (path.has(id)) fail('invalid_graph')
    path.add(id)
    const skill = GRAPH.byId.get(id)
    const result = (skill?.prerequisites ?? []).every((prerequisite) => {
      const state = states.get(prerequisite)
      return state?.mastered === true && visit(prerequisite, path)
    })
    path.delete(id)
    cache.set(id, result)
    return result
  }
  for (const skill of GRAPH.order) {
    const state = states.get(skill.id)
    if (state) state.unlocked = visit(skill.id, new Set())
  }
}

export function createLearningMap(
  events: readonly LearningMapEvent[],
  probes: readonly LearningMapProbe[],
  options: LearningMapOptions,
): LearningMap {
  if (!Array.isArray(events) || !Array.isArray(probes) || !isRecord(options)) fail('invalid_input')
  assertInputId(options.childId)
  const noGainCycles = options.noGainCycles ?? 3
  if (!Number.isInteger(noGainCycles) || noGainCycles < 1) fail('invalid_input')
  const normalizedEvents = normalizeEvents(events, options.childId)
  const normalizedProbes = normalizeProbes(probes, options.childId)
  const states = new Map<SkillId, SkillState>()
  let anySynthetic = false

  for (const skill of GRAPH.order) {
    const skillEvents = normalizedEvents.filter((event) => event.skill_id === skill.id)
    const counts = evidenceCounts(skillEvents)
    const snapshot: Snapshot = { correct: counts.correct, total: counts.total }
    const latestRows = rowsForSkill(normalizedProbes, skill.id)
    const latest = latestRows[latestRows.length - 1]
    const transferShown = latest?.row.transfer === 'transfer_shown' &&
      latest.row.n_practised > 0 && latest.row.n_unseen > 0
    const base = baseBand(snapshot)
    const mastered = base === 'probe_due' && transferShown
    const synthetic = skillEvents.some((event) => event.synthetic) || latestRows.some(({ probe }) => probe.response.synthetic)
    anySynthetic ||= synthetic
    states.set(skill.id, {
      skill_id: skill.id,
      mastery: fraction(snapshot.correct, snapshot.total),
      evidenceCounts: counts,
      band: mastered ? 'mastered' : base,
      mastered,
      unlocked: false,
      latestTransfer: latest?.row.transfer ?? null,
      latestProbeAt: latest?.probe.at ?? null,
      noGainFlag: noGainForSkill(normalizedEvents, normalizedProbes, skill.id, noGainCycles),
      synthetic,
      history: buildHistory(skillEvents),
    })
  }
  computeUnlocked(states)
  const skills = GRAPH.order.map((skill) => states.get(skill.id) as SkillState)
  const bySkillId = Object.fromEntries(skills.map((skill) => [skill.skill_id, skill]))
  return { childId: options.childId, skills, bySkillId, synthetic: anySynthetic }
}

const BAND_ORDER: Record<MasteryBand, number> = {
  unknown: 0,
  working_on: 1,
  growing: 2,
  probe_due: 3,
  mastered: 4,
}

export function selectNextPlan(map: LearningMap | readonly SkillState[]): LearningPlanSelection {
  const skills: readonly SkillState[] = Array.isArray(map) ? map : (map as LearningMap).skills
  const canonical = skills.filter((state) => isCanonicalSkillId(state.skill_id))
    .sort((a, b) => (GRAPH_INDEX.get(a.skill_id) ?? Number.MAX_SAFE_INTEGER) - (GRAPH_INDEX.get(b.skill_id) ?? Number.MAX_SAFE_INTEGER))
  const eligible = canonical.filter((state) => state.unlocked && !state.mastered &&
    (state.band === 'unknown' || state.band === 'working_on' || state.band === 'growing'))
  const primary = [...eligible].sort((a, b) => {
    const band = BAND_ORDER[a.band] - BAND_ORDER[b.band]
    if (band !== 0) return band
    const masteryA = a.mastery ?? -1
    const masteryB = b.mastery ?? -1
    return masteryA - masteryB || (GRAPH_INDEX.get(a.skill_id) ?? 0) - (GRAPH_INDEX.get(b.skill_id) ?? 0)
  })[0]
  const reviewSkillIds = eligible.filter((state) => state.band === 'growing' && state.skill_id !== primary?.skill_id)
    .map((state) => state.skill_id)
  const probeDueIds = canonical.filter((state) => state.unlocked && state.band === 'probe_due')
    .map((state) => state.skill_id)
  const focusSkillIds = [
    ...(primary ? [primary.skill_id] : []),
    ...reviewSkillIds,
    ...probeDueIds,
  ]
  return {
    primarySkillId: primary?.skill_id ?? null,
    reviewSkillIds,
    probeDueIds,
    focusSkillIds,
  }
}
