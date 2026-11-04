import type { Stage0Construct, Stage0TaskItem, Stage0TaskSet } from '../contracts/basira'
import { parseContract } from '../scorer/validation'
import nonverbalPattern from '../../../content/dist/stage0/nonverbal-pattern-basira-v0.json'
import numberSense from '../../../content/dist/stage0/number-sense-basira-v0.json'
import orientation from '../../../content/dist/stage0/orientation-basira-v0.json'

export const STAGE0_CONSTRUCTS: readonly Stage0Construct[] = [
  'itpa',
  'reversal',
  'nonverbal_iq',
  'visual_agnosia',
  'dyscalculia',
  'phonological_awareness',
  'reading_fluency',
]

const taskSources: readonly unknown[] = [orientation, nonverbalPattern, numberSense]

function loadTaskSet(value: unknown): Stage0TaskSet {
  return parseContract('Stage0TaskSet', value)
}

const loadedTaskSets = new Map<Stage0Construct, Stage0TaskSet>()
for (const source of taskSources) {
  const taskSet = loadTaskSet(source)
  if (loadedTaskSets.has(taskSet.construct)) throw new Error(`stage0: duplicate construct ${taskSet.construct}`)
  loadedTaskSets.set(taskSet.construct, taskSet)
}

export type Stage0ConstructEntry = {
  construct: Stage0Construct
  taskSet: Stage0TaskSet | null
  unavailable: boolean
}

export const stage0Catalog: readonly Stage0ConstructEntry[] = STAGE0_CONSTRUCTS.map((construct) => ({
  construct,
  taskSet: loadedTaskSets.get(construct) ?? null,
  unavailable: !loadedTaskSets.has(construct),
}))

export function taskSetForConstruct(construct: Stage0Construct): Stage0TaskSet | null {
  return loadedTaskSets.get(construct) ?? null
}

export function scoredItemsForTaskSet(taskSet: Stage0TaskSet): Stage0TaskItem[] {
  return taskSet.blocks.flatMap((block) => block.scored ? block.items.filter((item) => !item.practice) : [])
}

/** Canonical inline SVG only; never render arbitrary markup from user input. */
export function isSafeStimulusSvg(value: string | null): value is string {
  if (!value || !/^\s*<svg\b/i.test(value) || !/<\/svg>\s*$/i.test(value)) return false
  return !/<\s*(?:script|style|foreignObject|use)\b|\bon[a-z]+\s*=|(?:href|src|xlink:href)\s*=|javascript:|url\s*\(|@import/i.test(value)
}
