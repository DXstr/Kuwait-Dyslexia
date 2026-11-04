import { describe, expect, it } from 'vitest'
import { STAGE0_CONSTRUCTS, isSafeStimulusSvg, scoredItemsForTaskSet, stage0Catalog } from './catalog'

describe('Stage 0 canonical catalog', () => {
  it('exposes exactly the seven contract constructs and marks absent content unavailable', () => {
    expect(STAGE0_CONSTRUCTS).toHaveLength(7)
    expect(new Set(STAGE0_CONSTRUCTS).size).toBe(7)
    expect(stage0Catalog).toHaveLength(7)
    expect(stage0Catalog.filter((entry) => entry.taskSet)).toHaveLength(3)
    expect(stage0Catalog.filter((entry) => entry.unavailable).map((entry) => entry.construct)).toEqual([
      'itpa', 'visual_agnosia', 'phonological_awareness', 'reading_fluency',
    ])
    expect(stage0Catalog.filter((entry) => entry.taskSet).every((entry) => entry.taskSet?.construct === entry.construct)).toBe(true)
  })

  it('allows only canonical inline SVG without active content or external references', () => {
    expect(isSafeStimulusSvg('<svg viewBox="0 0 10 10"><rect width="10" height="10" /></svg>')).toBe(true)
    expect(isSafeStimulusSvg('<svg><script>alert(1)</script></svg>')).toBe(false)
    expect(isSafeStimulusSvg('<svg><image href="https://example.invalid/x" /></svg>')).toBe(false)
    expect(isSafeStimulusSvg('<svg onclick="send()"></svg>')).toBe(false)
    expect(isSafeStimulusSvg('<svg><style>@import url(https://example.invalid/x)</style></svg>')).toBe(false)
    expect(isSafeStimulusSvg('<svg><use href="#external" /></svg>')).toBe(false)
    expect(isSafeStimulusSvg(null)).toBe(false)
  })

  it('builds scorer requests from scored non-practice items only', () => {
    for (const entry of stage0Catalog.filter((candidate) => candidate.taskSet)) {
      const allItems = entry.taskSet!.blocks.flatMap((block) => block.items)
      const requestItems = scoredItemsForTaskSet(entry.taskSet!)
      expect(requestItems.every((item) => !item.practice)).toBe(true)
      expect(requestItems.every((item) => entry.taskSet!.blocks.some((block) => block.scored && block.items.includes(item)))).toBe(true)
      expect(requestItems.length).toBeLessThan(allItems.length)
    }
  })
})
